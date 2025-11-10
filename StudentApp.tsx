
import React, { useState, useEffect, useCallback, lazy, Suspense, useMemo } from 'react';
import { useAuth } from './hooks/useAuth';
import { supabase } from './services/supabaseClient';
// FIX: Import ViewState from the shared types file.
import { Paper, TestAttempt, StudentTab, Language, Profile, Question, QuestionSource, Semester, Difficulty, TutorSession, ViewState, StudyMaterial, Flashcard, Assignment, Classroom, StudentQuery } from './types';
import { STUDENT_ATTEMPTS_KEY, API_KEY_STORAGE_KEY, LANGUAGE_STORAGE_KEY, OPENAI_API_KEY_STORAGE_KEY } from './constants';
import { t } from './utils/localization';
import LoadingSpinner from './components/LoadingSpinner';
import Modal from './components/Modal';
import { loadScript } from './utils/scriptLoader';

const Header = lazy(() => import('./components/student/Header'));
const Nav = lazy(() => import('./components/student/Nav'));
const Footer = lazy(() => import('./components/student/Footer'));
const StudentDashboard = lazy(() => import('./components/student/StudentDashboard'));
const PracticeTest = lazy(() => import('./components/student/PracticeTest'));
const TestResults = lazy(() => import('./components/student/TestResults'));
const Settings = lazy(() => import('./components/student/Settings'));
const PracticeZone = lazy(() => import('./components/student/PracticeZone'));
const AITutor = lazy(() => import('./components/student/AITutor'));
const FinalExamPapers = lazy(() => import('./components/FinalExamPapers'));
const StudentClassroom = lazy(() => import('./components/student/StudentClassroom'));

interface StudentAppProps {
  showToast: (message: string, type?: 'success' | 'error') => void;
}

// --- Start of Embedded Helper Components for Modal ---
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (containerRef.current && window.marked) {
            containerRef.current.innerHTML = window.marked.parse(content || '');
        } else if (!window.marked) {
            loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js").then(() => {
                 if (containerRef.current) {
                    containerRef.current.innerHTML = window.marked.parse(content || '');
                 }
            });
        }
    }, [content]);
    return <div ref={containerRef} className="prose prose-sm max-w-none prose-slate"></div>;
};

