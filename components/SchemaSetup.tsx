import React, { useState } from 'react';

interface SchemaSetupProps {
  onRetry: () => void;
  errorMessage: string | false;
}

const sqlScript = `-- EduQuest Supabase Schema Setup
-- Run this script in your Supabase project's SQL Editor.
-- It's safe to run multiple times; it will create tables/columns only if they don't exist.

-- Storage Buckets: This part must be done manually in the Supabase Dashboard.
-- 1. Go to Storage -> Buckets -> Create Bucket. Create a bucket named 'avatars', and check 'Public bucket'.
-- 2. Create another bucket named 'question_images', and check 'Public bucket'.
-- 3. Create a third bucket named 'papers', and check 'Public bucket'. This is for the Exam Archive.
-- 4. Add the policies mentioned in the comments below to each bucket.

-- Policy for 'avatars' bucket
-- Name: "User can manage their own avatar folder."
-- Applies to: ALL actions (SELECT, INSERT, UPDATE, DELETE)
-- Target roles: authenticated
-- USING expression: ( bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text )

-- Policy for 'question_images' bucket (Read)
-- Name: "Public read access for question images"
-- Applies to: SELECT
-- Target roles: anon, authenticated
-- USING expression: ( bucket_id = 'question_images' )

-- Policy for 'question_images' bucket (Write)
-- Name: "Users can manage their own question images"
-- Applies to: INSERT, UPDATE, DELETE
-- Target roles: authenticated
-- USING expression: ( bucket_id = 'question_images' AND (storage.foldername(name))[1] = auth.uid()::text )

-- Policy for 'papers' bucket (Read)
-- Name: "Public read access for papers"
-- Applies to: SELECT
-- Target roles: anon, authenticated
-- USING expression: ( bucket_id = 'papers' )

-- Policy for 'papers' bucket (Write)
-- Name: "Users can manage their own papers"
-- Applies to: INSERT, UPDATE, DELETE
-- Target roles: authenticated
-- USING expression: ( bucket_id = 'papers' AND (storage.foldername(name))[1] = auth.uid()::text )


-- 1. PROFILES TABLE
-- Stores public user data.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  role text,
  updated_at timestamptz
);

-- Add 'role' column if it's missing (for migrations)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text;

-- Enable Row Level Security (RLS) for profiles and create policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update their own profile." ON public.profiles;
CREATE POLICY "Users can update their own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2. Function and Trigger to create a profile for new users
-- This function captures the 'role' from the user's metadata during sign-up.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (new.id, new.raw_user_meta_data->>'role');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger to ensure it uses the latest function definition.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. QUESTIONS TABLE
-- Stores all questions created by users.
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  class integer NOT NULL,
  chapter text NOT NULL,
  text text NOT NULL,
  answer text,
  marks integer NOT NULL,
  difficulty text NOT NULL,
  used_in jsonb DEFAULT '[]'::jsonb,
  source text NOT NULL,
  year integer NOT NULL,
  semester text NOT NULL,
  tags text[],
  image_data_url text
);

-- Enable RLS for questions and create policy
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own questions." ON public.questions;
CREATE POLICY "Users can manage their own questions." ON public.questions FOR ALL USING (auth.uid() = user_id);

-- 4. PAPERS TABLE
-- Stores generated or uploaded question papers.
CREATE TABLE IF NOT EXISTS public.papers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  title text NOT NULL,
  year integer NOT NULL,
  class integer NOT NULL,
  semester text NOT NULL,
  board text,
  source text NOT NULL,
  file_type text,
  text text,
  data_url text,
  questions jsonb DEFAULT '[]'::jsonb,
  grounding_sources jsonb
);

-- Add 'grounding_sources' column if it's missing (for migrations)
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS grounding_sources jsonb;
-- Add columns for multi-file support
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS data_urls text[];
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS file_types text[];
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS board text;
ALTER TABLE public.papers ADD COLUMN IF NOT EXISTS subject text;


-- Enable RLS for papers and create policy
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own papers." ON public.papers;
CREATE POLICY "Users can manage their own papers." ON public.papers FOR ALL USING (auth.uid() = user_id);

-- 5. STUDENT TEST ATTEMPTS TABLE
-- Stores all test attempts by students.
CREATE TABLE IF NOT EXISTS public.student_test_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  attempt_data jsonb NOT NULL
);

-- Enable RLS for attempts and create policy
ALTER TABLE public.student_test_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own test attempts." ON public.student_test_attempts;
CREATE POLICY "Users can manage their own test attempts." ON public.student_test_attempts FOR ALL USING (auth.uid() = user_id);

-- 6. CHAPTERS TABLE
-- Stores cached chapter lists to reduce API calls.
CREATE TABLE IF NOT EXISTS public.chapters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board text NOT NULL,
  class integer NOT NULL,
  lang text NOT NULL,
  chapters_list text[] NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Add 'subject' and 'semester' columns for better caching (for migrations)
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.chapters ADD COLUMN IF NOT EXISTS semester text;


-- Update the unique constraint to include subject and semester.
-- This is idempotent and handles both new and existing tables.
ALTER TABLE public.chapters DROP CONSTRAINT IF EXISTS chapters_unique_constraint;
ALTER TABLE public.chapters ADD CONSTRAINT chapters_unique_constraint UNIQUE (board, class, lang, subject, semester);


-- Enable RLS for chapters and create policies
-- (These policies are idempotent because of DROP IF EXISTS)
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Chapters are publicly viewable." ON public.chapters;
CREATE POLICY "Chapters are publicly viewable." ON public.chapters FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can add chapters." ON public.chapters;
CREATE POLICY "Authenticated users can add chapters." ON public.chapters FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update chapters." ON public.chapters;
CREATE POLICY "Authenticated users can update chapters." ON public.chapters FOR UPDATE USING (auth.role() = 'authenticated');

-- 7. SUBJECTS TABLE
-- Stores cached subject lists to reduce API calls.
CREATE TABLE IF NOT EXISTS public.subjects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board text NOT NULL,
  class integer NOT NULL,
  lang text NOT NULL,
  subjects_list text[] NOT NULL,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT subjects_unique_constraint UNIQUE (board, class, lang)
);

-- Enable RLS for subjects and create policies
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Subjects are publicly viewable." ON public.subjects;
CREATE POLICY "Subjects are publicly viewable." ON public.subjects FOR SELECT USING (true);
DROP POLICY IF EXISTS "Authenticated users can add subjects." ON public.subjects;
CREATE POLICY "Authenticated users can add subjects." ON public.subjects FOR INSERT WITH CHECK (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Authenticated users can update subjects." ON public.subjects;
CREATE POLICY "Authenticated users can update subjects." ON public.subjects FOR UPDATE USING (auth.role() = 'authenticated');

-- 8. STUDENT GENERATED CONTENT TABLE
-- Stores study guides, flashcards, etc., generated by students in the Practice Zone.
CREATE TABLE IF NOT EXISTS public.student_generated_content (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  type text NOT NULL, -- e.g., 'study_guide', 'flashcards'
  title text NOT NULL,
  content jsonb NOT NULL
);

-- Enable RLS for student_generated_content and create policy
ALTER TABLE public.student_generated_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can manage their own generated content." ON public.student_generated_content;
CREATE POLICY "Students can manage their own generated content." ON public.student_generated_content FOR ALL USING (auth.uid() = user_id);

-- 9. TUTOR SESSIONS TABLE
-- Stores saved conversations from the student's AI Tutor.
CREATE TABLE IF NOT EXISTS public.tutor_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  query_text text,
  query_image_url text,
  response_text text NOT NULL,
  tutor_class integer
);

-- Enable RLS for tutor_sessions and create policy
ALTER TABLE public.tutor_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students can manage their own tutor sessions." ON public.tutor_sessions;
CREATE POLICY "Students can manage their own tutor sessions." ON public.tutor_sessions FOR ALL USING (auth.uid() = user_id);
`;

