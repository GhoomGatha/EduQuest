
import React, { useState, useMemo, ChangeEvent, useRef, useEffect, useCallback } from 'react';
import { Paper, QuestionSource, Semester, UploadProgress, Language, Question, Classroom } from '../types';
import { t } from '../utils/localization';
import Modal from './Modal';
import { CLASSES, SEMESTERS, YEARS, BOARDS, TEACHER_CURRICULUM_PREFS_KEY } from '../constants';
import { getBengaliFontBase64, getDevanagariFontBase64, getKannadaFontBase64 } from '../utils/fontData';
import { loadScript } from '../utils/scriptLoader';
import { getSubjectsAI } from '../services/geminiService';

// --- Start of Embedded MarkdownRenderer Component ---
declare global {
    interface Window {
        marked: any;
    }
}
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (containerRef.current && window.marked) {
            containerRef.current.innerHTML = window.marked.parse(content || '');
        }
    }, [content]);
    return <div ref={containerRef} className="prose prose-sm max-w-none prose-slate"></div>;
};
// --- End of Embedded MarkdownRenderer Component ---

interface ExamArchiveProps {
  papers: Paper[];
  onDeletePaper: (id: string) => void;
  onUploadPaper: (paper: Paper, files: FileList, onProgress: (progress: UploadProgress | null) => void, options: { signal: AbortSignal }) => Promise<Paper>;
  onProcessPaper: (paper: Paper, files: FileList) => Promise<void>;
  lang: Language;
  showToast: (message: string, type?: 'success' | 'error') => void;
  viewingPaper: Paper | null;
  setViewingPaper: (paper: Paper | null) => void;
  userApiKey?: string;
  userOpenApiKey?: string;
  onAssignPaper: (paper: Paper) => void;
}

const getInitialUploadState = () => {
    // Define defaults separately for clarity
    const defaults = {
      title: '',
      year: new Date().getFullYear(),
      class: 10,
      semester: Semester.First,
      board: 'WBBSE',
      subject: '',
    };

    try {
        const saved = localStorage.getItem(TEACHER_CURRICULUM_PREFS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge saved data over defaults, ensuring all keys are present
            return {
                ...defaults,
                year: parsed.year || defaults.year,
                class: parsed.class || defaults.class,
                semester: parsed.semester || defaults.semester,
                board: parsed.board || defaults.board,
                subject: parsed.subject || defaults.subject,
            };
        }
    } catch (e) {
        console.warn("Could not parse saved curriculum prefs", e);
    }
    // Return defaults if nothing is saved or parsing fails
    return defaults;
};


const PAPERS_PER_PAGE = 15;
const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 10;
const ACCEPTED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/gif'
];

interface IndividualFileProgress {
  name: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
}

