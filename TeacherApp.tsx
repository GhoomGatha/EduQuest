

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { Question, Paper, Tab, Language, Profile, QuestionSource, Difficulty, Semester, UploadProgress, TutorSession, Classroom, StudentQuery } from './types';
import { t } from './utils/localization';
import { TABS, LOCAL_STORAGE_KEY, API_KEY_STORAGE_KEY, LANGUAGE_STORAGE_KEY, OPENAI_API_KEY_STORAGE_KEY } from './constants';
import Modal from './components/Modal';
import QuestionForm from './components/QuestionForm';
import { useAuth } from './hooks/useAuth';
import { supabase } from './services/supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';
import SecretMessageModal from './components/SecretMessageModal';
import LiveClock from './components/LiveClock';
import LanguageSelector from './components/LanguageSelector';
import { extractQuestionsFromImageAI, extractQuestionsFromPdfAI, extractQuestionsFromTextAI, withTimeout } from './services/geminiService';
import AssignPaperModal from './components/AssignPaperModal';

const QuestionBank = lazy(() => import('./components/QuestionBank'));
const PaperGenerator = lazy(() => import('./components/PaperGenerator'));
const AITutor = lazy(() => import('./components/AITutor'));
const ExamArchive = lazy(() => import('./components/ExamArchive'));
const Settings = lazy(() => import('./components/Settings'));
const FinalExamPapers = lazy(() => import('./components/FinalExamPapers'));
const ClassroomComponent = lazy(() => import('./components/Classroom'));

const LAST_TEACHER_TAB_KEY = 'eduquest_last_teacher_tab';

