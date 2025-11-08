

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { Question, Paper, Tab, Language, Profile, QuestionSource, Difficulty, Semester, UploadProgress, TutorSession } from '../types';
import { t } from '../utils/localization';
// FIX: Import all necessary constants from the constants file.
import { TABS, LOCAL_STORAGE_KEY, API_KEY_STORAGE_KEY, LANGUAGE_STORAGE_KEY, OPENAI_API_KEY_STORAGE_KEY } from '../constants';
import Modal from './Modal';
import QuestionForm from './QuestionForm';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabaseClient';
import LoadingSpinner from './LoadingSpinner';
import SecretMessageModal from './SecretMessageModal';
import LiveClock from './LiveClock';
import LanguageSelector from './LanguageSelector';
import { extractQuestionsFromImageAI, extractQuestionsFromPdfAI, extractQuestionsFromTextAI, withTimeout } from '../services/geminiService';

const QuestionBank = lazy(() => import('./QuestionBank'));
const PaperGenerator = lazy(() => import('./PaperGenerator'));
const AITutor = lazy(() => import('./AITutor'));
const ExamArchive = lazy(() => import('./ExamArchive'));
const Settings = lazy(() => import('./Settings'));
const FinalExamPapers = lazy(() => import('./FinalExamPapers'));

const LAST_TEACHER_TAB_KEY = 'eduquest_last_teacher_tab';

// FIX: Add 'test_papers' to satisfy the Record<Tab, string> type.
const tabIconAnimations: Record<Tab, string> = {
  bank: 'animate-glow',
  generator: 'animate-sway',
  ai_tutor: 'animate-glow',
  archive: 'animate-bobbing',
  settings: 'animate-slow-spin',
  test_papers: 'animate-sway',
};

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

const getFontClassForLang = (language: Language): string => {
    switch (language) {
        case 'bn': return 'font-noto-bengali';
        case 'hi': return 'font-noto-devanagari';
        case 'ka': return 'font-noto-kannada';
        default: return '';
    }
};

