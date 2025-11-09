import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import Auth from './components/Auth';
import ProfileComponent from './components/Profile';
import RoleSelector from './components/RoleSelector';
import LoadingSpinner from './components/LoadingSpinner';
import SchemaSetup from './components/SchemaSetup';
import { ToastContainer } from './components/Toast';
import { ToastMessage } from './types';
import { supabase } from './services/supabaseClient';

const TeacherApp = lazy(() => import('./TeacherApp'));
const StudentApp = lazy(() => import('./StudentApp'));

const App: React.FC = () => {
    const { session, profile, loading } = useAuth();
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [schemaError, setSchemaError] = useState<string | false>(false);
    const [lastQuotaErrorTimestamp, setLastQuotaErrorTimestamp] = useState(0);

    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        // Throttle identical, repeated quota/rate limit errors to avoid spamming the user.
        if (type === 'error' && (message.toLowerCase().includes('quota') || message.toLowerCase().includes('rate limit'))) {
            const now = Date.now();
            if (now - lastQuotaErrorTimestamp < 10000) { // 10-second cooldown
                console.warn("Throttling quota error toast:", message);
                return; // Suppress the toast
            }
            setLastQuotaErrorTimestamp(now);
        }

        let finalMessage = message;
        // Check for the generic network error and replace it with a more helpful message.
        if (type === 'error' && message.toLowerCase().includes('failed to fetch')) {
            finalMessage = "Network Error: Could not connect to the server. Please check your internet connection, disable any ad-blockers, and try again.";
        }

        setToasts(prev => [...prev, { id: Date.now(), message: finalMessage, type }]);
    }, [lastQuotaErrorTimestamp]);

    const dismissToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    const checkSchema = useCallback(async (isRetry = false) => {
        const handleSchemaError = (error: any) => {
             console.error("Schema check failed:", error);
            let errorMessage = 'An unknown database schema error occurred.';
            if (typeof error?.message === 'string') {
                errorMessage = error.message;
            } else {
                try {
                    errorMessage = `Unexpected error format: ${JSON.stringify(error)}`;
                } catch {
                    errorMessage = 'An unreadable database schema error object was received.';
                }
            }
            setSchemaError(errorMessage);
        };

        // Check 1: 'papers' table columns ('board', 'subject')
        const { error: papersError } = await supabase.from('papers').select('board, subject').limit(1);
        if (papersError && (papersError.code === '42P01' || papersError.message.includes("does not exist") || papersError.code === '42703')) {
            handleSchemaError(papersError);
            return;
        }

        // Check 2: 'chapters' table columns ('subject', 'semester')
        const { error: chaptersError } = await supabase.from('chapters').select('subject, semester').limit(1);
        if (chaptersError && (chaptersError.code === '42P01' || chaptersError.message.includes("does not exist") || chaptersError.code === '42703')) {
            handleSchemaError(chaptersError);
            return;
        }

        // Check 3: 'final_exam_papers' table
        const { error: finalPapersError } = await supabase.from('final_exam_papers').select('id').limit(1);
        if (finalPapersError && (finalPapersError.code === '42P01' || finalPapersError.message.includes("does not exist"))) {
            handleSchemaError(finalPapersError);
            return;
        }
        
        // Check 4: 'tutor_sessions' table column 'response_image_url'
        const { error: tutorSessionsError } = await supabase.from('tutor_sessions').select('response_image_url').limit(1);
        if (tutorSessionsError && (tutorSessionsError.code === '42P01' || tutorSessionsError.message.includes("does not exist") || tutorSessionsError.code === '42703')) {
            handleSchemaError(tutorSessionsError);
            return;
        }
        
        // Check 5: 'assignments' table (for student classroom features)
        const { error: assignmentsError } = await supabase.from('assignments').select('id').limit(1);
        if (assignmentsError && (assignmentsError.code === '42P01' || assignmentsError.message.includes("does not exist"))) {
            handleSchemaError(assignmentsError);
            return;
        }


        // If all checks pass
        if (isRetry) {
            // If this was a retry from the setup page, the client's schema cache is stale.
            // Reload the page to force the Supabase client to re-initialize and fetch the new schema.
            window.location.reload();
        } else {
            // Initial check passed, no need to reload.
            setSchemaError(false);
        }
    }, []);

    useEffect(() => {
        if (session?.user?.id) {
            checkSchema(); // Initial check on app load.
    
            const currentSessionKey = `eduquest_current_session_start_${session.user.id}`;
            const lastLoginKey = `eduquest_last_login_${session.user.id}`;
    
            // This effect runs on login and on every refresh. We only act if it's a new session.
            if (!sessionStorage.getItem(currentSessionKey)) {
                const now = new Date().toISOString();
    
                // The start time of the session that just ended (stored in localStorage) becomes the new "Last Login" time.
                const previousSessionStart = localStorage.getItem(currentSessionKey);
                if (previousSessionStart) {
                    localStorage.setItem(lastLoginKey, previousSessionStart);
                }
    
                // Store the start time of this new session for the *next* time the user logs in.
                localStorage.setItem(currentSessionKey, now);
    
                // Also store it in sessionStorage to differentiate new sessions from page refreshes.
                sessionStorage.setItem(currentSessionKey, now);
            }
        }
    }, [session, checkSchema]);

    if (loading) {
        return <LoadingSpinner message="Loading EduQuest..." />;
    }

    if (schemaError) {
        // Pass a function that calls checkSchema with isRetry=true.
        return <SchemaSetup onRetry={() => checkSchema(true)} errorMessage={schemaError} />;
    }

    if (!session) {
        return <Auth />;
    }

    if (!profile) {
        // This case handles a failed profile fetch after login or a new user whose profile trigger hasn't completed.
        return <LoadingSpinner message="Verifying account details..." />;
    }

    if (!profile?.full_name) {
        return <ProfileComponent />;
    }

    if (!profile.role) {
        return <RoleSelector />;
    }

    return (
        <div className="flex flex-col min-h-screen bg-slate-100">
            <Suspense fallback={<LoadingSpinner message="Loading App..." />}>
                {profile.role === 'teacher' ? <TeacherApp showToast={showToast} /> : <StudentApp showToast={showToast} />}
            </Suspense>
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
};

export default App;