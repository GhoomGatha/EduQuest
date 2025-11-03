
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { Question, Paper, Tab, Language, Profile, QuestionSource, Difficulty, Semester, UploadProgress } from './types';
import { t } from './utils/localization';
import { TABS, LOCAL_STORAGE_KEY } from './constants';
import Modal from './components/Modal';
import QuestionForm from './components/QuestionForm';
import { useAuth } from './hooks/useAuth';
import { supabase } from './services/supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';
import SecretMessageModal from './components/SecretMessageModal';
import { OPENAI_API_KEY_STORAGE_KEY } from './services/openaiService';
import { extractQuestionsFromImageAI, extractQuestionsFromPdfAI } from './services/geminiService';

const QuestionBank = lazy(() => import('./components/QuestionBank'));
const PaperGenerator = lazy(() => import('./components/PaperGenerator'));
const AITutor = lazy(() => import('./components/AITutor'));
const ExamArchive = lazy(() => import('./components/ExamArchive'));
const Settings = lazy(() => import('./components/Settings'));

const API_KEY_STORAGE_KEY = 'eduquest_user_api_key';
const LANGUAGE_STORAGE_KEY = 'eduquest_lang';

const tabIconAnimations: Record<Tab, string> = {
  bank: 'animate-glow',
  generator: 'animate-sway',
  ai_tutor: 'animate-glow',
  archive: 'animate-bobbing',
  settings: 'animate-slow-spin',
};

const dataURLtoBlob = (dataurl: string): Blob | null => {
    try {
        const arr = dataurl.split(',');
        if (arr.length < 2) return null;

        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) return null;
        
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (error) {
        console.error("Error converting data URL to blob:", error);
        return null;
    }
}

const readFileAsDataURL = (fileToRead: File, signal: AbortSignal): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const abortHandler = () => {
            reader.abort();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        reader.onload = () => {
            signal.removeEventListener('abort', abortHandler);
            resolve(reader.result as string);
        };
        reader.onerror = (error) => {
            signal.removeEventListener('abort', abortHandler);
            reject(error);
        };

        if (signal.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
        }
        signal.addEventListener('abort', abortHandler, { once: true });

        reader.readAsDataURL(fileToRead);
    });
};

interface TeacherAppProps {
    showToast: (message: string, type?: 'success' | 'error') => void;
}