const TeacherApp: React.FC<TeacherAppProps> = ({ showToast }) => {
  const { session, profile, setProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>(() => (localStorage.getItem(LAST_TEACHER_TAB_KEY) as Tab) || 'ai_tutor');
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
  const [sessionInfo, setSessionInfo] = useState<{ lastLogin: string; currentSessionStart: string }>({ lastLogin: 'N/A', currentSessionStart: 'N/A' });
  const [viewingPaper, setViewingPaper] = useState<Paper | null>(null);
  const [viewingSession, setViewingSession] = useState<TutorSession | null>(null);


  const allVisibleQuestions = useMemo(() => {
    // The Question Bank should be the single source of truth. The `questions` state
    // reflects the `questions` table in the database. Displaying questions from inside
    // saved paper objects can lead to showing stale data if a question was edited later.
    return [...questions].sort((a, b) => 
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }, [questions]);

  useEffect(() => {
    localStorage.setItem(LAST_TEACHER_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    const updateSessionInfo = () => {
        const last = localStorage.getItem('eduquest_last_login');
        const current = sessionStorage.getItem('eduquest_current_session_start');
        setSessionInfo({
            lastLogin: last ? new Date(last).toLocaleString() : 'N/A',
            currentSessionStart: current ? new Date(current).toLocaleString() : 'N/A'
        });
    };

    updateSessionInfo();

    // Listen for changes from other tabs
    window.addEventListener('storage', updateSessionInfo);
    return () => {
        window.removeEventListener('storage', updateSessionInfo);
    };
  }, []);

  const stableShowToast = useCallback(showToast, []);

  useEffect(() => {
    if (!session?.user) return;

    const fetchAllData = async () => {
        const [questionsRes, papersRes, tutorRes] = await Promise.all([
            supabase.from('questions').select('*').eq('user_id', session.user.id),
            supabase.from('papers').select('*').eq('user_id', session.user.id),
            supabase.from('tutor_sessions').select('*').eq('user_id', session.user.id),
        ]);

        if (questionsRes.error) console.error(questionsRes.error.message);
        else setQuestions(questionsRes.data || []);

        if (papersRes.error) console.error(papersRes.error.message);
        else setPapers(papersRes.data || []);

        if (tutorRes.error) console.error(tutorRes.error.message);
        else setTutorSessions(tutorRes.data || []);
    };

    fetchAllData();

    // Set up subscriptions for real-time updates
    const questionsSub = supabase.channel('public:questions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setQuestions(q => [...q, payload.new as Question]);
            if (payload.eventType === 'UPDATE') setQuestions(q => q.map(qu => qu.id === payload.new.id ? payload.new as Question : qu));
            if (payload.eventType === 'DELETE') setQuestions(q => q.filter(qu => qu.id !== (payload.old as Question).id));
        })
        .subscribe();
        
    const papersSub = supabase.channel('public:papers')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'papers', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setPapers(p => [...p, payload.new as Paper]);
            if (payload.eventType === 'UPDATE') setPapers(p => p.map(pa => pa.id === (payload.new as Paper).id ? payload.new as Paper : pa));
            if (payload.eventType === 'DELETE') setPapers(p => p.filter(pa => pa.id !== (payload.old as Paper).id));
        })
        .subscribe();
    
    const tutorSub = supabase.channel('public:tutor_sessions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tutor_sessions', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setTutorSessions(s => [...s, payload.new as TutorSession]);
            if (payload.eventType === 'DELETE') setTutorSessions(s => s.filter(se => se.id !== (payload.old as TutorSession).id));
        })
        .subscribe();

    return () => {
        supabase.removeChannel(questionsSub);
        supabase.removeChannel(papersSub);
        supabase.removeChannel(tutorSub);
    };
  }, [session]);

  useEffect(() => {
    const savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language;
    if (savedLang) setLang(savedLang);
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey) setUserApiKey(savedApiKey);
    const savedOpenApiKey = localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY);
    if (savedOpenApiKey) setUserOpenApiKey(savedOpenApiKey);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    document.body.classList.remove('font-noto-bengali', 'font-noto-devanagari', 'font-noto-kannada');
    const fontClass = getFontClassForLang(lang);
    if (fontClass) {
        document.body.classList.add(fontClass);
    }
  }, [lang]);

  useEffect(() => {
    if (navRef.current) {
      const activeTabElement = navRef.current.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement;
      if (activeTabElement) {
        const { offsetLeft, offsetWidth } = activeTabElement;
        setSliderStyle({ left: `${offsetLeft}px`, width: `${offsetWidth}px` });
        activeTabElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeTab, lang]);

  const handleHeartPressStart = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => setSecretMessageOpen(true), 11000);
  };

  const handleHeartPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleOpenModal = (question: Question | null = null) => {
    setEditingQuestion(question);
    setModalOpen(true);
  };

  const handleSaveQuestion = async (question: Question) => {
    const { data, error } = await supabase.from('questions').upsert(question).select().single();
    if (error) {
        console.error("Error saving question:", error);
        showToast(`Error: ${error.message}`, 'error');
    } else if (data) {
        showToast(editingQuestion ? t('questionUpdated', lang) : t('questionAdded', lang));
        setModalOpen(false);
        setEditingQuestion(null);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this question?')) {
        const { error } = await supabase.from('questions').delete().eq('id', id);
        if (error) showToast(`Error: ${error.message}`, 'error');
        else showToast(t('questionDeleted', lang), 'error');
    }
  };
  
  const handleSavePaper = async (paper: Paper) => {
      // Destructure 'id' to remove it from the object being inserted.
      // This allows Supabase to generate a new UUID for the primary key.
      const { id, ...paperData } = paper;
      const paperToSave = { ...paperData, user_id: session!.user.id };
      const newQuestionsToSave = paper.questions
          .filter(q => q.source === QuestionSource.Generated || q.source === QuestionSource.Scan)
          .map(q => ({ ...q, user_id: session!.user.id }));
  
      const { error: paperError } = await supabase.from('papers').insert(paperToSave);
  
      if (paperError) {
          showToast(`Error saving paper: ${paperError.message}`, 'error');
          return;
      }
  
      let questionsError = null;
      if (newQuestionsToSave.length > 0) {
          const { error } = await supabase.from('questions').insert(newQuestionsToSave);
          questionsError = error;
      }
  
      if (questionsError) {
          showToast(`Paper saved, but failed to add questions to bank: ${questionsError.message}`, 'error');
      } else if (newQuestionsToSave.length > 0) {
          showToast(t('paperGeneratedWithQuestions', lang).replace('{count}', String(newQuestionsToSave.length)), 'success');
      } else {
          showToast(t('paperSavedToArchive', lang), 'success');
      }
  };

  const handleDeletePaper = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this paper from the archive? This does not delete questions from the question bank.')) {
        const { error } = await supabase.from('papers').delete().eq('id', id);
        if (error) showToast(`Error: ${error.message}`, 'error');
        else showToast(t('paperDeleted', lang), 'error');
    }
  };

  const onUploadPaper = async (paper: Paper, files: FileList, onProgress: (progress: UploadProgress | null) => void, options: { signal: AbortSignal }): Promise<Paper> => {
    if (!session?.user) throw new Error("User not authenticated");

    const paperId = crypto.randomUUID();
    const folderPath = `${session.user.id}/${paperId}`;
    const uploadedFilePaths: string[] = [];
    
    try {
        let completedCount = 0;
        const uploadPromises = Array.from(files).map(file => {
            return (async () => {
                const filePath = `${folderPath}/${file.name}`;
                
                const { data, error } = await supabase.storage
                    .from('papers')
                    .upload(filePath, file, { 
                        cacheControl: '3600', 
                        upsert: false, 
                        contentType: file.type,
                        signal: options.signal // Pass the signal directly to Supabase client
                    });

                if (error) throw error; // Throws cancellation or any other upload error

                uploadedFilePaths.push(filePath);
                
                // Safely update progress
                completedCount++;
                onProgress({ 
                    total: files.length, 
                    completed: completedCount, 
                    pending: files.length - completedCount, 
                    currentFile: file.name 
                });

                return {
                    url: supabase.storage.from('papers').getPublicUrl(filePath).data.publicUrl,
                    type: file.type
                };
            })();
        });

        const uploadResults = await Promise.all(uploadPromises);
        onProgress({ total: files.length, completed: files.length, pending: 0, currentFile: 'Finalizing...' });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...paperMeta } = paper;
        const finalPaperData = {
            ...paperMeta,
            id: paperId,
            user_id: session.user.id,
            data_urls: uploadResults.map(f => f.url),
            file_types: uploadResults.map(f => f.type),
            questions: []
        };

        const { data: savedPaper, error: insertError } = await supabase
            .from('papers')
            .insert(finalPaperData)
            .select()
            .single()
            .abortSignal(options.signal);
        
        if (insertError) throw insertError;
        if (!savedPaper) throw new Error("Failed to save paper metadata to database.");

        showToast(t('uploadSuccess', lang));
        return savedPaper as Paper;

    } catch (error) {
        // This catch block is for rollback. The raw error will be re-thrown to the caller.
        console.error("Upload process failed, initiating rollback...", { paperId, error });

        if (uploadedFilePaths.length > 0) {
            supabase.storage.from('papers').remove(uploadedFilePaths).then(({ error: removeError }) => {
                if (removeError) console.error("Rollback failed (file deletion):", removeError);
            });
        }
        
        throw error;
    }
  };
  
  const onProcessPaper = async (paper: Paper, files: FileList) => {
    if (!files || files.length === 0 || !session?.user) return;

    const firstFile = files[0];
    const isExtractable = firstFile.type.startsWith('image/') || firstFile.type === 'application/pdf' || firstFile.type === 'text/plain';

    if (!isExtractable) {
        console.log(`File type ${firstFile.type} is not extractable. Skipping AI processing.`);
        return;
    }

    const processAbortController = new AbortController();
    showToast(`AI processing started for "${paper.title}"...`, 'success');
    
    try {
        const dataUrl = await readFileAsDataURL(firstFile, processAbortController.signal);
        let results: Partial<Question>[] = [];
        
        if (firstFile.type.startsWith('image/')) {
            results = await extractQuestionsFromImageAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        } else if (firstFile.type === 'application/pdf') {
            results = await extractQuestionsFromPdfAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        } else if (firstFile.type === 'text/plain') {
            const base64Data = dataUrl.split(',')[1];
            // Robust decoding for UTF-8 and other characters
            const binaryString = atob(base64Data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const textContent = new TextDecoder().decode(bytes);
            results = await extractQuestionsFromTextAI(textContent, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        }
        
        if (results.length > 0) {
            const extractedQuestions: Question[] = results.map((q, i): Question => ({
                id: `scan-${paper.id}-${i}`,
                class: paper.class,
                chapter: 'Scanned',
                text: q.text!,
                answer: q.answer,
                marks: q.marks || 1,
                difficulty: Difficulty.Moderate,
                used_in: [],
                source: QuestionSource.Scan,
                year: paper.year,
                semester: paper.semester,
                tags: [],
                created_at: new Date().toISOString(),
            }));

            const newQuestionsToBank = extractedQuestions.map(q => ({ ...q, user_id: session.user!.id }));
            const { error: insertError } = await supabase.from('questions').insert(newQuestionsToBank);
            if (insertError) throw insertError;
            
            const { error: updateError } = await supabase.from('papers').update({ questions: extractedQuestions }).eq('id', paper.id);
            if (updateError) throw updateError;

            showToast(t('paperGeneratedWithQuestions', lang).replace('{count}', String(extractedQuestions.length)));
        } else {
             showToast(`AI found no questions to extract from "${paper.title}".`, 'success');
        }

    } catch (err: any) {
        console.error("AI processing failed:", err);
        showToast(`AI failed to process "${paper.title}": ${err.message}`, 'error');
    }
  };

  const handleProfileUpdate = async (updatedProfile: Profile, avatarFile?: File) => {
    if (!session?.user) throw new Error("User not authenticated.");
    try {
        let newAvatarUrl = updatedProfile.avatar_url;
        if (avatarFile) {
            const fileExt = avatarFile.name.split('.').pop();
            const filePath = `${session.user.id}/avatar.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { upsert: true });
            if (uploadError) throw uploadError;
            const { data: urlData } = await supabase.storage.from('avatars').getPublicUrl(filePath);
            newAvatarUrl = `${urlData.publicUrl}?t=${new Date().getTime()}`;
        }
        const { id, ...profileUpdates } = updatedProfile;
        const finalProfile = { ...profileUpdates, avatar_url: newAvatarUrl, updated_at: new Date().toISOString() };
        
        const { data, error } = await supabase.from('profiles').update(finalProfile).eq('id', session.user.id).select().single();
        if(error || !data) {
            throw error ?? new Error('No data returned from profile update');
        }

        setProfile(data);
        showToast('Profile updated!', 'success');
    } catch (err: unknown) {
        let message = 'An unknown error occurred while updating profile.';
        if (err instanceof Error) {
            message = err.message;
        } else if (err && typeof err === 'object' && 'message' in err) {
            message = String((err as { message: unknown }).message);
        } else if (typeof err === 'string') {
            message = err;
        }
        console.error("Error updating profile:", err);
        showToast(message, 'error');
        throw err;
    }
  };

  const handleExportData = () => {
    const dataToExport = { questions, papers };
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'eduquest_backup.json';
    link.href = url;
    link.click();
    showToast(t('dataExported', lang));
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const { questions: importedQuestions, papers: importedPapers } = JSON.parse(event.target?.result as string);
          if (Array.isArray(importedQuestions)) {
            await supabase.from('questions').delete().eq('user_id', session!.user.id);
            await supabase.from('questions').insert(importedQuestions.map((q: any) => ({...q, user_id: session!.user.id})));
          }
          if (Array.isArray(importedPapers)) {
            await supabase.from('papers').delete().eq('user_id', session!.user.id);
            await supabase.from('papers').insert(importedPapers.map((p: any) => ({...p, user_id: session!.user.id})));
          }
          showToast(t('dataImported', lang));
        } catch (error) {
          console.error(error);
          showToast('Failed to import data. Invalid file format.', 'error');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleClearData = async () => {
    await supabase.from('questions').delete().eq('user_id', session!.user.id);
    await supabase.from('papers').delete().eq('user_id', session!.user.id);
    await supabase.from('tutor_sessions').delete().eq('user_id', session!.user.id);
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
  
  const handleSaveTutorResponse = async (queryText: string, queryImageUrl: string | null, responseText: string, responseImageUrl: string | undefined, tutorClass: number) => {
    if (!session?.user) {
        showToast("You must be logged in to save sessions.", "error");
        return;
    }
    const { data, error } = await supabase
        .from('tutor_sessions')
        .insert({
            user_id: session.user.id,
            query_text: queryText,
            query_image_url: queryImageUrl,
            response_text: responseText,
            response_image_url: responseImageUrl,
            tutor_class: tutorClass
        })
        .select()
        .single();
    
    if (error || !data) {
        console.error("Error saving tutor session:", error?.message || "No data returned");
        showToast("Failed to save session.", 'error');
    } else {
        setTutorSessions(prev => [data as TutorSession, ...prev]);
        showToast("Session saved!", 'success');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!session?.user) return;
    const { error } = await supabase.from('tutor_sessions').delete().eq('id', sessionId).eq('user_id', session.user.id);
    if(error) showToast("Failed to delete session.", "error");
    else showToast("Session deleted.", "success");
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'bank': return <QuestionBank questions={allVisibleQuestions} onAddQuestion={() => handleOpenModal()} onEditQuestion={handleOpenModal} onDeleteQuestion={handleDeleteQuestion} lang={lang} showToast={showToast} />;
      case 'generator': return <PaperGenerator questions={questions} onSavePaper={handleSavePaper} lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} />;
      case 'ai_tutor': return <AITutor lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} sessions={tutorSessions} onSaveResponse={handleSaveTutorResponse} onDeleteSession={handleDeleteSession} viewingSession={viewingSession} setViewingSession={setViewingSession} />;
      case 'archive': return <ExamArchive papers={papers} onDeletePaper={handleDeletePaper} onUploadPaper={onUploadPaper} onProcessPaper={onProcessPaper} lang={lang} showToast={showToast} viewingPaper={viewingPaper} setViewingPaper={setViewingPaper} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} />;
      case 'test_papers': return <FinalExamPapers lang={lang} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} showToast={showToast} onSavePaper={handleSavePaper} />;
      case 'settings': return <Settings onExport={handleExportData} onImport={handleImportData} onClear={handleClearData} lang={lang} userApiKey={userApiKey} onSaveApiKey={handleSaveApiKey} onRemoveApiKey={handleRemoveApiKey} userOpenApiKey={userOpenApiKey} onSaveOpenApiKey={handleSaveOpenApiKey} onRemoveOpenApiKey={handleRemoveOpenApiKey} profile={profile!} onProfileUpdate={handleProfileUpdate} showToast={showToast} />;
      default: return null;
    }
  };

  return (
    <>
      <header className="bg-green-100/60 backdrop-blur-lg shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
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
              <div className="flex items-center space-x-3">
                <LiveClock />
                <LanguageSelector lang={lang} onLangChange={setLang} />
              </div>
            </div>
            <div className="my-2 p-[1.5px] rounded-full animate-background-color-cycle">
                <nav ref={navRef} className="relative flex items-center bg-green-50 backdrop-blur-md p-1 rounded-full overflow-x-auto no-scrollbar">
                    <div className="absolute bg-white rounded-full h-10 shadow-md premium-tab-slider" style={sliderStyle} aria-hidden="true" />
                    {TABS.map(tab => (
                        <button key={tab.id} data-tab-id={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={`relative z-10 flex-shrink-0 px-3 sm:px-4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 flex items-center justify-center whitespace-nowrap ${activeTab === tab.id ? 'text-indigo-700' : 'text-slate-600 hover:text-slate-800'}`}
                            aria-selected={activeTab === tab.id}>
                            <span className={`mr-2 text-lg ${activeTab === tab.id ? tabIconAnimations[tab.id] : ''}`}>{tab.icon}</span>
                            {t(tab.id, lang)}
                        </button>
                    ))}
                </nav>
            </div>
        </div>
      </header>
      
      <main className="flex-grow">
        <Suspense fallback={<LoadingSpinner message={t('loading', lang)} />}>
          {renderContent()}
        </Suspense>
      </main>

      <footer className="text-center py-4 text-sm text-slate-500 border-t border-green-200/40 bg-green-100/60 backdrop-blur-lg">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-xs text-slate-400 mb-2 space-x-4">
                <span><strong>Current Session:</strong> {sessionInfo.currentSessionStart}</span>
                <span><strong>Last Login:</strong> {sessionInfo.lastLogin}</span>
            </div>
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
        </div>
      </footer>
      
      <Modal isOpen={isModalOpen} onClose={() => setModalOpen(false)} title={editingQuestion ? t('editQuestion', lang) : t('addQuestion', lang)}>
        <QuestionForm onSubmit={handleSaveQuestion} onCancel={() => setModalOpen(false)} initialData={editingQuestion} lang={lang} />
      </Modal>

      <SecretMessageModal isOpen={isSecretMessageOpen} onClose={() => setSecretMessageOpen(false)} />
    </>
  );
};

export default TeacherApp;