const tabIconAnimations: Record<Tab, string> = {
  bank: 'animate-glow',
  generator: 'animate-sway',
  ai_tutor: 'animate-glow',
  archive: 'animate-bobbing',
  settings: 'animate-slow-spin',
  test_papers: 'animate-sway',
  classroom: 'animate-pulse',
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
  const [activeTab, setActiveTab] = useState<Tab>(() => (localStorage.getItem(LAST_TEACHER_TAB_KEY) as Tab) || 'classroom');
  const [lang, setLang] = useState<Language>('en');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [tutorSessions, setTutorSessions] = useState<TutorSession[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [studentQueries, setStudentQueries] = useState<StudentQuery[]>([]);
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
  const [assignmentModalState, setAssignmentModalState] = useState<{ paper?: Paper; classroom?: Classroom } | null>(null);


  const allVisibleQuestions = useMemo(() => {
    return [...questions].sort((a, b) => 
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
  }, [questions]);

  useEffect(() => {
    localStorage.setItem(LAST_TEACHER_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    const updateSessionInfo = () => {
        if (session?.user?.id) {
            const lastLoginKey = `eduquest_last_login_${session.user.id}`;
            const currentSessionKey = `eduquest_current_session_start_${session.user.id}`;

            const last = localStorage.getItem(lastLoginKey);
            const current = sessionStorage.getItem(currentSessionKey);
            setSessionInfo({
                lastLogin: last ? new Date(last).toLocaleString() : 'N/A',
                currentSessionStart: current ? new Date(current).toLocaleString() : 'N/A'
            });
        }
    };

    updateSessionInfo();
    window.addEventListener('storage', updateSessionInfo);
    return () => {
        window.removeEventListener('storage', updateSessionInfo);
    };
  }, [session]);

  const stableShowToast = useCallback(showToast, []);

  const fetchStudentQueries = useCallback(async () => {
    if (!session?.user) return;
    const { data, error } = await supabase
      .from('student_queries')
      .select('*, student_profile:profiles!student_id(full_name, avatar_url), classroom:classrooms(name)')
      .eq('teacher_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
        showToast(`Failed to load student queries: ${error.message}`, 'error');
    } else {
        setStudentQueries(data as any[] || []);
    }
  }, [session, showToast]);

  useEffect(() => {
    if (!session?.user) return;

    const fetchAllData = async () => {
        const [questionsRes, papersRes, tutorRes, classroomsRes] = await Promise.all([
            supabase.from('questions').select('*').eq('user_id', session.user.id),
            supabase.from('papers').select('*').eq('user_id', session.user.id),
            supabase.from('tutor_sessions').select('*').eq('user_id', session.user.id),
            supabase.from('classrooms').select('*').eq('teacher_id', session.user.id),
        ]);

        if (questionsRes.error) console.error(questionsRes.error.message);
        else setQuestions(questionsRes.data || []);

        if (papersRes.error) console.error(papersRes.error.message);
        else setPapers(papersRes.data || []);

        if (tutorRes.error) console.error(tutorRes.error.message);
        else setTutorSessions(tutorRes.data || []);

        if (classroomsRes.error) console.error(classroomsRes.error.message);
        else setClassrooms(classroomsRes.data || []);

        fetchStudentQueries();
    };

    fetchAllData();

    const questionsSub = supabase.channel('public:questions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setQuestions(q => [payload.new as Question, ...q]);
            if (payload.eventType === 'UPDATE') setQuestions(q => q.map(qu => qu.id === payload.new.id ? payload.new as Question : qu));
            if (payload.eventType === 'DELETE') setQuestions(q => q.filter(qu => qu.id !== (payload.old as Question).id));
        }).subscribe();
        
    const papersSub = supabase.channel('public:papers')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'papers', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setPapers(p => [payload.new as Paper, ...p]);
            if (payload.eventType === 'UPDATE') setPapers(p => p.map(pa => pa.id === (payload.new as Paper).id ? payload.new as Paper : pa));
            if (payload.eventType === 'DELETE') setPapers(p => p.filter(pa => pa.id !== (payload.old as Paper).id));
        }).subscribe();
    
    const tutorSub = supabase.channel('public:tutor_sessions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tutor_sessions', filter: `user_id=eq.${session.user.id}` }, payload => {
            if (payload.eventType === 'INSERT') setTutorSessions(s => [payload.new as TutorSession, ...s]);
            if (payload.eventType === 'DELETE') setTutorSessions(s => s.filter(se => se.id !== (payload.old as TutorSession).id));
        }).subscribe();
    
    const classroomsSub = supabase.channel('public:classrooms')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms', filter: `teacher_id=eq.${session.user.id}` }, () => {
            supabase.from('classrooms').select('*').eq('teacher_id', session.user.id).then(({ data }) => setClassrooms(data || []));
        }).subscribe();
        
    const queriesSub = supabase.channel('public:student_queries')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'student_queries', filter: `teacher_id=eq.${session.user.id}` }, () => {
            fetchStudentQueries();
        }).subscribe();

    return () => {
        supabase.removeChannel(questionsSub);
        supabase.removeChannel(papersSub);
        supabase.removeChannel(tutorSub);
        supabase.removeChannel(classroomsSub);
        supabase.removeChannel(queriesSub);
    };
  }, [session, fetchStudentQueries]);

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
    if (!session?.user) {
        showToast("You must be logged in to save.", "error");
        return;
    }
    
    const { id: localPaperId, ...paperData } = paper;
    
    const newQuestionsFromPaper = paper.questions.filter(q => q.id.startsWith('gen-'));
    const existingQuestionsFromPaper = paper.questions.filter(q => !q.id.startsWith('gen-'));
    
    let savedNewQuestions: Question[] = [];

    if (newQuestionsFromPaper.length > 0) {
        const questionsToInsert = newQuestionsFromPaper.map(q => {
            const { id, ...questionData } = q; 
            return { ...questionData, user_id: session.user.id };
        });

        const { data: newQuestionsData, error: questionsError } = await supabase
            .from('questions')
            .insert(questionsToInsert)
            .select('id, created_at'); // Only select DB-generated columns

        if (questionsError) {
            showToast(`Failed to add new questions to bank: ${questionsError.message}`, 'error');
            return;
        }

        if (newQuestionsData) {
            // Manually merge DB-generated IDs back into the full original question objects
            // This prevents losing any data (like answers or full text) if `select()` was misbehaving
            savedNewQuestions = newQuestionsFromPaper.map((originalQuestion, index) => ({
                ...originalQuestion,
                id: newQuestionsData[index].id,
                created_at: newQuestionsData[index].created_at,
                user_id: session.user.id,
            }));
        }
    }
    
    const finalPaperQuestions = [...existingQuestionsFromPaper, ...savedNewQuestions];
    
    const paperToSave = { 
        ...paperData, 
        user_id: session.user.id,
        questions: finalPaperQuestions 
    };

    const { data: savedPaperData, error: paperError } = await supabase
        .from('papers')
        .insert(paperToSave)
        .select()
        .single();

    if (paperError) {
        showToast(`Error saving paper to archive: ${paperError.message}`, 'error');
        // Still add questions to bank even if paper saving fails
        if (savedNewQuestions.length > 0) {
            setQuestions(prev => [...savedNewQuestions, ...prev]);
        }
        return;
    }

    if (savedNewQuestions.length > 0) {
        setQuestions(prev => [...savedNewQuestions, ...prev]);
    }
    if (savedPaperData) {
        setPapers(prev => [savedPaperData as Paper, ...prev]);
    }

    if (savedNewQuestions.length > 0) {
        showToast(t('paperGeneratedWithQuestions', lang).replace('{count}', String(savedNewQuestions.length)), 'success');
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
  
    const handleOpenAssignModalWithPaper = (paper: Paper) => {
        setAssignmentModalState({ paper });
    };

    const handleOpenAssignModalWithClassroom = (classroom: Classroom) => {
        setAssignmentModalState({ classroom });
    };

    const handleAssignPaper = async ({ classroomId, paperId, dueDate, timeLimit }: { classroomId: string; paperId: string; dueDate: string; timeLimit: number }) => {
        const paperToAssign = papers.find(p => p.id === paperId);
        if (!paperToAssign || !session?.user) {
            showToast("Could not find the selected paper to assign.", "error");
            return;
        }
        
        const paperSnapshot = { ...paperToAssign, time_limit_minutes: timeLimit };

        const { error } = await supabase.from('assignments').insert({
            paper_id: paperToAssign.id,
            paper_snapshot: paperSnapshot,
            classroom_id: classroomId,
            teacher_id: session.user.id,
            due_date: dueDate || null,
            time_limit_minutes: timeLimit,
        });

        if (error) {
            showToast(`Error assigning paper: ${error.message}`, 'error');
        } else {
            showToast('Paper assigned successfully!', 'success');
            setAssignmentModalState(null);
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
                const { error } = await supabase.storage.from('papers').upload(filePath, file, { signal: options.signal });
                if (error) throw error;
                uploadedFilePaths.push(filePath);
                completedCount++;
                onProgress({ total: files.length, completed: completedCount, pending: files.length - completedCount, currentFile: file.name });
                return { url: supabase.storage.from('papers').getPublicUrl(filePath).data.publicUrl, type: file.type };
            })();
        });

        const uploadResults = await Promise.all(uploadPromises);
        onProgress({ total: files.length, completed: files.length, pending: 0, currentFile: 'Finalizing...' });

        const { id, ...paperMeta } = paper;
        const finalPaperData = { ...paperMeta, id: paperId, user_id: session.user.id, data_urls: uploadResults.map(f => f.url), file_types: uploadResults.map(f => f.type), questions: [] };
        const { data: savedPaper, error: insertError } = await supabase.from('papers').insert(finalPaperData).select().single().abortSignal(options.signal);
        
        if (insertError) throw insertError;
        if (!savedPaper) throw new Error("Failed to save paper metadata.");
        showToast(t('uploadSuccess', lang));
        return savedPaper as Paper;

    } catch (error) {
        if (uploadedFilePaths.length > 0) supabase.storage.from('papers').remove(uploadedFilePaths);
        throw error;
    }
  };
  
  const onProcessPaper = async (paper: Paper, files: FileList) => {
    if (!files || files.length === 0 || !session?.user) return;
    const firstFile = files[0];
    const isExtractable = firstFile.type.startsWith('image/') || firstFile.type === 'application/pdf' || firstFile.type === 'text/plain';
    if (!isExtractable) return;

    const processAbortController = new AbortController();
    showToast(`AI processing started for "${paper.title}"...`, 'success');
    
    try {
        const dataUrl = await readFileAsDataURL(firstFile, processAbortController.signal);
        let results: Partial<Question>[] = [];
        
        if (firstFile.type.startsWith('image/')) results = await extractQuestionsFromImageAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        else if (firstFile.type === 'application/pdf') results = await extractQuestionsFromPdfAI(dataUrl, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        else if (firstFile.type === 'text/plain') {
            const binaryString = atob(dataUrl.split(',')[1]);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            const textContent = new TextDecoder().decode(bytes);
            results = await extractQuestionsFromTextAI(textContent, paper.class, lang, userApiKey, userOpenApiKey, processAbortController.signal);
        }
        
        if (results.length > 0) {
            const extractedQuestions: Question[] = results.map((q, i): Question => ({
                id: `scan-${paper.id}-${i}`, class: paper.class, chapter: 'Scanned', text: q.text!, answer: q.answer, marks: q.marks || 1, difficulty: Difficulty.Moderate,
                used_in: [], source: QuestionSource.Scan, year: paper.year, semester: paper.semester, tags: [], created_at: new Date().toISOString(),
            }));

            await supabase.from('questions').insert(extractedQuestions.map(q => ({ ...q, user_id: session!.user!.id })));
            await supabase.from('papers').update({ questions: extractedQuestions }).eq('id', paper.id);

            showToast(t('paperGeneratedWithQuestions', lang).replace('{count}', String(extractedQuestions.length)));
        } else {
             showToast(`AI found no questions to extract from "${paper.title}".`, 'success');
        }

    } catch (err: any) {
        showToast(`AI failed to process "${paper.title}": ${err.message}`, 'error');
    }
  };

  const handleProfileUpdate = async (updatedProfile: Profile, avatarFile?: File) => {
    if (!session?.user) throw new Error("User not authenticated.");
    try {
        let newAvatarUrl = updatedProfile.avatar_url;
        if (avatarFile) {
            const filePath = `${session.user.id}/avatar.${avatarFile.name.split('.').pop()}`;
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { upsert: true });
            if (uploadError) throw uploadError;
            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
            newAvatarUrl = `${urlData.publicUrl}?t=${new Date().getTime()}`;
        }
        const { data, error } = await supabase.from('profiles').update({ ...updatedProfile, avatar_url: newAvatarUrl, updated_at: new Date().toISOString() }).eq('id', session.user.id).select().single();
        if (error || !data) throw error ?? new Error('No data from profile update');
        setProfile(data);
        showToast('Profile updated!', 'success');
    } catch (err: any) {
        showToast(err.message, 'error');
        throw err;
    }
  };

  const handleExportData = () => {
    const dataStr = JSON.stringify({ questions, papers }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = 'eduquest_backup.json';
    link.href = URL.createObjectURL(blob);
    link.click();
    showToast(t('dataExported', lang));
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const { questions: iq, papers: ip } = JSON.parse(event.target?.result as string);
          if (Array.isArray(iq)) {
            await supabase.from('questions').delete().eq('user_id', session!.user.id);
            await supabase.from('questions').insert(iq.map((q: any) => ({...q, user_id: session!.user.id})));
          }
          if (Array.isArray(ip)) {
            await supabase.from('papers').delete().eq('user_id', session!.user.id);
            await supabase.from('papers').insert(ip.map((p: any) => ({...p, user_id: session!.user.id})));
          }
          showToast(t('dataImported', lang));
        } catch (error) {
          showToast('Failed to import data.', 'error');
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
  
  const handleSaveApiKey = (key: string) => { setUserApiKey(key); localStorage.setItem(API_KEY_STORAGE_KEY, key); showToast(t('apiKeySaved', lang)); };
  const handleRemoveApiKey = () => { setUserApiKey(''); localStorage.removeItem(API_KEY_STORAGE_KEY); showToast(t('apiKeyRemoved', lang), 'error'); };
  const handleSaveOpenApiKey = (key: string) => { setUserOpenApiKey(key); localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, key); showToast('OpenAI API Key saved!'); };
  const handleRemoveOpenApiKey = () => { setUserOpenApiKey(''); localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY); showToast('OpenAI API Key removed.', 'error'); };
  
  const handleSaveTutorResponse = async (queryText: string, queryImageUrl: string | null, responseText: string, responseImageUrl: string | undefined, tutorClass: number) => {
    if (!session?.user) return;
    const { error } = await supabase.from('tutor_sessions').insert({ user_id: session.user.id, query_text: queryText, query_image_url: queryImageUrl, response_text: responseText, response_image_url: responseImageUrl, tutor_class: tutorClass });
    if (error) showToast("Failed to save session.", 'error');
    else showToast("Session saved!", 'success');
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!session?.user) return;
    const { error } = await supabase.from('tutor_sessions').delete().eq('id', sessionId);
    if(error) showToast("Failed to delete session.", "error");
    else showToast("Session deleted.", "success");
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'bank': return <QuestionBank questions={allVisibleQuestions} onAddQuestion={() => handleOpenModal()} onEditQuestion={handleOpenModal} onDeleteQuestion={handleDeleteQuestion} lang={lang} showToast={showToast} />;
      case 'generator': return <PaperGenerator questions={questions} onSavePaper={handleSavePaper} lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} />;
      case 'ai_tutor': return <AITutor lang={lang} showToast={showToast} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} sessions={tutorSessions} onSaveResponse={handleSaveTutorResponse} onDeleteSession={handleDeleteSession} viewingSession={viewingSession} setViewingSession={setViewingSession} />;
      case 'archive': return <ExamArchive papers={papers} onDeletePaper={handleDeletePaper} onUploadPaper={onUploadPaper} onProcessPaper={onProcessPaper} lang={lang} showToast={showToast} viewingPaper={viewingPaper} setViewingPaper={setViewingPaper} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} onAssignPaper={handleOpenAssignModalWithPaper} />;
      case 'test_papers': return <FinalExamPapers lang={lang} userApiKey={userApiKey} userOpenApiKey={userOpenApiKey} showToast={showToast} onSavePaper={handleSavePaper} />;
      case 'classroom': return <ClassroomComponent lang={lang} showToast={showToast} studentQueries={studentQueries} onRefreshQueries={fetchStudentQueries} papers={papers} onAssignPaper={handleOpenAssignModalWithClassroom} />;
      case 'settings': return <Settings onExport={handleExportData} onImport={handleImportData} onClear={handleClearData} lang={lang} userApiKey={userApiKey} onSaveApiKey={handleSaveApiKey} onRemoveApiKey={handleRemoveApiKey} userOpenApiKey={userOpenApiKey} onSaveOpenApiKey={handleSaveOpenApiKey} onRemoveOpenApiKey={handleRemoveOpenApiKey} profile={profile!} onProfileUpdate={handleProfileUpdate} showToast={showToast} />;
      default: return null;
    }
  };

  return (
    <>
      <header className="bg-green-200/50 backdrop-blur-xl shadow-sm sticky top-0 z-40 border-b border-white/30">
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
              <div className="flex items-center space-x-3">
                <LiveClock />
                <LanguageSelector lang={lang} onLangChange={setLang} />
              </div>
            </div>
            <div className="my-2 p-[1.5px] rounded-full animate-background-color-cycle">
                <nav ref={navRef} className="relative flex justify-start sm:justify-center items-center bg-green-50 backdrop-blur-md p-1 rounded-full overflow-x-auto no-scrollbar">
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
      
      <main className="flex-grow max-w-7xl mx-auto w-full">
        <Suspense fallback={<LoadingSpinner message={t('loading', lang)} />}>
          {renderContent()}
        </Suspense>
      </main>

      <footer className="text-center py-4 text-sm text-slate-500 border-t border-white/20 bg-green-200/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-xs text-slate-400 mb-2 space-x-4">
                <span><strong>Current Session:</strong> {sessionInfo.currentSessionStart}</span>
                <span><strong>Last Login:</strong> {sessionInfo.lastLogin}</span>
            </div>
            <p>© {new Date().getFullYear()} {t('appTitle', lang)}. All Rights Reserved.</p>
            <p className="mt-1 text-xs text-slate-400">
            Crafted with{' '}
            <span className="animate-beat animate-text-color-cycle cursor-pointer" onMouseDown={handleHeartPressStart} onMouseUp={handleHeartPressEnd} onMouseLeave={handleHeartPressEnd} onTouchStart={handleHeartPressStart} onTouchEnd={handleHeartPressEnd}>❤️</span>
            {' '}for Hiyan by <span className="animate-beat animate-text-color-cycle">Vedant</span> v1.0
            </p>
        </div>
      </footer>
      
      <Modal isOpen={isModalOpen} onClose={() => setModalOpen(false)} title={editingQuestion ? t('editQuestion', lang) : t('addQuestion', lang)}>
        <QuestionForm onSubmit={handleSaveQuestion} onCancel={() => setModalOpen(false)} initialData={editingQuestion} lang={lang} />
      </Modal>

      <AssignPaperModal 
        isOpen={!!assignmentModalState} 
        onClose={() => setAssignmentModalState(null)} 
        onSubmit={handleAssignPaper} 
        classrooms={classrooms} 
        papers={papers}
        initialState={assignmentModalState}
       />
      <SecretMessageModal isOpen={isSecretMessageOpen} onClose={() => setSecretMessageOpen(false)} />
    </>
  );
};

export default TeacherApp;
