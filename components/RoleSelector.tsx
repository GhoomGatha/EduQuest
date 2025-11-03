import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabaseClient';
import { Profile, Role } from '../types';

const RoleSelector: React.FC = () => {
  const { user, profile, setProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRoleSelect = async (role: Role) => {
    if (!user || !profile) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;
      setProfile(data as Profile);
    } catch (err: any) {
      setError(err.message);
      console.error("Failed to set role:", err);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg text-center">
        <h1 className="text-3xl font-bold font-serif-display text-slate-800">One Last Step!</h1>
        <p className="text-slate-600">
          Please tell us who you are to personalize your experience. This choice cannot be changed later.
        </p>
        {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
        <div className="flex flex-col sm:flex-row gap-4 pt-4">
          <button
            onClick={() => handleRoleSelect('teacher')}
            disabled={loading}
            className="flex-1 px-4 py-3 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-semibold transition-transform hover:scale-105 disabled:bg-indigo-400"
          >
            I am a Teacher
          </button>
          <button
            onClick={() => handleRoleSelect('student')}
            disabled={loading}
            className="flex-1 px-4 py-3 text-white bg-green-600 rounded-lg hover:bg-green-700 font-semibold transition-transform hover:scale-105 disabled:bg-green-400"
          >
            I am a Student
          </button>
        </div>
      </div>
    </div>
  );
};

export default RoleSelector;
