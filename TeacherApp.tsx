import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { Question, Paper, Tab, Language, Profile, QuestionSource, Difficulty, Semester, UploadProgress, TutorSession } from './types';
import { t } from './utils/localization';
import { TABS, LOCAL_STORAGE_KEY } from './constants';
import Modal from './components/Modal';
import QuestionForm from './components/QuestionForm';
import { useAuth } from './hooks/useAuth';
import { supabase } from './services/supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';
import SecretMessageModal from './components/SecretMessageModal';
import { OPENAI_API_KEY_STORAGE_KEY } from './services/openaiService';
// FIX: Import the newly created extractQuestionsFromTextAI function.
import { extractQuestionsFromImageAI, extractQuestionsFromPdfAI, extractQuestionsFromTextAI } from './services/geminiService';

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
  const [tutorSessions, setTutorSessions] = useState<TutorSession[]>([]);
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [userOpenApiKey, setUserOpenApiKey] = useState<string>('');
  const [isSecretMessageOpen, setSecretMessageOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({});
  const [isProcessingFile, setIsProcessingFile] = useState(false);

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

        const { data: tutorSessionsData, error: tError } = await supabase
            .from('tutor_sessions')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false });
        if (tError) throw new Error(`Failed to fetch tutor sessions: ${tError.message}`);
        setTutorSessions(tutorSessionsData || []);

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
                    throw fallbackError;
                }
                
                if (!fallbackSavedPaper) {
                    throw new Error("Error saving paper: could not retrieve the record after creation.");
                }
                await postSavePaperProcessing(fallbackSavedPaper as Paper, paper);
            } else {
                throw error;
            }
            return;
        }
      
        if (!savedPaper) {
            throw new Error("Error saving paper: could not retrieve the record after creation.");
        }
  
        await postSavePaperProcessing(savedPaper as Paper, paper);

    } catch (e: any) {
        console.error("An unexpected error occurred in handleSavePaper:", e);
        showToast(e.message || "An unexpected error occurred while saving the paper.", "error");
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

        const { id: clientSideId, ...paperData } = paper;
        const paperFolderId = clientSideId;
        let allExtractedQuestions: Partial<Question>[] = [];
        const uploadedFileUrls: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            
            onProgress({ total: files.length, completed: i, pending: files.length - i, currentFile: file.name });

            const MAX_FILE_SIZE_MB = 20; // FIX: Increased file size limit for PDFs
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

            const storageFilePath = `${session.user.id}/${paperFolderId}/${file.name}`;
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
        }
        
        const paperToInsert = { 
            ...paperData, 
            user_id: session.user.id, 
            questions: savedQuestions, 
            data_urls: uploadedFileUrls, 
            file_types: Array.from(files).map(f => f.type)
        };
        const { data: savedPaper, error: dbError } = await supabase.from('papers').insert(paperToInsert).select().single();
        if (dbError) throw dbError;

        // FIX: Atomic state updates after all DB operations succeed
        if (savedQuestions.length > 0) {
            setQuestions(prev => [...savedQuestions, ...prev]);
        }
        setPapers(prev => [savedPaper, ...prev]);
        showToast(t('uploadSuccess', lang));
        
    } catch (error: any) {
        if (error.name !== 'AbortError') {
            const errorMessage = error.message || 'An unknown error occurred during upload.';
            console.error("Error handling paper upload:", errorMessage);

            let userFriendlyMessage = 'File upload failed.';
            if (errorMessage.toLowerCase().includes('timed out')) {
                userFriendlyMessage = 'The file took too long to process and timed out. Please try a smaller file or try again later.';
            } else if (errorMessage.toLowerCase().includes('too large')) {
                userFriendlyMessage = errorMessage;
            } else {
                userFriendlyMessage = 'An error occurred while processing the file.';
            }
            
            showToast(userFriendlyMessage, 'error');
        }
        throw error;
    } finally {
        onProgress(null);
    }
  };