const TeacherApp: React.FC<TeacherAppProps> = ({ showToast }) => {
  const { session, profile, setProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('generator');
  const [lang, setLang] = useState<Language>('en');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [userOpenApiKey, setUserOpenApiKey] = useState<string>('');
  const [isSecretMessageOpen, setSecretMessageOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({});
  const pdfUploadRef = useRef<HTMLInputElement>(null);
  const csvUploadRef = useRef<HTMLInputElement>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);

  const allVisibleQuestions = useMemo(() => {
    // Get all questions that are inside paper objects
    const allQuestionsFromPapers = papers.flatMap(paper => paper.questions || []);
    
    // Combine questions from the main list and from papers
    const combinedQuestions = [...questions, ...allQuestionsFromPapers];

    // Use a Map to deduplicate questions by their ID
    const questionMap = new Map<string, Question>();
    combinedQuestions.forEach(q => {
        // Ensure question is valid and has an ID before adding to the map
        if (q && q.id) {
            questionMap.set(q.id, q);
        }
    });

    // Convert map values back to an array and sort them by creation date
    return Array.from(questionMap.values())
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  }, [questions, papers]);

  useEffect(() => {
    if (navRef.current) {
        const activeTabElement = navRef.current.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement;
        if (activeTabElement) {
            const { offsetLeft, offsetWidth } = activeTabElement;
            setSliderStyle({
                left: `${offsetLeft}px`,
                width: `${offsetWidth}px`,
            });
            activeTabElement.scrollIntoView({
                behavior: 'smooth',
                inline: 'center',
                block: 'nearest'
            });
        }
    }
  }, [activeTab, lang]);


  const handleHeartPressStart = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = window.setTimeout(() => {
      setSecretMessageOpen(true);
    }, 11000); // 11 seconds
  };

  const handleHeartPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  useEffect(() => {
    const savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language;
    if (savedLang) setLang(savedLang);

    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey) setUserApiKey(savedApiKey);
    
    const savedOpenApiKey = localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY);
    if (savedOpenApiKey) setUserOpenApiKey(savedOpenApiKey);
  }, []);

  const fetchData = useCallback(async () => {
    if (session?.user && profile?.id) {
      try {
        const { data: questionsData, error: qError } = await supabase
          .from('questions')
          .select('*')
          .eq('user_id', session.user.id);
        if (qError) throw new Error(`Failed to fetch questions: ${qError.message}`);

        const { data: papersData, error: pError } = await supabase
          .from('papers')
          .select('*')
          .eq('user_id', session.user.id);
        if (pError) throw new Error(`Failed to fetch papers: ${pError.message}`);

        const localDataRaw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (localDataRaw) {
          let migrationSucceeded = false;
          try {
            const localData = JSON.parse(localDataRaw);
            const localQuestions: Question[] = (localData.questions || []).filter(Boolean);
            const localPapers: Paper[] = (localData.papers || []).filter(Boolean);

            const existingQuestionTexts = new Set((questionsData || []).map(q => q.text));
            const questionsToMigrate = localQuestions.filter(q => q.text && !existingQuestionTexts.has(q.text));

            const oldIdToNewQuestionMap = new Map<string, Question>();

            (questionsData || []).forEach(dbQuestion => {
              const localMatch = localQuestions.find(lq => lq.text === dbQuestion.text);
              if (localMatch) {
                oldIdToNewQuestionMap.set(localMatch.id, dbQuestion);
              }
            });

            if (questionsToMigrate.length > 0) {
              const recordsToInsert = questionsToMigrate.map(({ id, created_at, ...q }) => ({ ...q, user_id: session.user!.id }));
              const { data: newQuestions, error: insertQError } = await supabase.from('questions').insert(recordsToInsert).select();
              if (insertQError) throw insertQError;

              questionsToMigrate.forEach((oldQ, index) => {
                oldIdToNewQuestionMap.set(oldQ.id, newQuestions![index]);
              });
            }

            const existingPaperKeys = new Set((papersData || []).map(p => `${p.title}-${p.year}`));
            const papersToMigrate = localPapers.filter(p => p.title && p.year && !existingPaperKeys.has(`${p.title}-${p.year}`));

            if (papersToMigrate.length > 0) {
              const recordsToInsert = papersToMigrate.map(p => {
                const remappedQuestions = (p.questions || []).map(oldQ => oldIdToNewQuestionMap.get(oldQ.id)).filter((q): q is Question => !!q);
                const { id, created_at, ...pData } = p;
                return { ...pData, questions: remappedQuestions, user_id: session.user!.id };
              });
              const { error: insertPError } = await supabase.from('papers').insert(recordsToInsert);
              if (insertPError) throw insertPError;
            }

            if (questionsToMigrate.length > 0 || papersToMigrate.length > 0) {
              migrationSucceeded = true;
            }
          } catch (e: any) {
            console.error("Failed to parse/migrate local data:", e);
            showToast(`Data migration failed: ${e.message}`, 'error');
          } finally {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          }

          if (migrationSucceeded) {
            showToast('Your locally saved data has been synced to your account!', 'success');
            fetchData();
            return;
          }
        }

        setQuestions((questionsData || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
        setPapers((papersData || []).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));

      } catch (error: any) {
        console.error("Data fetch failed:", error);
        showToast(error.message, 'error');
      }
    }
  }, [session, profile?.id, showToast]);


  useEffect(() => {
    fetchData();
  }, [fetchData]);


  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, [lang]);

  const handleAddQuestionClick = () => {
    setEditingQuestion(null);
    setModalOpen(true);
  };

  const handleEditQuestionClick = (question: Question) => {
    setEditingQuestion(question);
    setModalOpen(true);
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!session?.user) return;
    const { error } = await supabase.from('questions').delete().eq('id', id).eq('user_id', session.user.id);
    if (error) {
      showToast('Error deleting question.', 'error');
    } else {
      setQuestions(prev => prev.filter(q => q.id !== id));
      showToast(t('questionDeleted', lang), 'error');
    }
  };

  const handleQuestionSubmit = async (questionData: Question) => {
    if (!session?.user) return;
    
    let finalQuestionData = { ...questionData };

    if (finalQuestionData.image_data_url && finalQuestionData.image_data_url.startsWith('data:')) {
        const blob = dataURLtoBlob(finalQuestionData.image_data_url);
        if (!blob) {
            showToast('Invalid image format.', 'error');
            return;
        }

        const fileExt = blob.type.split('/')[1] || 'png';
        const filePath = `${session.user.id}/${new Date().getTime()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('question_images')
            .upload(filePath, blob);

        if (uploadError) {
            showToast('Error uploading image.', 'error');
            console.error('Image Upload Error:', uploadError);
            return;
        }

        const { data: urlData } = supabase.storage.from('question_images').getPublicUrl(filePath);
        finalQuestionData.image_data_url = urlData.publicUrl;
    }

    if (editingQuestion) {
      const { id, ...questionToUpdate } = { ...finalQuestionData, user_id: session.user.id };
      const { data, error } = await supabase.from('questions').update(questionToUpdate).eq('id', finalQuestionData.id).select();
      if (error || !data) {
        showToast('Error updating question.', 'error');
      } else {
        setQuestions(prev => prev.map(q => q.id === finalQuestionData.id ? data[0] : q));
        showToast(t('questionUpdated', lang));
      }
    } else {
      const { id, ...questionToInsert } = { ...finalQuestionData, user_id: session.user.id };
      const { data, error } = await supabase.from('questions').insert(questionToInsert).select();
      if (error || !data) {
        showToast('Error adding question.', 'error');
        console.error("Error adding question:", error)
      } else {
        setQuestions(prev => [data[0], ...prev]);
        showToast(t('questionAdded', lang));
      }
    }
    setModalOpen(false);
  };

  const postSavePaperProcessing = async (savedPaper: Paper, originalPaper: Paper) => {
    const bankQuestionIdsToUpdate = originalPaper.questions
        .filter(q => q.source !== QuestionSource.Generated)
        .map(q => q.id);

    if (bankQuestionIdsToUpdate.length > 0) {
        const updatePromises: Promise<any>[] = [];
        
        setQuestions(prevQuestions => {
            return prevQuestions.map(q => {
                if (bankQuestionIdsToUpdate.includes(q.id)) {
                    const currentUsedIn = Array.isArray(q.used_in) ? q.used_in : [];
                    const newUsedIn = [...currentUsedIn, { year: originalPaper.year, semester: originalPaper.semester, paperId: savedPaper.id }];
                    
                    updatePromises.push(
                        supabase.from('questions').update({ used_in: newUsedIn }).eq('id', q.id)
                    );
                    return { ...q, used_in: newUsedIn };
                }
                return q;
            });
        });

        try {
            await Promise.all(updatePromises);
        } catch (updateError) {
            console.error("Some questions failed to update 'used_in':", updateError);
            showToast("Error updating some question statuses.", 'error');
        }
    }

    setPapers(prev => [savedPaper, ...prev]);
    showToast(t('paperGenerated', lang));
  };
  
  const handleSavePaper = async (paper: Paper) => {
    if (!session?.user) return;

    try {
        const bankQuestions = paper.questions.filter(q => q.source !== QuestionSource.Generated);
        const newAiQuestions = paper.questions.filter(q => q.source === QuestionSource.Generated);
        let savedNewQuestions: Question[] = [];

        if (newAiQuestions.length > 0) {
            try {
                const processedNewQuestions = await Promise.all(
                    newAiQuestions.map(async (q) => {
                        if (q.image_data_url && q.image_data_url.startsWith('data:')) {
                            const blob = dataURLtoBlob(q.image_data_url);
                            if (blob) {
                                const fileExt = blob.type.split('/')[1] || 'png';
                                const filePath = `${session.user.id}/${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
                                const { error: uploadError } = await supabase.storage.from('question_images').upload(filePath, blob);
                                if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
                                const { data: urlData } = supabase.storage.from('question_images').getPublicUrl(filePath);
                                return { ...q, image_data_url: urlData.publicUrl };
                            }
                        }
                        return q;
                    })
                );

                const questionsToInsert = processedNewQuestions.map(({ id, ...q }) => ({ ...q, user_id: session.user.id }));
                const { data, error } = await supabase.from('questions').insert(questionsToInsert).select();
                if (error) throw error;
                savedNewQuestions = data;
                setQuestions(prev => [...savedNewQuestions, ...prev]);
            } catch (error: any) {
                showToast('Error saving new AI questions to bank.', 'error');
                console.error("Error processing new questions:", error.message || error);
                return;
            }
        }

        const finalPaperQuestions = [...bankQuestions, ...savedNewQuestions];

        const paperToInsert = {
            user_id: session.user.id,
            title: paper.title,
            year: paper.year,
            class: paper.class,
            semester: paper.semester,
            board: paper.board || null,
            source: paper.source,
            file_types: paper.file_types || null,
            text: paper.text || null,
            data_urls: paper.data_urls || null,
            questions: finalPaperQuestions,
            created_at: paper.created_at,
            grounding_sources: paper.grounding_sources || null,
        };

        const { data: savedPaper, error } = await supabase.from('papers').insert(paperToInsert).select().single();
        
        if (error) {
            const isSchemaError = error.message.includes("grounding_sources") && error.message.includes("column");
            if (isSchemaError) {
                console.warn("Attempting to save paper without 'grounding_sources' due to schema mismatch.");
                showToast('Saving without grounding sources due to outdated database schema. Please see Settings to update.', 'error');
                const { grounding_sources, ...fallbackPaperToInsert } = paperToInsert;
                const { data: fallbackSavedPaper, error: fallbackError } = await supabase.from('papers').insert(fallbackPaperToInsert).select().single();
                
                if (fallbackError) {
                    showToast("Error saving paper.", 'error');
                    console.error("Fallback paper save error:", fallbackError?.message);
                    return;
                }
                
                if (!fallbackSavedPaper) {
                    showToast("Error saving paper: could not retrieve the record after creation.", 'error');
                    return;
                }
                await postSavePaperProcessing(fallbackSavedPaper as Paper, paper);
            } else {
                showToast("Error saving paper.", 'error');
                console.error("Error saving paper:", error?.message || "Unknown error occurred.");
            }
            return;
        }
      
        if (!savedPaper) {
            showToast("Error saving paper: could not retrieve the record after creation.", 'error');
            return;
        }
  
        await postSavePaperProcessing(savedPaper as Paper, paper);
    } catch (e) {
        console.error("An unexpected error occurred in handleSavePaper:", e);
        showToast("An unexpected error occurred while saving the paper.", "error");
    }
  };
  
  const handleDeletePaper = async (id: string) => {
    if(!session?.user) return;
    const paperToDelete = papers.find(p => p.id === id);
    if (!paperToDelete) return;

    const { error } = await supabase.from('papers').delete().eq('id', id).eq('user_id', session.user.id);
    if(error){
        showToast('Error deleting paper.', 'error');
        return;
    }

    const questionIdsToUpdate = paperToDelete.questions.map(q => q.id);
    const updatedQuestions = questions.map(q => {
        if(questionIdsToUpdate.includes(q.id)){
            const newUsedIn = q.used_in.filter(use => use.paperId !== id);
            supabase.from('questions').update({ used_in: newUsedIn }).eq('id', q.id).then();
            return { ...q, used_in: newUsedIn };
        }
        return q;
    });

    setQuestions(updatedQuestions);
    setPapers(prev => prev.filter(p => p.id !== id));
    showToast(t('paperDeleted', lang), 'error');
  };

  const handleUploadPaper = async (paper: Paper, files: FileList, onProgress: (progress: UploadProgress | null) => void, options: { signal: AbortSignal }) => {
    try {
        if (!session?.user) throw new Error('User not authenticated.');

        const paperId = paper.id;
        let allExtractedQuestions: Partial<Question>[] = [];
        const uploadedFileUrls: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            onProgress({ total: files.length, completed: i, pending: files.length - i, currentFile: file.name });

            const MAX_FILE_SIZE_MB = 2;
            if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
                throw new Error(`File ${file.name} is too large (max ${MAX_FILE_SIZE_MB}MB).`);
            }
            
            const dataUrl = await readFileAsDataURL(file, options.signal);
            if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');

            let extracted: Partial<Question>[] = [];
            if (file.type.startsWith('image/')) {
                extracted = await extractQuestionsFromImageAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, options.signal);
            } else if (file.type === 'application/pdf') {
                extracted = await extractQuestionsFromPdfAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, options.signal);
            }
            allExtractedQuestions.push(...extracted);

            const storageFilePath = `${session.user.id}/${paperId}/${file.name}`;
            const { error: storageUploadError } = await supabase.storage.from('papers').upload(storageFilePath, file, { upsert: true });
            if (storageUploadError) throw storageUploadError;
            const { data: urlData } = supabase.storage.from('papers').getPublicUrl(storageFilePath);
            uploadedFileUrls.push(urlData.publicUrl);
        }

        if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        
        onProgress({ total: files.length, completed: files.length, pending: 0, currentFile: files[files.length - 1].name });

        let savedQuestions: Question[] = [];
        if (allExtractedQuestions.length > 0) {
            const questionsToInsert = allExtractedQuestions.map(q => ({
                user_id: session.user.id, text: q.text || 'Untitled Question', marks: q.marks || 1, class: paper.class, semester: paper.semester,
                year: paper.year, chapter: 'Uploaded Paper', difficulty: Difficulty.Moderate, source: QuestionSource.Upload, used_in: [], tags: [],
            }));
            const { data, error } = await supabase.from('questions').insert(questionsToInsert).select();
            if (error) throw new Error(`Failed to save extracted questions: ${error.message}`);
            savedQuestions = data || [];
            setQuestions(prev => [...savedQuestions, ...prev]);
        }
        
        const paperToInsert = { 
            ...paper, 
            user_id: session.user.id, 
            questions: savedQuestions, 
            data_urls: uploadedFileUrls, 
            file_types: Array.from(files).map(f => f.type)
        };
        const { data: savedPaper, error: dbError } = await supabase.from('papers').insert(paperToInsert).select().single();
        if (dbError) throw dbError;

        setPapers(prev => [savedPaper, ...prev]);
        showToast(t('uploadSuccess', lang));
        
    } catch (error: any) {
        if (error.name !== 'AbortError') {
            console.error("Error handling paper upload:", error);
            showToast(error.message || 'File upload failed.', 'error');
        }
        throw error;
    } finally {
        onProgress(null);
    }
  };

