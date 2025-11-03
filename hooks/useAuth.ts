
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
    // 1. Get the initial session to resolve the loading state quickly.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false); // Initial check is done, stop loading.
    });

    // 2. Listen for subsequent auth changes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // 3. Fetch the user profile whenever the session changes.
    if (session?.user) {
      setLoading(true);
      supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()
        .then(({ data, error }) => {
          if (error && error.code !== 'PGRST116') {
            console.error("Error fetching profile:", error);
          }
          setProfile(data || null);
          setLoading(false);
        }).catch(err => {
            console.error("Profile fetch promise rejected:", err);
            setProfile(null);
            setLoading(false);
        });
    } else {
      setProfile(null);
    }
  }, [session]);

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