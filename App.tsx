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
const StudentApp = lazy(() => import('./components/StudentApp'));

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
        setToasts(prev => [...prev, { id: Date.now(), message, type }]);
    }, [lastQuotaErrorTimestamp]);

    const dismissToast = (id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    const checkSchema = useCallback(async (isRetry = false) => {
        // Check for the 'board' column, a more recent addition, to robustly verify the schema.
        const { error } = await supabase.from('papers').select('board').limit(1);

        if (error && (error.code === '42P01' || error.message.includes("does not exist") || error.code === '42703')) {
            console.error("Schema check failed:", error);
            
            // Robust error message extraction
            let errorMessage = 'An unknown database schema error occurred.';
            if (typeof error?.message === 'string') {
                errorMessage = error.message;
            } else {
                try {
                    // Provide a more descriptive stringified version of the error
                    errorMessage = `Unexpected error format: ${JSON.stringify(error)}`;
                } catch {
                    errorMessage = 'An unreadable database schema error object was received.';
                }
            }
            setSchemaError(errorMessage);
        } else {
            // Schema is valid on the database side.
            if (isRetry) {
                // If this was a retry from the setup page, the client's schema cache is stale.
                // Reload the page to force the Supabase client to re-initialize and fetch the new schema.
                window.location.reload();
            } else {
                // Initial check passed, no need to reload.
                setSchemaError(false);
            }
        }
    }, []);

    useEffect(() => {
        if (session) {
            checkSchema(); // Initial check on app load.
            // Set session start time on login/refresh
            if (!sessionStorage.getItem('eduquest_current_session_start')) {
                sessionStorage.setItem('eduquest_current_session_start', new Date().toISOString());
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