const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) {
        if (pdfUploadRef.current) pdfUploadRef.current.value = '';
        return;
    }

    if (file.size > 20 * 1024 * 1024) { // 20MB limit
        showToast('PDF file is too large for AI scanning (max 20MB).', 'error');
        if (pdfUploadRef.current) pdfUploadRef.current.value = '';
        return;
    }

    setIsUploadingPdf(true);
    showToast(t('scanningPDF', lang), 'success');

    const reader = new FileReader();
    reader.onload = async (event) => {
        const pdfDataUrl = event.target?.result as string;
        try {
            const extractedQuestions = await extractQuestionsFromPdfAI(pdfDataUrl, 10, lang, userApiKey, userOpenApiKey);
            
            if (extractedQuestions.length === 0) {
                showToast(t('noQuestionsFromPDF', lang), 'error');
                return;
            }

            const questionsToInsert = extractedQuestions.map(q => ({
                user_id: session.user!.id,
                text: q.text || 'Untitled Question',
                marks: q.marks || 1,
                class: 10, // Default class, user can edit later
                semester: Semester.First,
                year: new Date().getFullYear(),
                chapter: 'Uploaded from PDF',
                difficulty: Difficulty.Moderate,
                source: QuestionSource.Upload,
                used_in: [],
                tags: [],
            }));

            const { data: newQuestions, error } = await supabase.from('questions').insert(questionsToInsert).select();
            if (error) throw error;

            setQuestions(prev => [...newQuestions, ...prev]);
            showToast(t('pdfImportSuccess', lang).replace('{count}', String(newQuestions.length)), 'success');

        } catch (error: any) {
            console.error('PDF processing failed:', error);
            showToast(`PDF processing failed: ${error.message}`, 'error');
        } finally {
            setIsUploadingPdf(false);
            if (pdfUploadRef.current) pdfUploadRef.current.value = '';
        }
    };
    reader.onerror = () => {
        setIsUploadingPdf(false);
        showToast("Failed to read the PDF file.", 'error');
        if (pdfUploadRef.current) pdfUploadRef.current.value = '';
    };
    reader.readAsDataURL(file);
};