const ExamArchive: React.FC<ExamArchiveProps> = ({ papers, onDeletePaper, onUploadPaper, onProcessPaper, lang, showToast, viewingPaper, setViewingPaper, userApiKey, userOpenApiKey, onAssignPaper }) => {
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadData, setUploadData] = useState(getInitialUploadState);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [individualFileProgress, setIndividualFileProgress] = useState<IndividualFileProgress[]>([]);


  // New state for multi-level navigation and filtering
  const [selectedClass, setSelectedClass] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterYear, setFilterYear] = useState<number | ''>('');
  const [filterSemester, setFilterSemester] = useState<Semester | ''>('');
  const [currentPage, setCurrentPage] = useState(1);

  const modalFileInputRef = useRef<HTMLInputElement>(null);
  const quickUploadInputRef = useRef<HTMLInputElement>(null);

  const stableShowToast = useCallback(showToast, []);

  // Persist curriculum settings to local storage, excluding the ephemeral title.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { title, ...curriculumData } = uploadData;
    localStorage.setItem(TEACHER_CURRICULUM_PREFS_KEY, JSON.stringify(curriculumData));
  }, [uploadData]);


  useEffect(() => {
    if (!isUploadModalOpen) return;

    setLoadingSubjects(true);
    getSubjectsAI(uploadData.board, uploadData.class, lang, userApiKey, userOpenApiKey)
        .then(subjectList => {
            setSubjects(subjectList);
            // Ensure a subject is selected, especially if the current one is invalid or empty.
            const hasValidSubject = subjectList.includes(uploadData.subject);
            if (!hasValidSubject && subjectList.length > 0) {
                setUploadData(prev => ({...prev, subject: subjectList[0]})); // Pick the first available subject
            } else if (subjectList.length === 0) {
                setUploadData(prev => ({...prev, subject: ''})); // No subjects, ensure it's empty
            }
            // If hasValidSubject is true, keep the existing uploadData.subject.
        })
        .catch((err) => {
            stableShowToast(err.message || "Could not fetch subjects.", 'error');
            setSubjects([]); // Clear subjects on error to avoid stale data
            setUploadData(prev => ({...prev, subject: ''})); // Ensure subject is cleared on error
        })
        .finally(() => {
            setLoadingSubjects(false); // This is crucial to prevent getting stuck
        });
  }, [isUploadModalOpen, uploadData.board, uploadData.class, lang, userApiKey, userOpenApiKey, stableShowToast]);


  // Reset filters when changing class or going back
  useEffect(() => {
    setCurrentPage(1);
    setSearchTerm('');
    setFilterYear('');
    setFilterSemester('');
  }, [selectedClass]);

  const papersByClass = useMemo(() => {
    const grouped = papers.reduce((acc, paper) => {
      const classNum = paper.class;
      if (!acc[classNum]) {
        acc[classNum] = [];
      }
      acc[classNum].push(paper);
      return acc;
    }, {} as Record<number, Paper[]>);

    return Object.keys(grouped)
      .map(Number)
      .sort((a, b) => a - b)
      .map(classNum => ({
        classNum,
        count: grouped[classNum].length,
      }));
  }, [papers]);

  const filteredAndPaginatedPapers = useMemo(() => {
    if (!selectedClass) return { paginatedPapers: [], totalPages: 0 };

    const papersForClass = papers.filter(p => p.class === selectedClass);
    
    const filtered = papersForClass.filter(paper => {
      const searchTermMatch = !searchTerm || paper.title.toLowerCase().includes(searchTerm.toLowerCase());
      const yearMatch = !filterYear || paper.year === filterYear;
      const semesterMatch = !filterSemester || paper.semester === filterSemester;
      return searchTermMatch && yearMatch && semesterMatch;
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const totalPages = Math.ceil(filtered.length / PAPERS_PER_PAGE);
    const startIndex = (currentPage - 1) * PAPERS_PER_PAGE;
    const paginatedPapers = filtered.slice(startIndex, startIndex + PAPERS_PER_PAGE);

    return { paginatedPapers, totalPages, totalCount: filtered.length };
  }, [selectedClass, papers, searchTerm, filterYear, filterSemester, currentPage]);

  const uniqueYearsInClass = useMemo(() => {
    if (!selectedClass) return [];
    const years = new Set(papers.filter(p => p.class === selectedClass).map(p => p.year));
    return Array.from(years).sort((a, b) => Number(b) - Number(a));
  }, [papers, selectedClass]);
  

  const openUploadModal = () => {
    // Only reset fields that should be cleared for a new upload.
    // Curriculum is preserved from the state which is loaded from localStorage.
    setUploadData(prev => ({ ...prev, title: '' }));
    setSelectedFiles(null);
    setUploadProgress(null);
    setIndividualFileProgress([]); // Clear individual file progress
    setIsCancelling(false);
    setUploadModalOpen(true);
  };
  
  const handleQuickUploadClick = () => {
    quickUploadInputRef.current?.click();
  };

  const handleQuickUploadFileSelection = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
        setSelectedFiles(e.target.files);
        setIndividualFileProgress(Array.from(e.target.files).map(file => ({
            name: (file as File).name,
            status: 'pending'
        })));
        setUploadModalOpen(true);
    }
  };

  const handleFileSelection = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
        setSelectedFiles(e.target.files);
        setIndividualFileProgress(Array.from(e.target.files).map(file => ({
            name: (file as File).name, 
            status: 'pending'
        })));
    }
  };

  const handleDragEvents = (e: React.DragEvent<HTMLLabelElement>, type: 'enter' | 'leave' | 'drop') => {
      e.preventDefault();
      e.stopPropagation();
      if (type === 'enter') setIsDragging(true);
      if (type === 'leave') setIsDragging(false);
      if (type === 'drop') {
          setIsDragging(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              setSelectedFiles(e.dataTransfer.files);
              setIndividualFileProgress(Array.from(e.dataTransfer.files).map(file => ({
                  name: (file as File).name, 
                  status: 'pending'
              })));
              if (modalFileInputRef.current) {
                  modalFileInputRef.current.files = e.dataTransfer.files;
              }
          }
      }
  };

  const handleProgressUpdate = useCallback((overallProgress: UploadProgress | null) => {
    setUploadProgress(overallProgress);
    if (overallProgress) {
        setIndividualFileProgress(prev => {
            if (overallProgress.error) {
                const failingFile = overallProgress.currentFile;
                const failedIndex = prev.findIndex(p => p.name === failingFile);

                if (failedIndex > -1) {
                    return prev.map((p, i) => {
                        if (i === failedIndex) return { ...p, status: 'failed' };
                        return p; // Don't reset other statuses
                    });
                }
                // Non-file-specific error, mark all non-completed files as failed
                return prev.map(p => p.status !== 'completed' ? { ...p, status: 'failed' } : p);
            }

            const completedCount = overallProgress.completed;
            
            if (completedCount === overallProgress.total) {
                return prev.map(p => ({ ...p, status: 'completed' }));
            }

            // In-progress update for sequential upload
            return prev.map((p, i) => {
                if (i < completedCount) return { ...p, status: 'completed' };
                if (i === completedCount) return { ...p, status: 'uploading' };
                return { ...p, status: 'pending' };
            });
        });
    }
  }, []);

  const handleUploadSubmit = async () => {
    const files = selectedFiles;
    if (!files || files.length === 0) {
        showToast("Please select at least one file.", 'error');
        return;
    }

    if (files.length > MAX_FILES) {
        showToast(`You can upload a maximum of ${MAX_FILES} files at a time.`, 'error');
        return;
    }

    for (const file of Array.from(files)) {
        const f = file as File;
        if (!ACCEPTED_MIME_TYPES.includes(f.type)) {
            showToast(`File type not supported for "${f.name}". Only PDF, DOCX, and image files are allowed.`, 'error');
            return;
        }
        if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            showToast(`"${f.name}" is too large. Max size is ${MAX_FILE_SIZE_MB}MB.`, 'error');
            return;
        }
    }

    const firstFile = files[0];
    const titleToUse = uploadData.title.trim() || ((firstFile as File).name.split('.').slice(0, -1).join('.') || (firstFile as File).name);

    const isDuplicate = papers.some(
        (paper) =>
            paper.title.toLowerCase() === titleToUse.toLowerCase() &&
            paper.class === uploadData.class &&
            paper.year === uploadData.year
    );

    if (isDuplicate) {
        if (
            !window.confirm(
                'A paper with the same title, class, and year already exists. Are you sure you want to upload another one?'
            )
        ) {
            return; // Stop the upload if user cancels
        }
    }

    const newPaper: Paper = {
      id: `local-${Date.now()}`,
      title: titleToUse,
      year: uploadData.year,
      class: uploadData.class,
      semester: uploadData.semester,
      board: uploadData.board,
      subject: uploadData.subject,
      source: QuestionSource.Upload,
      created_at: new Date().toISOString(),
      questions: [],
    };

    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    setIsUploading(true);
    setIsCancelling(false);
    
    setIndividualFileProgress(Array.from(files).map(file => ({ name: (file as File).name, status: 'pending' })));
    setUploadProgress({ total: files.length, completed: 0, pending: files.length, currentFile: (firstFile as File).name });

    let savedPaper: Paper | null = null;
    try {
      savedPaper = await onUploadPaper(newPaper, files, handleProgressUpdate, { signal: controller.signal });
    } catch (error: unknown) {
        console.error("RAW UPLOAD ERROR:", error);

        if (error instanceof DOMException && error.name === 'AbortError') {
            console.log('Upload cancelled by user.');
            showToast("Upload cancelled.", "success");
        } else {
            let actualErrorMessage = "An unknown error occurred during upload.";
            let failingFile = (error as any)?.fileName || uploadProgress?.currentFile || '';

            if (error instanceof Error) {
                actualErrorMessage = error.message;
            } else if (typeof error === 'object' && error !== null && 'message' in error) {
                actualErrorMessage = String(error.message);
            }
            
            if (actualErrorMessage.includes('Auth') || actualErrorMessage.includes('JWT') || actualErrorMessage.includes('permission denied')) {
                actualErrorMessage += ". This often indicates incorrect Supabase Storage policies or an invalid API key.";
            } else if (actualErrorMessage.includes('CORS')) {
                actualErrorMessage += ". Please check your Supabase Storage bucket's CORS configuration.";
            } else if (actualErrorMessage.includes('Failed to fetch') || actualErrorMessage.includes('Network request failed')) {
                 actualErrorMessage = "Network error: Could not reach the server. Please check your internet connection, disable any ad-blockers, or try again later.";
            }

            const progressWithError = {
                total: files.length,
                completed: uploadProgress?.completed || 0,
                pending: files.length - (uploadProgress?.completed || 0),
                currentFile: failingFile,
                error: actualErrorMessage,
            };
            handleProgressUpdate(progressWithError);
            setUploadProgress(progressWithError);
        }
        
        setIsUploading(false);
        setIsCancelling(false);
        uploadAbortControllerRef.current = null;
        if (error instanceof DOMException && error.name === 'AbortError') {
             setUploadModalOpen(false);
             setUploadProgress(null);
             setIndividualFileProgress([]);
        }
        return;
    }
    
    setIsUploading(false);
    setIsCancelling(false);
    uploadAbortControllerRef.current = null;
    setUploadModalOpen(false);
    setUploadProgress(null);
    setIndividualFileProgress([]);

    if (savedPaper) {
        onProcessPaper(savedPaper, files);
    }
  };

  const handleCancelUpload = () => {
    if (uploadAbortControllerRef.current && !isCancelling) {
        setIsCancelling(true);
        uploadAbortControllerRef.current.abort();
    }
  };

  const handleExportPDF = async (paper: Paper) => {
    if (!paper) return;

    try {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    } catch (error) {
        console.error("Failed to load jsPDF library", error);
        showToast("Failed to load PDF export library.", "error");
        return;
    }

    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let fontName = 'helvetica';
    let fontLoaded = false;
    const languageMap: Record<Language, string> = { en: 'English', bn: 'Bengali', hi: 'Hindi', ka: 'Kannada' };

    if (lang === 'bn') {
        const fontData = await getBengaliFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData);
            doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal');
            fontName = 'NotoSansBengali';
            fontLoaded = true;
        }
    } else if (lang === 'hi') {
        const fontData = await getDevanagariFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData);
            doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal');
            fontName = 'NotoSansDevanagari';
            fontLoaded = true;
        }
    } else if (lang === 'ka') {
        const fontData = await getKannadaFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansKannada-Regular.ttf', fontData);
            doc.addFont('NotoSansKannada-Regular.ttf', 'NotoSansKannada', 'normal');
            fontName = 'NotoSansKannada';
            fontLoaded = true;
        }
    }

    if (lang !== 'en' && !fontLoaded) {
        showToast(`Could not load the font for ${languageMap[lang]}. PDF content may not display correctly.`, 'error');
    }

    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const maxLineWidth = pageWidth - margin * 2;
    let y = margin;

    const checkPageBreak = (neededHeight: number) => { if (y + neededHeight > pageHeight - margin) { doc.addPage(); y = margin; } };
    
    doc.setFontSize(14);
    doc.setFont(fontName, 'bold');
    const titleLines = doc.splitTextToSize(paper.title, maxLineWidth);
    doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
    y += titleLines.length * 6 + 8;

    doc.setFontSize(10);
    doc.setFont(fontName, 'normal');

    if (paper.text) {
        const cleanedText = paper.text.replace(/##/g, '').replace(/---/g, '\n');
        const textLines = doc.splitTextToSize(cleanedText, maxLineWidth);
        textLines.forEach((line: string) => {
            const textHeight = 4.5;
            checkPageBreak(textHeight + 1);
            doc.text(line, margin, y);
            y += textHeight + 1;
        });
        if (paper.questions.length > 0) y += 8;
    }

    if (paper.questions.length > 0) {
        paper.questions.forEach((q, index) => {
            const questionText = `${index + 1}. ${q.text} (${q.marks} ${t('marks', lang)})`;
            if (q.image_data_url) {
                try {
                    const imgProps = doc.getImageProperties(q.image_data_url);
                    const imgWidth = 80; const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                    checkPageBreak(imgHeight + 5);
                    doc.addImage(q.image_data_url, 'JPEG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 5;
                } catch(e) { console.error("Error adding image to PDF:", e); }
            }
            const lines = doc.splitTextToSize(questionText, maxLineWidth);
            const textHeight = lines.length * 4.5;
            checkPageBreak(textHeight + 3);
            doc.text(lines, margin, y);
            y += textHeight + 3;
        });
    }

    if (paper.grounding_sources?.length) {
        y += 8;
        doc.setFontSize(12); doc.setFont(fontName, 'bold');
        doc.text(t('sources', lang), margin, y); y += 8;
        doc.setFontSize(8); doc.setFont(fontName, 'normal');
        paper.grounding_sources.forEach(source => {
            const lines = doc.splitTextToSize(`${source.title || 'Untitled'}: ${source.uri}`, maxLineWidth);
            const textHeight = lines.length * 4;
            checkPageBreak(textHeight + 2);
            doc.textWithLink(source.title || source.uri, margin, y, { url: source.uri });
            y += textHeight + 2;
        });
    }

    const questionsWithAnswers = paper.questions.filter(q => q.answer);
    if (questionsWithAnswers.length) {
        y += 8;
        doc.setFontSize(12); doc.setFont(fontName, 'bold');
        doc.text(t('answerKey', lang), margin, y); y += 8;
        doc.setFontSize(10); doc.setFont(fontName, 'normal');
        questionsWithAnswers.forEach((q) => {
            const answerIndex = paper.questions.findIndex(pq => pq.id === q.id) + 1;
            const lines = doc.splitTextToSize(`${answerIndex}. ${q.answer}`, maxLineWidth);
            const textHeight = lines.length * 4.5;
            checkPageBreak(textHeight + 2);
            doc.text(lines, margin, y);
            y += textHeight + 2;
        });
    }

    doc.save(`${paper.title.replace(/ /g, '_')}.pdf`);
  };

  const handleExportWord = async (paper: Paper) => {
    if (!paper) return;

    try { await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js"); }
    catch (error) { showToast("Failed to load export library.", "error"); return; }
    if (!window.marked) { showToast("Export library not available.", "error"); return; }

    let htmlContent = `<html><head><meta charset="UTF-8"></head><body><h1>${paper.title}</h1><p>Class: ${paper.class}, Year: ${paper.year}, Semester: ${paper.semester}</p><hr />`;
    
    const urls = paper.data_urls || (paper.data_url ? [paper.data_url] : []);
    const types = paper.file_types || (paper.file_type ? [paper.file_type] : []);
    urls.forEach((url, index) => {
        if (types[index]?.startsWith('image/')) {
            htmlContent += `<p><img src="${url}" alt="Page ${index + 1}" style="max-width: 100%; height: auto;" /></p>`;
        }
    });

    if (paper.text) htmlContent += window.marked.parse(paper.text);

    if (paper.questions.length > 0) {
        paper.questions.forEach((q, index) => {
            htmlContent += `<p><strong>${index + 1}.</strong> ${q.text} <em>(${q.marks} ${t('marks', lang)})</em></p>`;
            if (q.image_data_url) htmlContent += `<p><img src="${q.image_data_url}" alt="Question Image" style="max-width: 400px; height: auto;" /></p>`;
        });

        if (paper.questions.some(q => q.answer)) {
            htmlContent += `<hr /><h2>${t('answerKey', lang)}</h2>`;
            paper.questions.forEach((q, index) => {
                if (q.answer) htmlContent += `<p><strong>${index + 1}.</strong> ${q.answer}</p>`;
            });
        }
    }

    if (paper.grounding_sources?.length) {
        htmlContent += `<hr /><h2>${t('sources', lang)}</h2>`;
        paper.grounding_sources.forEach(source => { htmlContent += `<p><a href="${source.uri}">${source.title || source.uri}</a></p>`; });
    }

    htmlContent += '</body></html>';
    const blob = new Blob([`\ufeff${htmlContent}`], { type: 'application/msword' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${paper.title.replace(/ /g, '_')}.doc`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  
  const renderClassSelection = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {papersByClass.map(({ classNum, count }) => (
            <button key={classNum} onClick={() => setSelectedClass(classNum)}
                className="flex flex-col items-center justify-center p-6 bg-white rounded-xl shadow-sm border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all transform hover:-translate-y-1">
                <span className="text-4xl font-bold font-serif-display text-indigo-600">{classNum}</span>
                <span className="text-lg font-semibold text-slate-700 mt-1">Class {classNum}</span>
                <span className="text-sm text-slate-500">{count} {count === 1 ? 'Paper' : 'Papers'}</span>
            </button>
        ))}
    </div>
  );

  const renderPaperList = () => (
    <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-slate-200">
        <div className="flex items-center mb-4">
            <button onClick={() => setSelectedClass(null)} className="flex items-center text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l-4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                Back
            </button>
            <h3 className="flex-grow text-center font-bold text-xl text-slate-800">Archive for Class {selectedClass}</h3>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 p-3 bg-slate-50 rounded-lg border">
            <input type="text" placeholder="Search by title..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-2 border border-slate-300 bg-white rounded-lg" />
            <select value={filterYear} onChange={e => setFilterYear(e.target.value ? Number(e.target.value) : '')} className="w-full p-2 border rounded-lg bg-white">
                <option value="">All Years</option>
                {uniqueYearsInClass.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={filterSemester} onChange={e => setFilterSemester(e.target.value as Semester | '')} className="w-full p-2 border rounded-lg bg-white">
                <option value="">All Semesters</option>
                {SEMESTERS.map(s => <option key={s} value={s}>Sem {s}</option>)}
            </select>
        </div>

        {/* Paper List */}
        <div className="divide-y divide-slate-100">
            {filteredAndPaginatedPapers.paginatedPapers.map(paper => (
                <div key={paper.id} className="p-3 rounded-lg hover:bg-slate-50 transition-colors group">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-semibold text-slate-800">{paper.title}</p>
                            <p className="text-sm text-slate-500">{t(paper.source, lang)} - {new Date(paper.created_at).toLocaleString()}</p>
                        </div>
                        <div className="space-x-3 flex-shrink-0">
                            <button onClick={() => onAssignPaper(paper)} className="text-purple-600 hover:text-purple-800 text-sm font-semibold">Assign</button>
                            <button onClick={() => setViewingPaper(paper)} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">{t('view', lang)}</button>
                            <button onClick={() => onDeletePaper(paper.id)} className="text-red-600 hover:text-red-800 text-sm font-semibold">{t('delete', lang)}</button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
        
        {filteredAndPaginatedPapers.totalCount === 0 && (
            <div className="text-center py-10 text-slate-500"><p>No papers match your filters.</p></div>
        )}

        {/* Pagination */}
        {filteredAndPaginatedPapers.totalPages > 1 && (
            <div className="flex justify-between items-center mt-4 pt-4 border-t">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 disabled:opacity-50">Previous</button>
                <span className="text-sm font-semibold text-slate-600">
                    Page {currentPage} of {filteredAndPaginatedPapers.totalPages}
                </span>
                <button onClick={() => setCurrentPage(p => Math.min(filteredAndPaginatedPapers.totalPages, p + 1))} disabled={currentPage === filteredAndPaginatedPapers.totalPages}
                    className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 disabled:opacity-50">Next</button>
            </div>
        )}
  </div>
  );

  const renderViewingPaperContent = () => {
    if (!viewingPaper) return null;

    const urls = viewingPaper.data_urls || (viewingPaper.data_url ? [viewingPaper.data_url] : []);
    const types = viewingPaper.file_types || (viewingPaper.file_type ? [viewingPaper.file_type] : []);

    const hasContentToExport = (viewingPaper.questions && viewingPaper.questions.length > 0) || viewingPaper.text;
    const questionsWithAnswers = viewingPaper.questions.filter(q => q.answer);

    return (
      <>
        <div>
          {urls.length > 0 && (
            <div className="space-y-4 mb-6 bg-slate-100 p-4 rounded-lg">
              {urls.map((url, index) => {
                const fileType = types[index] || '';
                if (fileType.startsWith('image/')) {
                  return <img key={index} src={url} alt={`Page ${index + 1}`} className="max-w-full h-auto rounded-md border" />;
                } else if (fileType === 'application/pdf') {
                  return <iframe key={index} src={url} className="w-full h-[60vh] border" title={`Page ${index + 1}`}></iframe>;
                }
                return null;
              })}
            </div>
          )}

          {viewingPaper.text && <div className="bg-slate-50 p-4 rounded-lg border mb-4"><MarkdownRenderer content={viewingPaper.text} /></div>}
          
          {viewingPaper.questions.length > 0 && (
            <div className="space-y-4 prose max-w-none prose-slate">
                {viewingPaper.questions.map((q, i) => (
                    <div key={q.id}>
                        {q.image_data_url && <img src={q.image_data_url} alt="Question" className="max-w-md mx-auto rounded-lg border my-2" />}
                        <p><strong>{i + 1}.</strong> {q.text} <span className="text-sm text-slate-500">({q.marks} ${t('marks', lang)})</span></p>
                    </div>
                ))}
            </div>
          )}

          {questionsWithAnswers.length > 0 && (
            <div className="mt-8 pt-4 border-t border-slate-200">
                <h3 className="text-lg font-bold font-serif-display text-slate-800 mb-3">{t('answerKey', lang)}</h3>
                <div className="prose max-w-none prose-slate space-y-2">
                    {viewingPaper.questions.map((q, index) => (
                        q.answer ? (
                            <p key={`ans-${q.id}`}><strong>{index + 1}.</strong> {q.answer}</p>
                        ) : null
                    ))}
                </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
          {hasContentToExport && (
            <>
              <button onClick={() => handleExportWord(viewingPaper)} className="px-4 py-2 bg-blue-700 text-white font-semibold rounded-lg text-sm">{t('exportWord', lang)}</button>
              <button onClick={() => handleExportPDF(viewingPaper)} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg text-sm">{t('exportPDF', lang)}</button>
            </>
          )}
        </div>
      </>
    );
  };
  
  const inputStyles = "w-full p-2 border rounded-lg border-slate-300 bg-slate-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 transition";

  return (
    <div className="p-2 sm:p-4 space-y-4">
      {/* Hidden input for the quick upload feature */}
      <input
        type="file"
        ref={quickUploadInputRef}
        multiple
        className="hidden"
        onChange={handleQuickUploadFileSelection}
        accept={ACCEPTED_MIME_TYPES.join(',')}
      />

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between">
        <h3 className="font-bold text-lg text-slate-800">{selectedClass ? `Archive for Class ${selectedClass}` : t('archive', lang)}</h3>
        <div className="flex gap-2">
            <button
                onClick={openUploadModal}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                <span>Upload Paper</span>
            </button>
            <button
                onClick={handleQuickUploadClick}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-sm hover:bg-green-700 transition-all"
                title="Upload another paper"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                <span>Quick Upload</span>
            </button>
        </div>
      </div>

      {selectedClass === null ? renderClassSelection() : renderPaperList()}
      
      {papers.length === 0 && !selectedClass && <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500 mt-4"><p>{t('noPapers', lang)}</p></div>}
      
      <Modal 
        isOpen={isUploadModalOpen} 
        onClose={() => {
            if (isUploading) {
                handleCancelUpload();
            } else {
                setUploadModalOpen(false);
                setUploadProgress(null);
                setIndividualFileProgress([]);
            }
        }} 
        title={t('uploadNewPaper', lang)}
      >
        {!uploadProgress ? (
            <div className="space-y-4">
                <input type="text" placeholder={`${t('paperTitle', lang)} (Optional)`} value={uploadData.title} onChange={(e) => setUploadData(prev => ({ ...prev, title: e.target.value }))} className={inputStyles} />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Board</label>
                        <select value={uploadData.board} onChange={(e) => setUploadData(prev => ({ ...prev, board: e.target.value, subject: '' }))} className={inputStyles}>
                            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Class</label>
                        <select value={uploadData.class} onChange={(e) => setUploadData(prev => ({ ...prev, class: parseInt(e.target.value), subject: '' }))} className={inputStyles}>
                            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600">Subject</label>
                    <select value={uploadData.subject} onChange={(e) => setUploadData(prev => ({ ...prev, subject: e.target.value }))} className={inputStyles} disabled={loadingSubjects || subjects.length === 0}>
                        {loadingSubjects ? <option>Loading subjects...</option> : subjects.length === 0 ? <option>Subject not found (can edit later)</option> : subjects.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Year</label>
                        <select value={uploadData.year} onChange={(e) => setUploadData(prev => ({ ...prev, year: parseInt(e.target.value) }))} className={inputStyles}>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Semester</label>
                        <select value={uploadData.semester} onChange={(e) => setUploadData(prev => ({ ...prev, semester: e.target.value as Semester }))} className={inputStyles}>
                            {SEMESTERS.map(s => <option key={s} value={s}>{`Sem ${s}`}</option>)}
                        </select>
                    </div>
                </div>
                 <label
                    htmlFor="file-upload-archive"
                    className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
                    onDragEnter={(e) => handleDragEvents(e, 'enter')}
                    onDragOver={(e) => handleDragEvents(e, 'enter')}
                    onDragLeave={(e) => handleDragEvents(e, 'leave')}
                    onDrop={(e) => handleDragEvents(e, 'drop')}
                >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6 text-center">
                        <svg className="w-10 h-10 mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-4-4V7a4 4 0 014-4h.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V16m-4-8V5m0 11v-5m-4 5h12"></path></svg>
                        <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                        <p className="text-xs text-slate-400">PDF, DOCX, JPG, PNG, GIF (MAX {MAX_FILES} files, {MAX_FILE_SIZE_MB}MB each)</p>
                    </div>
                    <input id="file-upload-archive" ref={modalFileInputRef} type="file" multiple className="hidden" onChange={handleFileSelection} accept={ACCEPTED_MIME_TYPES.join(',')} />
                </label>
                {selectedFiles && Array.from(selectedFiles).length > 0 && (
                    <div className="text-sm bg-slate-100 p-2 rounded-md border text-slate-600">
                        <p className="font-semibold">Selected:</p>
                        <ul className="list-disc list-inside">
                            {Array.from(selectedFiles).map((file, index) => <li key={index} className="truncate">{(file as File).name}</li>)}
                        </ul>
                    </div>
                )}
                <div className="flex justify-end pt-4 border-t">
                    <button
                        onClick={() => { setUploadModalOpen(false); setSelectedFiles(null); setIndividualFileProgress([]); }}
                        className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium transition-colors mr-3"
                    >
                        {t('cancel', lang)}
                    </button>
                    <button
                        onClick={handleUploadSubmit}
                        disabled={!selectedFiles || selectedFiles.length === 0 || loadingSubjects}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm disabled:bg-indigo-300 disabled:cursor-not-allowed"
                    >
                        {loadingSubjects ? 'Loading...' : 'Upload'}
                    </button>
                </div>
            </div>
        ) : uploadProgress.error ? (
             <div className="text-center p-4">
                <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </div>
                <h3 className="font-semibold text-lg text-red-600 mt-3">Upload Failed</h3>
                <p className="text-red-600 mt-2 bg-red-50 p-3 rounded-lg text-sm">{uploadProgress.error}</p>
                <div className="mt-6 flex justify-center gap-3">
                    <button onClick={() => { setUploadModalOpen(false); setUploadProgress(null); setIndividualFileProgress([]); }} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium">
                        Close
                    </button>
                    <button onClick={() => setUploadProgress(null)} className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">
                        Try Again
                    </button>
                </div>
            </div>
        ) : (
             <div className="p-4">
                <h3 className="font-semibold text-lg text-center mb-4">{isCancelling ? 'Cancelling Upload...' : t('fileUploadProgress', lang)}</h3>
                <div className="relative pt-1">
                    <div className="flex mb-2 items-center justify-between text-xs">
                        <span className="font-semibold text-indigo-600 truncate pr-2">
                            {uploadProgress.completed + 1 > uploadProgress.total ? "Finalizing..." : `File ${uploadProgress.completed + 1} of ${uploadProgress.total}: ${uploadProgress.currentFile}`}
                        </span>
                        <span className="font-semibold text-indigo-600">
                            {Math.round(((uploadProgress.completed) / uploadProgress.total) * 100)}%
                        </span>
                    </div>
                    <div className="overflow-hidden h-3 text-xs flex rounded bg-indigo-200">
                        <div style={{ width: `${((uploadProgress.completed) / uploadProgress.total) * 100}%` }} className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-indigo-500 transition-all duration-500"></div>
                    </div>
                </div>

                <div className="mt-6 border-t pt-4 border-slate-200 space-y-2 max-h-48 overflow-y-auto">
                    <h4 className="text-md font-semibold text-slate-700 mb-2">Individual Files:</h4>
                    {individualFileProgress.map(file => {
                        const fileStatus = file.status;
                        return (
                            <div key={file.name} className="flex items-center justify-between text-sm p-2 bg-slate-100 rounded-md">
                                <span className="truncate text-slate-700">{file.name}</span>
                                <div className={`flex items-center gap-2 font-medium ${
                                    fileStatus === 'completed' ? 'text-green-600' :
                                    fileStatus === 'failed' ? 'text-red-600' :
                                    fileStatus === 'uploading' ? 'text-indigo-600' : 'text-slate-500'
                                }`}>
                                    <div className="w-4 h-4 flex items-center justify-center">
                                        {fileStatus === 'uploading' ? <div className="w-4 h-4 border-2 border-t-transparent border-indigo-500 rounded-full animate-spin"></div> :
                                         fileStatus === 'completed' ? <span className="text-green-500 text-lg">✓</span> :
                                         fileStatus === 'failed' ? <span className="text-red-500 text-lg">✗</span> :
                                         <span className="text-slate-500">🕒</span>}
                                    </div>
                                    <span>{fileStatus.charAt(0).toUpperCase() + fileStatus.slice(1)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="flex justify-center mt-6">
                    <button onClick={handleCancelUpload} disabled={isCancelling} className="px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-700 disabled:bg-red-300 disabled:cursor-wait">
                      {isCancelling ? 'Cancelling...' : 'Cancel Upload'}
                    </button>
                </div>
            </div>
        )}
      </Modal>

      <Modal isOpen={viewingPaper !== null} onClose={() => setViewingPaper(null)} title={viewingPaper?.title || ''}>
        {renderViewingPaperContent()}
      </Modal>
    </div>
  );
};

export default ExamArchive;