const SchemaSetup: React.FC<SchemaSetupProps> = ({ onRetry, errorMessage }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-3xl p-8 space-y-6 bg-white rounded-xl shadow-lg">
        <h1 className="text-3xl font-bold text-center font-serif-display text-slate-800">
          Database Setup Required
        </h1>
        <p className="text-center text-slate-600">
          Welcome to EduQuest! To get started, you need to set up your database tables. Please follow the steps below.
        </p>
        {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-lg text-sm text-left">
                <p className="font-bold">An error was detected while trying to access your data:</p>
                <p className="font-mono mt-2">{errorMessage}</p>
                <p className="mt-2">This usually means the database schema is missing or outdated. Please run the script below to fix it.</p>
            </div>
        )}
        <div className="space-y-4 text-left">
          <div>
            <h2 className="font-semibold text-lg text-slate-700">Step 1: Go to the SQL Editor in Supabase</h2>
            <p className="text-sm text-slate-500">
              Open your Supabase project dashboard, find the "SQL Editor" section in the sidebar (it has a <code className="bg-slate-200 text-xs p-1 rounded">{'<>'}</code> icon), and click on "New query".
            </p>
          </div>
          <div>
            <h2 className="font-semibold text-lg text-slate-700">Step 2: Copy and Run the SQL Script</h2>
            <p className="text-sm text-slate-500 mb-2">
              Click the button below to copy the entire SQL script. Paste it into the SQL Editor and click "Run". This will create all the necessary tables and security policies for the app to function correctly. If you have an existing setup, the script will safely add any missing columns.
            </p>
            <div className="relative">
              <pre className="bg-slate-800 text-white p-4 rounded-lg text-xs overflow-auto max-h-60">
                <code>{sqlScript}</code>
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-2 right-2 px-3 py-1 bg-slate-600 text-white text-xs font-semibold rounded-md hover:bg-slate-500 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy SQL'}
              </button>
            </div>
             <p className="text-sm text-slate-500 mt-2">
              <strong>Important:</strong> You also need to create Storage buckets named "avatars", "question_images", and "papers" and set their policies for profile pictures and question papers to work. The instructions are commented at the top of the SQL script.
            </p>
          </div>
          <div>
            <h2 className="font-semibold text-lg text-slate-700">Step 3: All Done!</h2>
            <p className="text-sm text-slate-500">
              Once the script has finished running successfully, come back here and click the button below to continue to the app.
            </p>
          </div>
        </div>
        <button
          onClick={onRetry}
          className="w-full mt-4 px-4 py-3 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-semibold transition-transform hover:scale-105"
        >
          I've run the script, let's go!
        </button>
      </div>
    </div>
  );
};

export default SchemaSetup;
