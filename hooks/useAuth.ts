
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

    // Helper to fetch and set the user profile
    const fetchUserProfile = async (user: User | null) => {
      if (!user) {
        if (isMounted) setProfile(null);
        return;
      }
      try {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (profileError && profileError.code !== 'PGRST116') { // PGRST116: no rows found
          throw profileError;
        }
        if (isMounted) setProfile(profileData || null);
      } catch (error) {
        console.error("Error fetching profile:", error);
        if (isMounted) setProfile(null); // Clear profile on error
      }
    };

    // Handle the initial session check on app load
    const initializeAuth = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (isMounted) setSession(currentSession);
        // Fetch profile before setting loading to false
        await fetchUserProfile(currentSession?.user ?? null);
      } catch (error) {
        console.error("Auth initialization error:", error);
        // Ensure state is clean on error
        if (isMounted) {
            setSession(null);
            setProfile(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    
    initializeAuth();

    // Set up a listener for auth state changes (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        // When auth state changes, enter loading state
        if (isMounted) setLoading(true);
        if (isMounted) setSession(newSession);
        // Fetch the new user's profile
        await fetchUserProfile(newSession?.user ?? null);
        // Exit loading state once everything is updated
        if (isMounted) setLoading(false);
      }
    );

    // Cleanup subscription on unmount
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
