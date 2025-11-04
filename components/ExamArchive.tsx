import React, { useState, useMemo, ChangeEvent, useRef, useEffect } from 'react';
import { Paper, QuestionSource, Semester, UploadProgress } from '../types';
import { t } from '../utils/localization';
import Modal from './Modal';
import { CLASSES, SEMESTERS, YEARS } from '../constants';
import { getBengaliFontBase64, getDevanagariFontBase64, getKannadaFontBase64 } from '../utils/fontData';
import { loadScript } from '../utils/scriptLoader';

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
  onUploadPaper: (paper: Paper, files: FileList, onProgress: (progress: UploadProgress | null) => void, options: { signal: AbortSignal }) => Promise<void>;
  lang: 'en' | 'bn' | 'hi' | 'kn';
  onFileImport: (e: React.ChangeEvent<HTMLInputElement>, fileType: 'pdf' | 'csv' | 'txt' | 'image') => void;
  isProcessingFile: boolean;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const PaperItem: React.FC<{ paper: Paper; onDelete: () => void; onView: () => void; lang: 'en' | 'bn' | 'hi' | 'kn' }> = ({ paper, onDelete, onView, lang }) => (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors">
        <div>
            <p className="font-semibold text-slate-800">{paper.title}</p>
            <p className="text-sm text-slate-500">{t(paper.source, lang)} - {new Date(paper.created_at).toLocaleString()}</p>
        </div>
        <div className="space-x-3">
            <button onClick={onView} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">{t('view', lang)}</button>
            <button onClick={onDelete} className="text-red-600 hover:text-red-800 text-sm font-semibold">{t('delete', lang)}</button>
        </div>
    </div>
);

const initialUploadState = {
  title: '',
  year: new Date().getFullYear(),
  class: 10,
  semester: Semester.First,
};

type ActionButtonType = 'pdf' | 'csv' | 'txt' | 'image' | 'word';

const ActionButton: React.FC<{
    onClick: () => void,
    disabled: boolean,
    isAnimating: boolean,
    emoji: string,
    label: string,
    gradient: string
}> = ({ onClick, disabled, isAnimating, emoji, label, gradient }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`flex flex-col items-center justify-center p-2 rounded-lg text-white shadow-md transform transition-all duration-300 hover:scale-105 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 w-16 h-16 ${gradient}`}
    >
        <span className={`text-xl ${isAnimating ? 'animate-pulse-once' : ''}`}>{emoji}</span>
        <span className="text-xs font-bold mt-1">{label}</span>
    </button>
);


