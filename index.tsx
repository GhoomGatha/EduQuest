import React, { useState, useEffect, useMemo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthContext } from './hooks/useAuth'; // Import context, not provider component
import { supabase } from './services/supabaseClient';
import { Session } from '@supabase/supabase-js';
import { Profile } from './types';

// The provider logic is now here, in a .tsx file where JSX is natural.
const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true); // Represents initial app load status

  useEffect(() => {
    // This effect runs once on mount to handle initial auth state and set up listener.
    const initializeAuth = async () => {
      // 1. Get initial session
      try {
        const { data: { session: initialSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        // 2. Fetch profile only if session exists
        if (initialSession?.user) {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', initialSession.user.id)
            .single();
            
          if (error || !data) {
            console.error("Profile fetch failed on init, treating user as logged out for this render.", error);
            // By setting state to null but NOT calling signOut(), we allow a refresh to retry the fetch
            // while the session token is still persisted in localStorage.
            setSession(null);
            setProfile(null);
          } else {
            // Success
            setSession(initialSession);
            setProfile(data);
          }
        } else {
          // No initial session, ensure state is clean.
          setSession(null);
          setProfile(null);
        }
      } catch (error: any) {
        console.error("Error during initial auth:", error.message);
        setSession(null);
        setProfile(null);
      } finally {
        // 3. Initial loading is complete regardless of outcome
        setLoading(false);
      }
    };
    
    initializeAuth();

    // 4. Set up auth state change listener as the single source of truth.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (newSession?.user) {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', newSession.user.id)
            .single();

          if (data && !error) {
            setSession(newSession);
            setProfile(data);
          } else {
            console.error("Profile fetch failed on auth state change. Treating user as logged out for this render.", error);
            // Don't sign out, just clear the application state.
            setSession(null);
            setProfile(null);
          }
        } else {
          // User is logged out, clear both session and profile.
          setSession(null);
          setProfile(null);
        }
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []); // Empty dependency array ensures this runs only once.

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    setProfile,
    setSession,
  }), [session, profile, loading]);

  // Use the correct React 19 JSX syntax for the provider.
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);