const FlashcardViewer: React.FC<{ flashcards: Flashcard[], title: string, lang: Language }> = ({ flashcards, title, lang }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const currentCard = flashcards[currentIndex];
    const handleNext = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((p) => (p + 1) % flashcards.length), 250);
    };
    const handlePrev = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((p) => (p - 1 + flashcards.length) % flashcards.length), 250);
    };
    return (
        <div className="flex flex-col items-center">
            <h3 className="text-lg font-bold text-slate-800 mb-4">{title} ({currentIndex + 1}/{flashcards.length})</h3>
            <div className="w-full h-64 [perspective:1000px]" onClick={() => setIsFlipped(!isFlipped)}>
                <div className={`relative w-full h-full [transform-style:preserve-3d] transition-transform duration-500 cursor-pointer ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-white border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg"><p className="text-xl font-semibold text-slate-700">{currentCard.question}</p></div>
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-indigo-100 border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg [transform:rotateY(180deg)]"><p className="text-lg text-indigo-800">{currentCard.answer}</p></div>
                </div>
            </div>
            <div className="flex justify-between w-full mt-6">
                <button onClick={handlePrev} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg">&larr; {t('previous', lang)}</button>
                <button onClick={handleNext} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg">{t('next', lang)} &rarr;</button>
            </div>
        </div>
    );
};
// --- End of Embedded Helper Components ---

const LAST_STUDENT_TAB_KEY = 'eduquest_last_student_tab';

const getFontClassForLang = (language: Language): string => {
    switch (language) {
        case 'bn': return 'font-noto-bengali';
        case 'hi': return 'font-noto-devanagari';
        case 'ka': return 'font-noto-kannada';
        default: return '';
    }
};

const StudentApp: React.FC<StudentAppProps> = ({ showToast }) => {
  const { profile, setProfile, session } = useAuth();
  const [viewState, setViewState] = useState<ViewState>(() => {
    const lastTab = localStorage.getItem(LAST_STUDENT_TAB_KEY) as StudentTab | null;
    if (lastTab) {
        return { view: lastTab };
    }
    return { view: 'dashboard' };
  });
  
  const [papers, setPapers] = useState<Paper[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attempts, setAttempts] = useState<TestAttempt[]>([]);
  const [tutorSessions, setTutorSessions] = useState<TutorSession[]>([]);
  const [joinedClassrooms, setJoinedClassrooms] = useState<Classroom[]>([]);
  const [studentQueries, setStudentQueries] = useState<StudentQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>('en');
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [userOpenApiKey, setUserOpenApiKey] = useState<string>('');
  const [viewingMaterial, setViewingMaterial] = useState<StudyMaterial | null>(null);

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
    // Persist the current main tab, but not transient states like 'test' or detailed views.
    if (['dashboard', 'results', 'practice', 'ai_tutor', 'settings', 'test_papers', 'classroom'].includes(viewState.view)) {
      if (viewState.view === 'results' && 'attemptId' in viewState && viewState.attemptId) {
        // Don't save if we are on a detailed result page.
      } else {
        localStorage.setItem(LAST_STUDENT_TAB_KEY, viewState.view);
      }
    }
  }, [viewState]);

  const fetchPapers = useCallback(async () => {
    // This check is important because profile might not be loaded yet.
    if (!profile?.role) return;

    const studentClass = 10; // Assuming a default class for all students for now.
    
    const { data, error } = await supabase
        .from('papers')
        .select('*')
        .eq('class', studentClass)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('Error fetching papers:', error.message || error);
        showToast(`Failed to load tests: ${error.message}`, 'error');
    } else {
        setPapers(data || []);
    }
  }, [showToast, profile]);
  
  const fetchAssignments = useCallback(async () => {
    if (!session?.user) return;
    // RLS policy ensures students only see assignments for classrooms they are in.
    const { data, error } = await supabase.from('assignments').select('*');
    if (error) {
        showToast(`Failed to load assignments: ${error.message}`, 'error');
    } else {
        setAssignments(data || []);
    }
  }, [session, showToast]);

    const fetchJoinedClassrooms = useCallback(async () => {
        if (!session?.user) return;
        
        try {
            // 1. Get classroom IDs student is part of
            const { data: relations, error: relationsError } = await supabase
                .from('classroom_students')
                .select('classroom_id')
                .eq('student_id', session.user.id);
            
            if (relationsError) throw relationsError;
            if (!relations || relations.length === 0) {
                setJoinedClassrooms([]);
                return;
            }
            
            const classroomIds = relations.map(r => r.classroom_id);
            
            // 2. Get classroom details for those IDs
            const { data: classroomsData, error: classroomsError } = await supabase
                .from('classrooms')
                .select('*')
                .in('id', classroomIds);
                
            if (classroomsError) throw classroomsError;
            if (!classroomsData) {
                setJoinedClassrooms([]);
                return;
            }

            // 3. Get teacher profiles for those classrooms
            const teacherIds = [...new Set(classroomsData.map(c => c.teacher_id))];
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('*')
                .in('id', teacherIds);
            
            if (profilesError) throw profilesError;

            // 4. Combine data
            const classroomsWithTeachers = classroomsData.map(classroom => {
                const teacherProfile = profilesData?.find(p => p.id === classroom.teacher_id);
                return {
                    ...classroom,
                    teacher_profile: teacherProfile
                } as Classroom;
            });
            
            setJoinedClassrooms(classroomsWithTeachers);

        } catch (error: any) {
            showToast(`Failed to load classrooms: ${error.message}`, 'error');
        }
    }, [session, showToast]);

  const fetchAttempts = useCallback(async () => {
    if (!session?.user) return [];
    const { data, error } = await supabase
        .from('student_test_attempts')
        .select('id, attempt_data')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching attempts:', error.message || error);
        showToast(`Failed to load past results: ${error.message}`, 'error');
        return [];
    }
    return (data || []).map(row => ({ ...row.attempt_data, db_id: row.id }));
  }, [session, showToast]);

  const fetchTutorSessions = useCallback(async () => {
    if (!session?.user) return;
    const { data, error } = await supabase
        .from('tutor_sessions')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error("Failed to fetch tutor sessions", error);
        showToast(`Could not load AI Tutor history: ${error.message}`, 'error');
    } else {
        setTutorSessions(data || []);
    }
  }, [session, showToast]);

  const fetchStudentQueries = useCallback(async () => {
    if (!session?.user) return;
    const { data, error } = await supabase
      .from('student_queries')
      .select('*, classroom:classrooms(name)')
      .eq('student_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      showToast(`Could not load your questions: ${error.message}`, 'error');
    } else {
      setStudentQueries(data as StudentQuery[]);
    }
  }, [session, showToast]);

  useEffect(() => {
    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([fetchPapers(), fetchTutorSessions(), fetchAssignments(), fetchJoinedClassrooms(), fetchStudentQueries()]);
            const dbAttempts = await fetchAttempts();

            // One-time migration from localStorage
            const localAttemptsRaw = localStorage.getItem(STUDENT_ATTEMPTS_KEY);
            if (localAttemptsRaw) {
                try {
                    const localAttempts: TestAttempt[] = JSON.parse(localAttemptsRaw);
                    const newAttemptsToMigrate = localAttempts.filter(local => 
                        !dbAttempts.some(db => db.paperId === local.paperId && db.completedAt === local.completedAt)
                    );

                    if (newAttemptsToMigrate.length > 0) {
                        const recordsToInsert = newAttemptsToMigrate.map(attempt => ({
                            user_id: session!.user.id,
                            attempt_data: attempt,
                        }));
                        const { error } = await supabase.from('student_test_attempts').insert(recordsToInsert);
                        if (!error) {
                            const allAttempts = await fetchAttempts();
                            setAttempts(allAttempts);
                            localStorage.removeItem(STUDENT_ATTEMPTS_KEY);
                            showToast("Your past results have been synced to your account.", "success");
                        } else {
                            console.error("Failed to migrate local attempts to database:", error);
                            showToast("Could not sync some of your past results to your account.", 'error');
                            setAttempts([...dbAttempts, ...newAttemptsToMigrate]); // Merge for session
                        }
                    } else {
                        setAttempts(dbAttempts);
                        localStorage.removeItem(STUDENT_ATTEMPTS_KEY); // Clean up old data
                    }
                } catch (e) {
                    console.error("Failed to parse/migrate local attempts", e);
                    setAttempts(dbAttempts);
                    localStorage.removeItem(STUDENT_ATTEMPTS_KEY);
                }
            } else {
                setAttempts(dbAttempts);
            }
        } catch (error: any) {
            console.error("Error loading student data:", error.message || error);
            showToast("Failed to load your data. Please refresh.", "error");
        } finally {
            setLoading(false);
        }
    };

    // FIX: This logic correctly handles the initial loading state.
    // If session/profile are ready, it loads data. If not, it stops the loading
    // spinner to prevent getting stuck, and waits for a re-render when the
    // session/profile data arrives from the parent AuthProvider.
    if (session?.user && profile?.id) {
        loadData();
    } else {
        setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile]);

  useEffect(() => {
    if (!session?.user) return;

    const assignmentsChannel = supabase
        .channel('public:assignments')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'assignments' },
            (payload) => {
                // RLS on assignments table means students only get notified for classrooms they are in.
                // Re-fetching is the simplest way to update the list.
                fetchAssignments();
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(assignmentsChannel);
    };
  }, [session, fetchAssignments]);

  const handleStartTest = (paper: Paper, assignmentId?: string) => {
    setViewState({ view: 'test', paper, assignmentId });
  };

  const handleTestComplete = async (attempt: TestAttempt, assignmentId?: string) => {
    if (!session?.user) {
        showToast("You must be logged in to save results.", 'error');
        return;
    }
    
    let savedAttempt = attempt; // Use the local attempt as a fallback

    try {
        // Always save to the student's personal attempts history
        const { db_id, ...attemptData } = attempt;
        const { data, error: attemptError } = await supabase
            .from('student_test_attempts')
            .insert({ user_id: session.user.id, attempt_data: attemptData })
            .select('id, attempt_data')
            .single();

        if (attemptError || !data) {
            throw attemptError || new Error("Failed to save test attempt.");
        }
        
        savedAttempt = { ...data.attempt_data, db_id: data.id };
        setAttempts(prev => [savedAttempt, ...prev]);
        showToast('Test submitted successfully!', 'success');

        // If it's an assignment, also save it to the submissions table for the teacher
        if (assignmentId) {
            const assignment = assignments.find(a => a.id === assignmentId);
            if (!assignment) {
                showToast("Could not find assignment details to notify teacher.", 'error');
            } else {
                const { error: submissionError } = await supabase.from('assignment_submissions').upsert({
                    assignment_id: assignmentId,
                    student_id: session.user.id,
                    teacher_id: assignment.teacher_id,
                    attempt_data: attempt // The whole attempt object
                }, {
                    onConflict: 'assignment_id, student_id'
                });

                if (submissionError) {
                    console.error("Error saving assignment submission:", submissionError.message, submissionError);
                    showToast(`Your result was saved, but notifying the teacher failed: ${submissionError.message}`, 'error');
                } else {
                    showToast("Your teacher has been notified of your submission.", 'success');
                }
            }
        }
    } catch (error: any) {
        console.error("Error during test completion:", error.message, error);
        showToast(`Could not save your test results: ${error.message}`, 'error');
        // Fallback to local state for this session
        setAttempts(prev => [attempt, ...prev]);
    } finally {
        // This ensures navigation happens even if saving fails
        setViewState({ view: 'results', attemptId: savedAttempt.db_id });
    }
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
            const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
            newAvatarUrl = `${urlData.publicUrl}?t=${new Date().getTime()}`;
        }
        const { id, ...profileUpdates } = updatedProfile;
        const finalProfile = { ...profileUpdates, avatar_url: newAvatarUrl, updated_at: new Date().toISOString() };
        // FIX: Destructuring after awaiting to prevent type inference issues.
        const { data, error } = await supabase.from('profiles').update(finalProfile).eq('id', session.user.id).select().single();
        // FIX: Changed || to ?? to prevent throwing null if error is null.
        if(error || !data) {
            throw error ?? new Error('No data returned from profile update');
        }
        setProfile(data);
        showToast('Profile updated!', 'success');
    } catch (err: unknown) {
        // FIX: Added a more robust catch block to handle unknown error types safely.
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

  const handleExportData = async () => {
    const { data, error } = await supabase
        .from('student_test_attempts')
        .select('attempt_data')
        .eq('user_id', session!.user.id);
    if(error) {
        showToast('Could not export data.', 'error');
        return;
    }
    const attemptsToExport = data.map(row => row.attempt_data);
    const dataString = JSON.stringify(attemptsToExport, null, 2);
    const blob = new Blob([dataString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eduquest_student_attempts_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast(t('dataExported', lang));
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    showToast("Data import to cloud account is not yet supported.", 'error');
  };

  const handleClearData = async () => {
      if(window.confirm(t('clearWarning', lang))) {
        await supabase.from('student_test_attempts').delete().eq('user_id', session!.user.id);
        await supabase.from('student_generated_content').delete().eq('user_id', session!.user.id);
        await supabase.from('tutor_sessions').delete().eq('user_id', session!.user.id);
        
        setAttempts([]);
        setTutorSessions([]);
        // We don't clear study materials from state here, as it's fetched on dashboard mount.
        showToast(t('dataCleared', lang), 'error');
      }
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
  
  const allQuestionsForPractice = useMemo(() => {
    const questionMap = new Map<string, Question>();
    papers.flatMap(p => p.questions).forEach(q => {
        if (q && q.id && !questionMap.has(q.id)) {
            questionMap.set(q.id, q);
        }
    });
    return Array.from(questionMap.values());
  }, [papers]);

  const handleStartPractice = (practiceQuestions: Question[], title: string) => {
    const practicePaper: Paper = {
        id: `practice-${Date.now()}`,
        title: title,
        year: new Date().getFullYear(),
        class: profile?.role ? 10 : 0, // Placeholder
        semester: Semester.First, // Placeholder
        source: QuestionSource.Generated,
        questions: practiceQuestions,
        created_at: new Date().toISOString(),
    };
    setViewState({ view: 'test', paper: practicePaper });
  };
  
  const handleUpdateAttempt = async (updatedAttempt: TestAttempt) => {
    if (!updatedAttempt.db_id) {
        console.error("Attempt to update a record without a database ID.", updatedAttempt);
        showToast("Could not sync analysis.", 'error');
        return;
    }
    const { db_id, ...attemptData } = updatedAttempt;
    const { error } = await supabase
        .from('student_test_attempts')
        .update({ attempt_data: attemptData })
        .eq('id', db_id);

    if (error) {
        console.error("Error updating attempt analysis:", error?.message || error);
        showToast("Could not save AI analysis.", 'error');
    } else {
        setAttempts(prev => prev.map(a => a.db_id === db_id ? updatedAttempt : a));
    }
  };
  
  const handleSaveTutorResponse = async (queryText: string, queryImageUrl: string | null, responseText: string, responseImageUrl: string | undefined, tutorClass: number) => {
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
            response_image_url: responseImageUrl,
            tutor_class: tutorClass
        })
        .select()
        .single();
    
    if (error || !data) {
        console.error("Error saving tutor session:", error.message || error);
        showToast("Failed to save tutor session.", 'error');
    } else {
        setTutorSessions(prev => [data, ...prev]);
        showToast("Session saved!", 'success');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
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
        console.error("Error deleting tutor session:", error.message || error);
        showToast("Failed to delete session.", 'error');
    } else {
        setTutorSessions(prev => prev.filter(s => s.id !== sessionId));
        showToast("Session deleted.", 'success');
    }
  };

  const handleTabChange = (tab: StudentTab) => {
    setViewState({ view: tab });
  };
  
  const getActiveTab = (): StudentTab => {
    if(viewState.view === 'test') return 'dashboard'; // Or 'practice'
    if(viewState.view === 'results' && viewState.attemptId) return 'results';
    if (viewState.view === 'dashboard' || viewState.view === 'results' || viewState.view === 'settings' || viewState.view === 'practice' || viewState.view === 'ai_tutor' || viewState.view === 'test_papers' || viewState.view === 'classroom') {
        return viewState.view;
    }
    return 'dashboard';
  }

  const renderContent = () => {
    if (loading) {
        return <LoadingSpinner message={t('loading', lang)} />;
    }

    if (viewState.view === 'test') {
        return <PracticeTest 
                    paper={viewState.paper} 
                    lang={lang} 
                    onComplete={handleTestComplete} 
                    onQuit={() => setViewState({ view: 'dashboard' })}
                    assignmentId={viewState.assignmentId}
                />;
    }

    const currentView = viewState.view;
    return (
        <>
            <div style={{ display: currentView === 'dashboard' ? 'block' : 'none' }}>
                <StudentDashboard 
                    papers={papers}
                    attempts={attempts} 
                    tutorSessions={tutorSessions}
                    lang={lang} 
                    onStartTest={handleStartTest}
                    onViewResult={(attempt) => setViewState({ view: 'results', attemptId: attempt.db_id })}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                    showToast={showToast}
                    setViewState={setViewState}
                    setViewingMaterial={setViewingMaterial}
                />
            </div>
             <div style={{ display: currentView === 'classroom' ? 'block' : 'none' }}>
                <StudentClassroom
                    assignments={assignments}
                    attempts={attempts}
                    joinedClassrooms={joinedClassrooms}
                    onRefreshClassrooms={fetchJoinedClassrooms}
                    onStartTest={handleStartTest}
                    lang={lang}
                    showToast={showToast}
                    queries={studentQueries}
                    onRefreshQueries={fetchStudentQueries}
                />
            </div>
            <div style={{ display: currentView === 'results' ? 'block' : 'none' }}>
                <TestResults 
                    attempts={attempts}
                    papers={papers}
                    lang={lang}
                    initialAttemptId={viewState.view === 'results' ? viewState.attemptId : undefined}
                    onUpdateAttempt={handleUpdateAttempt}
                    onNavigateBack={() => setViewState({ view: 'results' })}
                    onStartTest={handleStartTest}
                    onGoToDashboard={() => setViewState({ view: 'dashboard' })}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                />
            </div>
            <div style={{ display: currentView === 'practice' ? 'block' : 'none' }}>
                <PracticeZone
                    allQuestions={allQuestionsForPractice}
                    lang={lang}
                    onStartPractice={handleStartPractice}
                    showToast={showToast}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                    onSetViewState={setViewState}
                    onSaveTutorResponse={handleSaveTutorResponse}
                />
            </div>
             <div style={{ display: currentView === 'ai_tutor' ? 'block' : 'none' }}>
                <AITutor
                    lang={lang}
                    showToast={showToast}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                    sessions={tutorSessions}
                    onSaveResponse={handleSaveTutorResponse}
                    onDeleteSession={handleDeleteSession}
                />
            </div>
            <div style={{ display: currentView === 'test_papers' ? 'block' : 'none' }}>
                <FinalExamPapers
                    lang={lang}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                    showToast={showToast}
                />
            </div>
            <div style={{ display: currentView === 'settings' ? 'block' : 'none' }}>
                <Settings
                    lang={lang}
                    profile={profile!}
                    onProfileUpdate={handleProfileUpdate}
                    onExport={handleExportData}
                    onImport={handleImportData}
                    onClear={handleClearData}
                    showToast={showToast}
                    userApiKey={userApiKey}
                    onSaveApiKey={handleSaveApiKey}
                    onRemoveApiKey={handleRemoveApiKey}
                    userOpenApiKey={userOpenApiKey}
                    onSaveOpenApiKey={handleSaveOpenApiKey}
                    onRemoveOpenApiKey={handleRemoveOpenApiKey}
                />
            </div>
        </>
    );
  };

  return (
    <>
       {viewState.view !== 'test' && (
         <Suspense fallback={<div className="h-28" />}>
           <Header lang={lang} onLangChange={setLang}>
             <Nav
                activeTab={getActiveTab()}
                onTabChange={handleTabChange}
                lang={lang}
              />
           </Header>
         </Suspense>
       )}
       <main className="flex-grow">
         <Suspense fallback={<LoadingSpinner message={t('loading', lang)} />}>
            {renderContent()}
         </Suspense>
       </main>
       {viewState.view !== 'test' && (
         <Suspense fallback={null}>
           <Footer lang={lang} />
         </Suspense>
       )}
       <Modal isOpen={viewingMaterial !== null} onClose={() => setViewingMaterial(null)} title={viewingMaterial?.title || 'Study Material'}>
            {viewingMaterial?.type === 'study_guide' && <MarkdownRenderer content={viewingMaterial.content.markdown} />}
            {viewingMaterial?.type === 'flashcards' && <FlashcardViewer flashcards={viewingMaterial.content} title={viewingMaterial.title} lang={lang} />}
        </Modal>
    </>
  );
};

export default StudentApp;
