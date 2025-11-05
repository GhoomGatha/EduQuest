import React, { createContext, useContext } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { Profile } from '../types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  setProfile: React.Dispatch<React.SetStateAction<Profile | null>>;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
}

// Export the context directly
export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  setProfile: () => {},
  setSession: () => {},
});

// Export the hook to consume the context
export const useAuth = (): AuthContextType => {
  return useContext(AuthContext);
};