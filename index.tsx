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
    // This function performs the initial check for a session.
    const initializeAuth = async () => {
        try {
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) throw sessionError;

            let userProfile: Profile | null = null;
            if (session?.user) {
                try {
                    const { data, error } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', session.user.id)
                        .single();
                    
                    if (error && error.code !== 'PGRST116') throw error; // Ignore "row not found"
                    if (data) userProfile = data;
                } catch (error: any) {
                    console.error("Error fetching profile on initial load:", error.message);
                }

                if (!userProfile) {
                    userProfile = {
                        id: session.user.id,
                        full_name: '',
                        role: (session.user.app_metadata.role as any) || null,
                        avatar_url: ''
                    };
                }
            }
            setSession(session);
            setProfile(userProfile);
        } catch (error) {
            console.error("Error during initial auth check:", error);
            setSession(null);
            setProfile(null);
        } finally {
            // This is crucial: setLoading(false) is always called after the initial check.
            setLoading(false);
        }
    };

    initializeAuth();

    // After the initial check, this listener handles all subsequent auth changes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        let userProfile: Profile | null = null;
        if (session?.user) {
          try {
            const { data, error } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single();
            
            if (error && error.code !== 'PGRST116') throw error; // Ignore "row not found"
            if (data) userProfile = data;
          } catch (error: any) {
            console.error("Error fetching profile on auth state change:", error.message);
          }
        }

        if (session?.user && !userProfile) {
            userProfile = {
                id: session.user.id,
                full_name: '',
                role: (session.user.app_metadata.role as any) || null,
                avatar_url: ''
            };
        }
        
        setSession(session);
        setProfile(userProfile);
        // The loading state is no longer managed here, as it's only for the initial page load.
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