const ExamArchive: React.FC<ExamArchiveProps> = ({ papers, onDeletePaper, onUploadPaper, lang, onFileImport, isProcessingFile, showToast }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadData, setUploadData] = useState(initialUploadState);
  const [viewingPaper, setViewingPaper] = useState<Paper | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const [animatingButton, setAnimatingButton] = useState<ActionButtonType | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  
  const pdfUploadRef = useRef<HTMLInputElement>(null);
  const csvUploadRef = useRef<HTMLInputElement>(null);
  const txtUploadRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);

  type PaperGroup = { year: number; classNum: number; semester: Semester; papers: Paper[] };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
            setIsActionMenuOpen(false);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const triggerAnimation = (type: ActionButtonType) => {
    setAnimatingButton(type);
    setTimeout(() => setAnimatingButton(null), 500); // Animation duration
  };

  const handleActionClick = (type: ActionButtonType) => {
    triggerAnimation(type);
    switch (type) {
        case 'pdf': pdfUploadRef.current?.click(); break;
        case 'csv': csvUploadRef.current?.click(); break;
        case 'txt': txtUploadRef.current?.click(); break;
        case 'image': imageUploadRef.current?.click(); break;
        case 'word': showToast(t('wordSupportComingSoon', lang), 'success'); break;
    }
  };

  const groupedPapers = useMemo(() => {
    return papers.reduce((acc, paper) => {
      const year = paper.year;
      const classNum = paper.class;
      const semester = paper.semester;
      const key = `${year}-${classNum}-${semester}`;
      if (!acc[key]) {
        acc[key] = { year, classNum, semester, papers: [] };
      }
      acc[key].papers.push(paper);
      return acc;
    }, {} as Record<string, PaperGroup>);
  }, [papers]);

  const sortedGroups = (Object.values(groupedPapers) as PaperGroup[]).sort((a,b) => b.year - a.year || b.classNum - a.classNum);

  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };
  
  const expandAll = () => {
    const allKeys = sortedGroups.reduce((acc, group) => ({...acc, [`${group.year}-${group.classNum}-${group.semester}`]: true}), {});
    setExpanded(allKeys);
  }
  
  const collapseAll = () => {
    setExpanded({});
  }
  
  const openUploadModal = () => {
    setUploadData(initialUploadState);
    setUploadProgress(null);
    setIsCancelling(false);
    setUploadModalOpen(true);
  };

  const handleFilesSelectAndUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const firstFile = files[0];
    const titleToUse = uploadData.title.trim() || (firstFile.name.split('.').slice(0, -1).join('.') || firstFile.name);

    const newPaper: Paper = {
      id: new Date().toISOString(), // Use client-side generated ID for folder naming
      title: titleToUse,
      year: uploadData.year,
      class: uploadData.class,
      semester: uploadData.semester,
      source: QuestionSource.Upload,
      created_at: new Date().toISOString(),
      questions: [],
    };

    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    setIsUploading(true);
    setIsCancelling(false);
    setUploadProgress({ total: files.length, completed: 0, pending: files.length, currentFile: files[0].name });

    let uploadOk = false;
    try {
      await onUploadPaper(newPaper, files, setUploadProgress, { signal: controller.signal });
      uploadOk = true;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            uploadOk = true; // Cancellation is an "ok" outcome for UI flow
            console.log('Upload cancelled by user.');
        } else {
          // The parent component (TeacherApp) now handles user-facing toasts.
          // This log helps debug that an error was caught here before being re-thrown.
          console.error("Upload failed in component:", error.message);
        }
    } finally {
      setIsUploading(false);
      setIsCancelling(false);
      // Only close the modal automatically if the process completed successfully or was cancelled.
      if (uploadOk) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Show 100% for a moment
          setUploadModalOpen(false);
          setUploadProgress(null);
      }
      uploadAbortControllerRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    if (uploadAbortControllerRef.current) {
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
        // You might want to show a toast message to the user here.
        return;
    }

    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let fontName = 'helvetica';
    if (lang === 'bn') {
        const fontData = await getBengaliFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData);
            doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal');
            fontName = 'NotoSansBengali';
        } else {
            console.error('Could not load Bengali font for PDF.');
        }
    } else if (lang === 'hi') {
        const fontData = await getDevanagariFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData);
            doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal');
            fontName = 'NotoSansDevanagari';
        } else {
            console.error('Could not load Hindi font for PDF.');
        }
    } else if (lang === 'kn') {
        const fontData = await getKannadaFontBase64();
        if (fontData) {
            doc.addFileToVFS('NotoSansKannada-Regular.ttf', fontData);
            doc.addFont('NotoSansKannada-Regular.ttf', 'NotoSansKannada', 'normal');
            fontName = 'NotoSansKannada';
        } else {
            console.error('Could not load Kannada font for PDF.');
        }
    }

    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const maxLineWidth = pageWidth - margin * 2;
    let y = margin;

    const checkPageBreak = (neededHeight: number) => {
        if (y + neededHeight > pageHeight - margin) {
            doc.addPage();
            y = margin;
        }
    };
    
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
                    const imgWidth = 80;
                    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                    checkPageBreak(imgHeight + 5);
                    doc.addImage(q.image_data_url, 'JPEG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 5;
                } catch(e) {
                    console.error("Error adding image to PDF:", e);
                }
            }

            const lines = doc.splitTextToSize(questionText, maxLineWidth);
            const textHeight = lines.length * 4.5;
            checkPageBreak(textHeight + 3);
            doc.text(lines, margin, y);
            y += textHeight + 3;
        });
    }

    if (paper.grounding_sources && paper.grounding_sources.length > 0) {
        const sourcesTitle = t('sources', lang);
        checkPageBreak(8 + 3 + 4.5);
        y += 8;
        doc.setFontSize(12);
        doc.setFont(fontName, 'bold');
        doc.text(sourcesTitle, margin, y);
        y += 6 + 2;
        doc.setFontSize(8);
        doc.setFont(fontName, 'normal');
        paper.grounding_sources.forEach(source => {
            const sourceText = `${source.title || 'Untitled'}: ${source.uri}`;
            const lines = doc.splitTextToSize(sourceText, maxLineWidth);
            const textHeight = lines.length * 4;
            checkPageBreak(textHeight + 2);
            doc.textWithLink(source.title || source.uri, margin, y, { url: source.uri });
            y += textHeight + 2;
        });
    }

    const questionsWithAnswers = paper.questions.filter(q => q.answer);
    if (questionsWithAnswers.length > 0) {
        const answerKeyTitle = t('answerKey', lang);
        checkPageBreak(8 + 3 + 4.5);
        y += 8;
        doc.setFontSize(12);
        doc.setFont(fontName, 'bold');
        doc.text(answerKeyTitle, margin, y);
        y += 6 + 2;
        doc.setFontSize(10);
        doc.setFont(fontName, 'normal');

        questionsWithAnswers.forEach((q) => {
            const answerIndex = paper.questions.findIndex(pq => pq.id === q.id) + 1;
            const answerText = `${answerIndex}. ${q.answer}`;
            const lines = doc.splitTextToSize(answerText, maxLineWidth);
            const textHeight = lines.length * 4.5;
            checkPageBreak(textHeight + 2);
            doc.text(lines, margin, y);
            y += textHeight + 2;
        });
    }

    doc.save(`${paper.title.replace(/ /g, '_')}.pdf`);
  };

  const handleExportTXT = (paper: Paper) => {
    if (!paper) return;

    let content = `${paper.title}\n`;
    content += `Class: ${paper.class}, Year: ${paper.year}, Semester: ${paper.semester}\n`;
    content += `Source: ${t(paper.source, lang)}\n`;
    content += '====================================\n\n';

    if (paper.text) {
        content += paper.text + '\n\n';
    }

    if (paper.questions.length > 0) {
        content += `Total Marks: ${paper.questions.reduce((acc, q) => acc + q.marks, 0)}\n\n`;
        paper.questions.forEach((q, index) => {
            content += `${index + 1}. ${q.text} (${q.marks} ${t('marks', lang)})\n\n`;
            if (q.image_data_url) {
                content += `[Image-based question. Image not included in text export.]\n\n`;
            }
        });
    }

    const questionsWithAnswers = paper.questions.filter(q => q.answer);
    if (questionsWithAnswers.length > 0) {
        content += '====================================\n';
        content += `${t('answerKey', lang)}\n`;
        content += '====================================\n\n';
        questionsWithAnswers.forEach((q) => {
            const answerIndex = paper.questions.findIndex(pq => pq.id === q.id) + 1;
            content += `${answerIndex}. ${q.answer}\n`;
        });
        content += '\n';
    }

    if (paper.grounding_sources && paper.grounding_sources.length > 0) {
        content += '====================================\n';
        content += `${t('sources', lang)}\n`;
        content += '====================================\n\n';
        paper.grounding_sources.forEach(source => {
            content += `${source.title || 'Untitled'}: ${source.uri}\n`;
        });
        content += '\n';
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${paper.title.replace(/ /g, '_')}.txt`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
    
  const handleExportXLSX = async (paper: Paper) => {
    if (!paper) return;

    try {
        await loadScript("https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js");
    } catch (error) {
        console.error("Failed to load XLSX library", error);
        return;
    }

    const XLSX = (window as any).XLSX;
    const wb = XLSX.utils.book_new();

    if (paper.questions.length > 0) {
        const questionData = paper.questions.map((q, index) => ({
            'No.': index + 1,
            'Question': q.image_data_url ? `[Image-based question] ${q.text}` : q.text,
            'Marks': q.marks,
        }));
        const questionSheet = XLSX.utils.json_to_sheet(questionData);
        XLSX.utils.book_append_sheet(wb, questionSheet, 'Questions');

        const answerData = paper.questions
            .filter(q => q.answer)
            .map((q) => ({
                'No.': paper.questions.findIndex(pq => pq.id === q.id) + 1,
                'Answer': q.answer,
            }));
        
        if (answerData.length > 0) {
            const answerSheet = XLSX.utils.json_to_sheet(answerData);
            XLSX.utils.book_append_sheet(wb, answerSheet, 'Answer Key');
        }
        
        const sourceData = (paper.grounding_sources || []).map(s => ({
            'Title': s.title,
            'URL': s.uri,
        }));

        if (sourceData.length > 0) {
            const sourceSheet = XLSX.utils.json_to_sheet(sourceData);
            XLSX.utils.book_append_sheet(wb, sourceSheet, 'Sources');
        }

        XLSX.writeFile(wb, `${paper.title.replace(/ /g, '_')}.xlsx`);
    }
  };
    
    return (
      <div className="p-2 sm:p-4 space-y-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div ref={actionMenuRef} className="relative">
                <button
                    onClick={() => setIsActionMenuOpen(prev => !prev)}
                    disabled={isProcessingFile}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-600 text-white font-semibold rounded-lg shadow-sm hover:bg-slate-700 transition-all disabled:opacity-60"
                >
                    <span className="text-lg">⚡</span>
                    <span>Quick Import</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${isActionMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
                {isActionMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-20 p-2">
                        <div className="grid grid-cols-3 gap-2">
                            <ActionButton onClick={() => handleActionClick('pdf')} disabled={isProcessingFile} isAnimating={animatingButton === 'pdf'} emoji="📄" label={t('uploadPDF', lang)} gradient="bg-gradient-to-br from-red-500 to-orange-500 focus:ring-orange-300" />
                            <ActionButton onClick={() => handleActionClick('csv')} disabled={isProcessingFile} isAnimating={animatingButton === 'csv'} emoji="📊" label={t('uploadCSV', lang)} gradient="bg-gradient-to-br from-green-500 to-emerald-500 focus:ring-emerald-300" />
                            <ActionButton onClick={() => handleActionClick('txt')} disabled={isProcessingFile} isAnimating={animatingButton === 'txt'} emoji="📝" label={t('uploadTXT', lang)} gradient="bg-gradient-to-br from-blue-500 to-cyan-500 focus:ring-cyan-300" />
                            <ActionButton onClick={() => handleActionClick('image')} disabled={isProcessingFile} isAnimating={animatingButton === 'image'} emoji="📷" label={t('scanImage', lang)} gradient="bg-gradient-to-br from-purple-500 to-pink-500 focus:ring-pink-300" />
                            <ActionButton onClick={() => handleActionClick('word')} disabled={isProcessingFile} isAnimating={animatingButton === 'word'} emoji="📖" label={t('uploadWord', lang)} gradient="bg-gradient-to-br from-sky-500 to-blue-600 focus:ring-sky-300" />
                        </div>
                    </div>
                )}
            </div>
          <button
            onClick={openUploadModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-60"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
            {t('uploadNewPaper', lang)}
          </button>
          <div className="flex items-center space-x-2">
            <button onClick={expandAll} className="text-sm font-semibold text-slate-600 hover:text-indigo-700">{t('expandAll', lang)}</button>
            <button onClick={collapseAll} className="text-sm font-semibold text-slate-600 hover:text-indigo-700">{t('collapseAll', lang)}</button>
          </div>
        </div>

        {sortedGroups.length > 0 ? (
          <div className="space-y-4">
            {sortedGroups.map(group => {
              const key = `${group.year}-${group.classNum}-${group.semester}`;
              return (
                <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200">
                  <button onClick={() => toggleExpand(key)} className="w-full flex justify-between items-center p-4 text-left">
                    <h2 className="font-bold text-lg text-slate-800">{`${group.year} - ${t('class', lang)} ${group.classNum} - ${t('semester', lang)} ${group.semester}`}</h2>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-slate-500 transition-transform ${expanded[key] ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
                  {expanded[key] && (
                    <div className="px-4 pb-2 divide-y divide-slate-200">
                      {group.papers.map(paper => (
                        <PaperItem key={paper.id} paper={paper} onDelete={() => onDeletePaper(paper.id)} onView={() => setViewingPaper(paper)} lang={lang} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
            <p>{t('noPapers', lang)}</p>
          </div>
        )}
        
        <Modal isOpen={!!viewingPaper} onClose={() => setViewingPaper(null)} title={viewingPaper?.title || ''}>
          {viewingPaper && (
            <div className="space-y-4">
              <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
                {viewingPaper.data_urls && viewingPaper.data_urls.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {viewingPaper.data_urls.map((url, index) => (
                            <img key={index} src={url} alt={`Page ${index + 1}`} className="rounded-lg border border-slate-300 w-full" />
                        ))}
                    </div>
                )}
                {viewingPaper.text && <MarkdownRenderer content={viewingPaper.text} />}
                {viewingPaper.questions.map((q, index) => (
                    <div key={q.id}>
                        {q.image_data_url && <img src={q.image_data_url} alt="Question illustration" className="max-w-xs mx-auto rounded-lg border my-2" />}
                        <p><strong>{index + 1}.</strong> {q.text} <span className="text-sm text-slate-500">({q.marks} {t('marks', lang)})</span></p>
                    </div>
                ))}
                {viewingPaper.grounding_sources && viewingPaper.grounding_sources.length > 0 && (
                    <div className="pt-4 border-t">
                        <h3 className="font-bold text-slate-800 mb-2">{t('sources', lang)}</h3>
                        <ul className="list-disc list-inside text-sm space-y-1">
                            {viewingPaper.grounding_sources.map(s => <li key={s.uri}><a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{s.title || s.uri}</a></li>)}
                        </ul>
                    </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-3 pt-4 border-t">
                <button onClick={() => handleExportTXT(viewingPaper)} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg text-sm">{t('exportTXT', lang)}</button>
                <button onClick={() => handleExportXLSX(viewingPaper)} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm">{t('exportXLSX', lang)}</button>
                <button onClick={() => handleExportPDF(viewingPaper)} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg text-sm">{t('exportPDF', lang)}</button>
              </div>
            </div>
          )}
        </Modal>

        <Modal isOpen={isUploadModalOpen} onClose={() => { if(!isUploading) setUploadModalOpen(false) }} title={t('uploadNewPaper', lang)}>
          {isUploading ? (
            <div className="p-4 text-center">
                <h3 className="text-lg font-bold text-slate-800">{isCancelling ? 'Cancelling...' : t('fileUploadProgress', lang)}</h3>
                {uploadProgress && (
                    <div className="mt-4 space-y-2">
                        <div className="w-full bg-slate-200 rounded-full h-4">
                            <div className="bg-indigo-600 h-4 rounded-full" style={{ width: `${(uploadProgress.completed / uploadProgress.total) * 100}%` }}></div>
                        </div>
                        <p className="text-sm text-slate-600">{t('currentlyProcessing', lang)}: {uploadProgress.currentFile}</p>
                        <p className="text-sm font-semibold text-slate-800">{uploadProgress.completed} / {uploadProgress.total} {t('completed', lang)}</p>
                    </div>
                )}
                <button onClick={handleCancelUpload} disabled={isCancelling} className="mt-6 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg disabled:bg-red-300">
                  {isCancelling ? 'Cancelling...' : 'Cancel Upload'}
                </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div>
                    <label className="block text-sm font-medium text-slate-600">{t('paperTitle', lang)}</label>
                    <input type="text" value={uploadData.title} onChange={e => setUploadData(p => ({...p, title: e.target.value}))} placeholder="Optional, uses filename if blank" className="mt-1 block w-full rounded-lg border-slate-300 bg-slate-50"/>
                </div>
                <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600">{t('year', lang)}</label>
                        <select value={uploadData.year} onChange={e => setUploadData(p => ({...p, year: parseInt(e.target.value)}))} className="mt-1 block w-full rounded-lg border-slate-300 bg-slate-50">
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">{t('class', lang)}</label>
                        <select value={uploadData.class} onChange={e => setUploadData(p => ({...p, class: parseInt(e.target.value)}))} className="mt-1 block w-full rounded-lg border-slate-300 bg-slate-50">
                            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">{t('semester', lang)}</label>
                        <select value={uploadData.semester} onChange={e => setUploadData(p => ({...p, semester: e.target.value as Semester}))} className="mt-1 block w-full rounded-lg border-slate-300 bg-slate-50">
                            {SEMESTERS.map(s => <option key={s} value={s}>{`Sem ${s}`}</option>)}
                        </select>
                    </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600">Select Files (PDF, JPG, PNG)</label>
                  <input type="file" multiple onChange={handleFilesSelectAndUpload} accept="application/pdf,image/jpeg,image/png" className="mt-1 block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                </div>
            </form>
          )}
        </Modal>

        <input type="file" ref={pdfUploadRef} onChange={(e) => onFileImport(e, 'pdf')} className="hidden" accept="application/pdf" />
        <input type="file" ref={csvUploadRef} onChange={(e) => onFileImport(e, 'csv')} className="hidden" accept=".csv" />
        <input type="file" ref={txtUploadRef} onChange={(e) => onFileImport(e, 'txt')} className="hidden" accept="text/plain" />
        <input type="file" ref={imageUploadRef} onChange={(e) => onFileImport(e, 'image')} className="hidden" accept="image/*" />
      </div>
    );
};

export default ExamArchive;