const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.user) {
        if (csvUploadRef.current) csvUploadRef.current.value = '';
        return;
    }
    setIsUploadingCsv(true);
    try {
        const text = await file.text();
        const rows = text.split('\n').map(r => r.trim()).filter(Boolean);
        const headerRow = rows.shift();
        if (!headerRow) throw new Error('CSV is empty or has no header.');

        const headers = headerRow.split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        const requiredHeaders = ['text', 'marks', 'difficulty', 'class', 'chapter'];
        if (!requiredHeaders.every(h => headers.includes(h))) {
            throw new Error(`CSV must contain headers: ${requiredHeaders.join(', ')}`);
        }
        
        const questionsToInsert = rows.map(row => {
            const values = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, ''));
            const questionObj: any = {};
            headers.forEach((header, i) => {
                questionObj[header] = values[i] || '';
            });

            return {
                user_id: session.user!.id,
                text: questionObj.text,
                answer: questionObj.answer || undefined,
                marks: parseInt(questionObj.marks, 10) || 1,
                difficulty: (Object.values(Difficulty).includes(questionObj.difficulty as Difficulty) ? questionObj.difficulty : Difficulty.Moderate) as Difficulty,
                class: parseInt(questionObj.class, 10) || 10,
                chapter: questionObj.chapter || 'Imported',
                tags: questionObj.tags ? questionObj.tags.split(';').map((t: string) => t.trim()).filter(Boolean) : [],
                source: QuestionSource.Upload,
                year: new Date().getFullYear(),
                semester: Semester.First,
                used_in: [],
            };
        }).filter(q => q.text);

        if (questionsToInsert.length === 0) {
            showToast('No valid questions found in CSV.', 'error');
            return;
        }

        const { data: newQuestions, error } = await supabase.from('questions').insert(questionsToInsert).select();
        if (error) throw error;
        
        setQuestions(prev => [...newQuestions, ...prev]);
        showToast(t('csvImportSuccess', lang).replace('{count}', String(newQuestions.length)), 'success');

    } catch (error: any) {
        console.error("CSV Import Error:", error);
        showToast(t('csvImportFailed', lang), 'error');
    } finally {
        setIsUploadingCsv(false);
        if (csvUploadRef.current) csvUploadRef.current.value = '';
    }
};

  const handleExport = () => {
    const data = JSON.stringify({ questions, papers }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eduquest_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('dataExported', lang));
  };
  
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    showToast("Import is not supported in cloud mode yet.", 'error');
  };

  const handleClear = async () => {
    if(!session?.user) return;
    await supabase.from('questions').delete().eq('user_id', session.user.id);
    await supabase.from('papers').delete().eq('user_id', session.user.id);
    setQuestions([]);
    setPapers([]);
    showToast(t('dataCleared', lang), 'error');
  };
  
  const handleSaveApiKey = (key: string) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
    setUserApiKey(key);
    showToast(t('apiKeySaved', lang));
  };
  
  const handleRemoveApiKey = () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setUserApiKey('');
    showToast(t('apiKeyRemoved', lang), 'error');
  };
  
  const handleSaveOpenApiKey = (key: string) => {
    localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, key);
    setUserOpenApiKey(key);
    showToast('OpenAI API Key saved!', 'success');
  };

  const handleRemoveOpenApiKey = () => {
    localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
    setUserOpenApiKey('');
    showToast('OpenAI API Key removed.', 'error');
  };

  const handleProfileUpdate = async (updatedProfile: Profile, avatarFile?: File) => {
    if (!session?.user) {
        throw new Error("User not authenticated for profile update.");
    }

    try {
        let newAvatarUrl = updatedProfile.avatar_url;
        if (avatarFile) {
            const fileExt = avatarFile.name.split('.').pop();
            const filePath = `${session.user.id}/avatar.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('avatars')
                .upload(filePath, avatarFile, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: urlData } = await supabase.storage.from('avatars').getPublicUrl(filePath);
            newAvatarUrl = `${urlData.publicUrl}?t=${new Date().getTime()}`;
        }
        
        const { id, ...profileUpdates } = updatedProfile;
        const finalProfile = { 
            ...profileUpdates, 
            avatar_url: newAvatarUrl,
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from('profiles').update(finalProfile).eq('id', session.user.id).select().single();
        
        if(error || !data) {
            throw error || new Error('No data returned from profile update');
        }
        
        setProfile(data);
        showToast('Profile updated!', 'success');

    } catch (error: any) {
        console.error("Error updating profile:", error.message || error);
        showToast('Error updating profile.', 'error');
        throw error;
    }
};

  const handleSaveTutorResponse = (query: string, response: string, tutorClass: number) => {
    // This function can be extended to save tutor sessions to a new table `tutor_sessions`
    // For now, it's a placeholder.
    console.log("Tutor response for class", tutorClass, "Query:", query);
  };

  const renderContent = () => {
    return (
      <>
        <div style={{ display: activeTab === 'bank' ? 'block' : 'none' }}>
          <QuestionBank questions={allVisibleQuestions} onAddQuestion={handleAddQuestionClick} onEditQuestion={handleEditQuestionClick} onDeleteQuestion={handleDeleteQuestion} lang={lang} showToast={showToast} />
        </div>
        <div style={{ display: activeTab === 'generator' ? 'block' : 'none' }}>
          <PaperGenerator questions={allVisibleQuestions} onSavePaper={handleSavePaper} lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} />
        </div>
        <div style={{ display: activeTab === 'ai_tutor' ? 'block' : 'none' }}>
           <AITutor lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} onSaveResponse={handleSaveTutorResponse} />
        </div>
        <div style={{ display: activeTab === 'archive' ? 'block' : 'none' }}>
          <ExamArchive papers={papers} onDeletePaper={handleDeletePaper} onUploadPaper={handleUploadPaper} lang={lang} />
        </div>
        <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
           <Settings showToast={showToast} onExport={handleExport} onImport={handleImport} onClear={handleClear} lang={lang} userApiKey={userApiKey} onSaveApiKey={handleSaveApiKey} onRemoveApiKey={handleRemoveApiKey} userOpenApiKey={userOpenApiKey} onSaveOpenApiKey={handleSaveOpenApiKey} onRemoveOpenApiKey={handleRemoveOpenApiKey} profile={profile!} onProfileUpdate={handleProfileUpdate} />
        </div>
      </>
    );
  };

  return (
    <>
      <header className="bg-green-50/80 backdrop-blur-lg shadow-md sticky top-0 z-40 border-b border-green-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 equipment-title-container">
                <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center mr-3 shadow-md">
                    <span className="text-xl microscope-emoji">{t('appHeaderEmoji', lang)}</span>
                </div>
                <span className="font-serif-display animate-text-color-cycle">{t('appHeaderText', lang)}</span>
              </h1>
              <p className="text-sm text-slate-500">{t('appSubtitle', lang)}</p>
            </div>
            <div className="flex items-center space-x-2">
              <select value={lang} onChange={(e) => setLang(e.target.value as Language)} className="p-2 border border-slate-300 rounded-lg bg-white shadow-sm text-sm">
                <option value="en">English</option>
                <option value="bn">বাংলা</option>
                <option value="hi">हिन्दी</option>
              </select>
              {activeTab === 'bank' && (
                <div className="hidden sm:flex items-center space-x-2">
                    <input type="file" ref={pdfUploadRef} onChange={handlePdfUpload} accept="application/pdf" className="hidden" />
                    <input type="file" ref={csvUploadRef} onChange={handleCsvUpload} accept=".csv" className="hidden" />
                    <button
                      onClick={() => csvUploadRef.current?.click()}
                      disabled={isUploadingCsv}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:bg-green-300"
                    >
                      {isUploadingCsv ? t('generating', lang) : t('uploadCSV', lang)}
                    </button>
                    <button
                      onClick={() => pdfUploadRef.current?.click()}
                      disabled={isUploadingPdf}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:bg-purple-300"
                    >
                      {isUploadingPdf ? t('generating', lang) : t('uploadPDF', lang)}
                    </button>
                    <button
                      onClick={handleAddQuestionClick}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold shadow-sm hover:shadow-md hover:-translate-y-px transition-all"
                    >
                      {t('addQuestion', lang)}
                    </button>
                </div>
              )}
            </div>
          </div>
          <nav className="relative pb-2 pt-1">
            <div ref={navRef} className="relative flex items-center bg-slate-200/80 p-1 rounded-full overflow-x-auto no-scrollbar">
              <div
                className="absolute bg-green-50/80 backdrop-blur-lg rounded-full h-10 shadow-md transition-all duration-300 ease-in-out border border-green-200"
                style={sliderStyle}
                aria-hidden="true"
              />
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  data-tab-id={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative z-10 flex-shrink-0 px-3 sm:px-4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 flex items-center justify-center whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'text-indigo-700'
                      : 'text-slate-600 hover:text-slate-800'
                  }`}
                  aria-selected={activeTab === tab.id}
                >
                  <span className={`mr-2 text-lg ${activeTab === tab.id ? tabIconAnimations[tab.id] : ''}`}>{tab.icon}</span>
                  {t(tab.id, lang)}
                </button>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full">
        <Suspense fallback={<LoadingSpinner message={t('loading', lang)} />}>
            {renderContent()}
        </Suspense>
      </main>
      
      {activeTab === 'bank' && (
        <div className="fixed bottom-24 right-4 sm:hidden flex flex-col items-end gap-3 z-30">
          <div className="flex items-center gap-2">
              <span className="bg-slate-800/70 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full">{t('uploadCSV', lang)}</span>
              <button
                onClick={() => csvUploadRef.current?.click()}
                disabled={isUploadingCsv}
                className="bg-green-600 text-white rounded-full p-4 shadow-lg hover:bg-green-700 transition-transform hover:scale-105 disabled:bg-green-300"
                aria-label={t('uploadCSV', lang)}
              >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.172-6.828a1 1 0 011.414 0L9 11.586V3a1 1 0 112 0v8.586l1.414-1.414a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-800/70 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full">{t('uploadPDF', lang)}</span>
              <button
                onClick={() => pdfUploadRef.current?.click()}
                disabled={isUploadingPdf}
                className="bg-purple-600 text-white rounded-full p-4 shadow-lg hover:bg-purple-700 transition-transform hover:scale-105 disabled:bg-purple-300"
                aria-label={t('uploadPDF', lang)}
              >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 7.414V13a1 1 0 11-2 0V7.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-800/70 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1 rounded-full">{t('addQuestion', lang)}</span>
              <button
                onClick={handleAddQuestionClick}
                className="bg-indigo-600 text-white rounded-full p-4 shadow-lg hover:bg-indigo-700 transition-transform hover:scale-105"
                aria-label={t('addQuestion', lang)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
        </div>
      )}

      <footer className="text-center py-4 text-sm text-slate-500 border-t border-green-200 bg-green-50/80 backdrop-blur-lg">
        <p>© {new Date().getFullYear()} {t('appTitle', lang)}. All Rights Reserved.</p>
        <p className="mt-1 text-xs text-slate-400">
          Crafted with{' '}
          <span 
            className="animate-beat animate-text-color-cycle cursor-pointer"
            onMouseDown={handleHeartPressStart}
            onMouseUp={handleHeartPressEnd}
            onMouseLeave={handleHeartPressEnd}
            onTouchStart={handleHeartPressStart}
            onTouchEnd={handleHeartPressEnd}
          >
            ❤️
          </span>
          {' '}for Hiyan by <span className="animate-beat animate-text-color-cycle">Vedant</span> v1.0
        </p>
      </footer>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editingQuestion ? t('editQuestion', lang) : t('addQuestion', lang)}
      >
        <QuestionForm
          onSubmit={handleQuestionSubmit}
          onCancel={() => setModalOpen(false)}
          initialData={editingQuestion}
          lang={lang}
        />
      </Modal>

      <SecretMessageModal isOpen={isSecretMessageOpen} onClose={() => setSecretMessageOpen(false)} />
    </>
  );
};

export default TeacherApp;