const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, fileType: 'pdf' | 'csv' | 'txt' | 'image') => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !session?.user) return;

    setIsProcessingFile(true);
    showToast(`${t('processingFile', lang)}: ${file.name}`);

    try {
        let extractedQuestions: Partial<Question>[] = [];
        if (fileType === 'pdf') {
            if (file.size > 20 * 1024 * 1024) throw new Error('PDF file is too large (max 20MB).');
            const dataUrl = await readFileAsDataURL(file, new AbortController().signal);
            extractedQuestions = await extractQuestionsFromPdfAI(dataUrl, 10, lang, userApiKey, userOpenApiKey);
        } else if (fileType === 'image') {
            if (file.size > 10 * 1024 * 1024) throw new Error('Image file is too large (max 10MB).');
            const dataUrl = await readFileAsDataURL(file, new AbortController().signal);
            extractedQuestions = await extractQuestionsFromImageAI(dataUrl, 10, lang, userApiKey, userOpenApiKey);
        } else if (fileType === 'txt') {
            if (file.size > 2 * 1024 * 1024) throw new Error('Text file is too large (max 2MB).');
            const text = await file.text();
            extractedQuestions = await extractQuestionsFromTextAI(text, 10, lang, userApiKey, userOpenApiKey);
        } else if (fileType === 'csv') {
            await handleCsvUpload(file);
            return;
        } else {
            throw new Error(t('unsupportedFile', lang));
        }

        if (extractedQuestions.length === 0) {
            throw new Error('No questions could be extracted.');
        }

        const questionsToInsert = extractedQuestions.map(q => ({
            user_id: session.user!.id,
            text: q.text || 'Untitled Question',
            marks: q.marks || 1,
            class: 10,
            semester: Semester.First,
            year: new Date().getFullYear(),
            chapter: `Uploaded from ${file.name}`,
            difficulty: Difficulty.Moderate,
            source: QuestionSource.Upload,
        }));
        const { data: newQuestions, error } = await supabase.from('questions').insert(questionsToInsert).select();
        if (error) throw error;
        if (newQuestions) {
            setQuestions(prev => [...newQuestions, ...prev]);
            showToast(t('fileImportSuccess', lang).replace('{count}', String(newQuestions.length)), 'success');
        }

    } catch (error: any) {
        showToast(`${t('fileImportFailed', lang)}: ${error.message}`, 'error');
    } finally {
        setIsProcessingFile(false);
    }
};

const handleArchiveFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileType: 'pdf' | 'csv' | 'txt' | 'image') => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file || !session?.user) return;

    setIsProcessingFile(true);
    showToast(`${t('processingFile', lang)}: ${file.name}`);

    try {
        let savedQuestions: Question[] = [];

        if (fileType === 'csv') {
            const parsedCsvQuestions = await parseCsvToQuestions(file);
            if(parsedCsvQuestions.length === 0) throw new Error('No valid questions found in CSV.');
            const { data, error } = await supabase.from('questions').insert(parsedCsvQuestions).select();
            if (error) throw error;
            savedQuestions = data;
        } else {
            let extractedQuestions: Partial<Question>[] = [];
            if (fileType === 'pdf') {
                if (file.size > 20 * 1024 * 1024) throw new Error('PDF file is too large (max 20MB).');
                const dataUrl = await readFileAsDataURL(file, new AbortController().signal);
                extractedQuestions = await extractQuestionsFromPdfAI(dataUrl, 10, lang, userApiKey, userOpenApiKey);
            } else if (fileType === 'image') {
                if (file.size > 10 * 1024 * 1024) throw new Error('Image file is too large (max 10MB).');
                const dataUrl = await readFileAsDataURL(file, new AbortController().signal);
                extractedQuestions = await extractQuestionsFromImageAI(dataUrl, 10, lang, userApiKey, userOpenApiKey);
            } else if (fileType === 'txt') {
                 if (file.size > 2 * 1024 * 1024) throw new Error('Text file is too large (max 2MB).');
                const text = await file.text();
                extractedQuestions = await extractQuestionsFromTextAI(text, 10, lang, userApiKey, userOpenApiKey);
            } else {
                throw new Error(t('unsupportedFile', lang));
            }

            if (extractedQuestions.length === 0) throw new Error('No questions could be extracted from the file.');

            const questionsToInsert = extractedQuestions.map(q => ({
                user_id: session.user!.id,
                text: q.text || 'Untitled Question',
                marks: q.marks || 1, class: 10, semester: Semester.First, year: new Date().getFullYear(),
                chapter: `From ${file.name}`, difficulty: Difficulty.Moderate, source: QuestionSource.Upload,
            }));
            const { data, error } = await supabase.from('questions').insert(questionsToInsert).select();
            if (error) throw error;
            savedQuestions = data;
        }

        if (savedQuestions.length > 0) {
            setQuestions(prev => [...savedQuestions, ...prev]);
            showToast(t('fileImportSuccess', lang).replace('{count}', String(savedQuestions.length)), 'success');

            const paperId = `paper-${Date.now()}`;
            let uploadedFileUrl: string | null = null;
            if (fileType === 'pdf' || fileType === 'image') {
                const storageFilePath = `${session.user.id}/${paperId}/${file.name}`;
                const { error } = await supabase.storage.from('papers').upload(storageFilePath, file, { upsert: true });
                if (error) throw error;
                uploadedFileUrl = supabase.storage.from('papers').getPublicUrl(storageFilePath).data.publicUrl;
            }

            const newPaper: Paper = {
                id: paperId, title: file.name.split('.').slice(0, -1).join('.') || file.name, year: new Date().getFullYear(),
                class: 10, semester: Semester.First, source: QuestionSource.Upload, created_at: new Date().toISOString(),
                questions: savedQuestions, data_urls: uploadedFileUrl ? [uploadedFileUrl] : [], file_types: uploadedFileUrl ? [file.type] : [],
            };
            const { data: savedPaper, error: paperInsertError } = await supabase.from('papers').insert(newPaper).select().single();
            if (paperInsertError) throw paperInsertError;
            setPapers(prev => [savedPaper, ...prev]);
        } else {
            showToast('No valid questions found to import.', 'error');
        }
    } catch (error: any) {
        showToast(`${t('fileImportFailed', lang)}: ${error.message}`, 'error');
    } finally {
        setIsProcessingFile(false);
    }
};


