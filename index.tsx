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
    // onAuthStateChange fires on initial load and whenever auth state changes.
    // This handles both the initial session check and subsequent updates,
    // fixing the race condition from the previous implementation.
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
            
            // 'PGRST116' means no row was found, which is valid for a new user.
            if (error && error.code !== 'PGRST116') {
                throw error;
            }
            if (data) {
                userProfile = data;
            }
          } catch (error: any) {
            console.error("Error fetching profile:", error.message);
          }
        }
        
        // If profile fetch fails or returns no data, create a temporary profile
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
        // Loading is complete once the initial auth state has been determined.
        setLoading(false);
      }
    );

    // Cleanup subscription on component unmount
    return () => {
      subscription?.unsubscribe();
    };
  }, []);


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