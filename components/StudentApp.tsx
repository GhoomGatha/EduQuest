
import React, { useState, useEffect, useCallback, lazy, Suspense, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../services/supabaseClient';
import { Paper, TestAttempt, StudentTab, Language, Profile, Question, QuestionSource, Semester, Difficulty } from '../types';
import { STUDENT_ATTEMPTS_KEY } from '../constants';
import { t } from '../utils/localization';
import LoadingSpinner from './LoadingSpinner';
import { OPENAI_API_KEY_STORAGE_KEY } from '../services/openaiService';

const Header = lazy(() => import('./student/Header'));
const Nav = lazy(() => import('./student/Nav'));
const Footer = lazy(() => import('./student/Footer'));
const StudentDashboard = lazy(() => import('./student/StudentDashboard'));
const PracticeTest = lazy(() => import('./student/PracticeTest'));
const TestResults = lazy(() => import('./student/TestResults'));
const Settings = lazy(() => import('./student/Settings'));
const PracticeZone = lazy(() => import('./student/PracticeZone'));

const LANGUAGE_STORAGE_KEY = 'eduquest_lang';
const API_KEY_STORAGE_KEY = 'eduquest_user_api_key';

interface StudentAppProps {
  showToast: (message: string, type?: 'success' | 'error') => void;
}

type ViewState = 
    | { view: 'dashboard' }
    | { view: 'results'; attemptId?: string }
    | { view: 'practice' }
    | { view: 'settings' }
    | { view: 'test'; paper: Paper };


const StudentApp: React.FC<StudentAppProps> = ({ showToast }) => {
  const { profile, setProfile, session } = useAuth();
  const [viewState, setViewState] = useState<ViewState>({ view: 'dashboard' });
  
  const [papers, setPapers] = useState<Paper[]>([]);
  const [attempts, setAttempts] = useState<TestAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Language>('en');
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [userOpenApiKey, setUserOpenApiKey] = useState<string>('');

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
  }, [lang]);

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
        showToast('Failed to load tests.', 'error');
    } else {
        setPapers(data || []);
    }
  }, [showToast, profile]);

  const fetchAttempts = useCallback(async () => {
    if (!session?.user) return [];
    const { data, error } = await supabase
        .from('student_test_attempts')
        .select('id, attempt_data')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching attempts:', error.message || error);
        showToast('Failed to load past results.', 'error');
        return [];
    }
    return data.map(row => ({ ...row.attempt_data, db_id: row.id })) || [];
  }, [session, showToast]);


  useEffect(() => {
    const loadData = async () => {
        setLoading(true);
        await fetchPapers();
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
                        showToast("Your past results have been synced to your account.", 'success');
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
        setLoading(false);
    };

    // Ensure both session and profile are loaded before fetching any user-specific data.
    if (session?.user && profile?.id) {
        loadData();
    } else {
        // If there's no user, we can stop loading as there's no data to fetch.
        setLoading(false);
    }
  }, [session, profile, fetchPapers, fetchAttempts, showToast]);


  const handleTestComplete = async (attempt: TestAttempt) => {
    if (!session?.user) {
        showToast("You must be logged in to save results.", 'error');
        return;
    }
    const { db_id, ...attemptData } = attempt;
    const { data, error } = await supabase
        .from('student_test_attempts')
        .insert({ user_id: session.user.id, attempt_data: attemptData })
        .select('id, attempt_data')
        .single();
    
    if (error || !data) {
        console.error("Error saving test attempt:", error?.message || error);
        showToast("Could not save your test results.", 'error');
        setAttempts(prev => [attempt, ...prev]); // Fallback to local state for this session
    } else {
        const savedAttemptWithId = { ...data.attempt_data, db_id: data.id };
        setAttempts(prev => [savedAttemptWithId, ...prev]);
        showToast('Test submitted successfully!', 'success');
    }
    setViewState({ view: 'results', attemptId: attempt.paperId + attempt.completedAt });
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
        const { error } = await supabase.from('student_test_attempts').delete().eq('user_id', session!.user.id);
        if(error){
            showToast('Could not clear data.', 'error');
        } else {
            setAttempts([]);
            showToast(t('dataCleared', lang), 'error');
        }
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

  const handleTabChange = (tab: StudentTab) => {
    setViewState({ view: tab });
  };
  
  const getActiveTab = (): StudentTab => {
    if(viewState.view === 'test') return 'dashboard'; // Or 'practice'
    if(viewState.view === 'results' && viewState.attemptId) return 'results';
    if (viewState.view === 'dashboard' || viewState.view === 'results' || viewState.view === 'settings' || viewState.view === 'practice') {
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
                />;
    }

    const currentView = viewState.view;
    return (
        <>
            <div style={{ display: currentView === 'dashboard' ? 'block' : 'none' }}>
                <StudentDashboard 
                    papers={papers} 
                    attempts={attempts} 
                    lang={lang} 
                    onStartTest={(paper) => setViewState({ view: 'test', paper })}
                    onViewResult={(attempt) => setViewState({ view: 'results', attemptId: attempt.paperId + attempt.completedAt })}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
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
                    onStartTest={(paper) => setViewState({ view: 'test', paper })}
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
    </>
  );
};

export default StudentApp;
