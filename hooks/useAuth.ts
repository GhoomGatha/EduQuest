

import React, { useState, useEffect, createContext, useContext, ReactNode, useMemo } from 'react';
import { supabase } from '../services/supabaseClient';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  setProfile: React.Dispatch<React.SetStateAction<Profile | null>>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  setProfile: () => {},
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const AUTH_TIMEOUT = 8000; // 8 seconds

    const fetchInitialSession = async () => {
      try {
        const sessionPromise = supabase.auth.getSession();
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Authentication timed out.')), AUTH_TIMEOUT)
        );

        // Race the getSession call against the timeout
        const { data: { session: currentSession }, error: sessionError } = await Promise.race([
            sessionPromise, 
            timeoutPromise
        ]) as { data: { session: Session | null }, error: any };

        if (!isMounted) return;

        if (sessionError) throw sessionError;

        setSession(currentSession);

        if (currentSession?.user) {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentSession.user.id)
            .single();

          if (profileError && profileError.code !== 'PGRST116') {
            throw profileError;
          }
          if (isMounted) {
            setProfile(profileData || null);
          }
        } else {
            if (isMounted) {
                setProfile(null);
            }
        }
      } catch (error: any) {
        console.warn("Auth initialization error:", error.message);
        if (isMounted) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchInitialSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!isMounted) return;

        // If the session changes, update it. This handles login/logout.
        setSession(newSession);

        if (!newSession?.user) {
          setProfile(null);
          return;
        }

        // If a new session appears, re-fetch profile to be sure.
        // This is important for cases like sign-in, where profile might not have been available initially.
        try {
          const { data: profileData, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', newSession.user.id)
            .single();
          
          if (profileError && profileError.code !== 'PGRST116') {
            throw profileError;
          }
          if (isMounted) {
             setProfile(profileData || null);
          }
        } catch (error) {
          console.error("Error fetching profile on auth state change:", error);
          if (isMounted) {
            setProfile(null);
          }
        }
      }
    );
    
    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    setProfile,
  }), [session, profile, loading]);

  return React.createElement(AuthContext.Provider, { value: value }, children);
};

export const useAuth = () => {
  return useContext(AuthContext);
};