const parseCsvToQuestions = async (file: File) => {
    if (!session?.user) return [];
    const text = await file.text();
    const rows = text.split('\n').map(r => r.trim()).filter(Boolean);
    const headerRow = rows.shift();
    if (!headerRow) throw new Error('CSV is empty or has no header.');
    
    const headers = headerRow.split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    const requiredHeaders = ['text', 'marks', 'difficulty', 'class', 'chapter'];
    if (!requiredHeaders.every(h => headers.includes(h))) {
        throw new Error(`CSV must contain headers: ${requiredHeaders.join(', ')}`);
    }

    return rows.map(row => {
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
            chapter: questionObj.chapter || 'Imported from CSV',
            tags: questionObj.tags ? questionObj.tags.split(';').map((t: string) => t.trim()).filter(Boolean) : [],
            source: QuestionSource.Upload,
            year: new Date().getFullYear(),
            semester: Semester.First,
        };
    }).filter(q => q.text);
};


const handleCsvUpload = async (file: File) => {
    setIsProcessingFile(true);
    try {
        const questionsToInsert = await parseCsvToQuestions(file);
        if (questionsToInsert.length === 0) {
            showToast('No valid questions found in CSV.', 'error');
            return;
        }
        const { data: newQuestions, error } = await supabase.from('questions').insert(questionsToInsert).select();
        if (error) throw error;
        setQuestions(prev => [...newQuestions, ...prev]);
        showToast(t('csvImportSuccess', lang).replace('{count}', String(newQuestions.length)), 'success');
    } catch (error: any) {
        showToast(t('csvImportFailed', lang), 'error');
    } finally {
        setIsProcessingFile(false);
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

  const handleSaveTutorResponse = async (queryText: string, queryImageUrl: string | null, responseText: string, tutorClass: number) => {
    if (!session?.user) {
        showToast("You must be logged in to save sessions.", 'error');
        return;
    }
    const { data, error } = await supabase
        .from('tutor_sessions')
        .insert({
            user_id: session.user.id,
            query_text: queryText,
            query_image_url: queryImageUrl,
            response_text: responseText,
            tutor_class: tutorClass
        })
        .select()
        .single();
    
    if (error || !data) {
        console.error("Error saving tutor session:", error);
        showToast("Failed to save tutor session.", 'error');
    } else {
        setTutorSessions(prev => [data, ...prev]);
        showToast("Session saved!", 'success');
    }
  };

  const handleDeleteTutorSession = async (sessionId: string) => {
    if (!session?.user) {
        showToast("You must be logged in to delete sessions.", 'error');
        return;
    }
    const { error } = await supabase
        .from('tutor_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', session.user.id);

    if (error) {
        console.error("Error deleting tutor session:", error);
        showToast("Failed to delete session.", 'error');
    } else {
        setTutorSessions(prev => prev.filter(s => s.id !== sessionId));
        showToast("Session deleted.", 'success');
    }
  };

  const renderContent = () => {
    return (
      <>
        <div style={{ display: activeTab === 'bank' ? 'block' : 'none' }}>
          <QuestionBank 
            questions={allVisibleQuestions} 
            onAddQuestion={handleAddQuestionClick} 
            onEditQuestion={handleEditQuestionClick} 
            onDeleteQuestion={handleDeleteQuestion} 
            lang={lang} 
            showToast={showToast}
            onFileImport={handleFileImport}
            isProcessingFile={isProcessingFile}
          />
        </div>
        <div style={{ display: activeTab === 'generator' ? 'block' : 'none' }}>
          <PaperGenerator questions={allVisibleQuestions} onSavePaper={handleSavePaper} lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} />
        </div>
        <div style={{ display: activeTab === 'ai_tutor' ? 'block' : 'none' }}>
           <AITutor lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} sessions={tutorSessions} onSaveResponse={handleSaveTutorResponse} onDeleteSession={handleDeleteTutorSession} />
        </div>
        <div style={{ display: activeTab === 'archive' ? 'block' : 'none' }}>
          <ExamArchive 
            papers={papers} 
            onDeletePaper={handleDeletePaper} 
            onUploadPaper={handleUploadPaper} 
            lang={lang}
            onFileImport={handleArchiveFileUpload}
            isProcessingFile={isProcessingFile}
            showToast={showToast}
          />
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