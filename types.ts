





export enum Difficulty {
  Easy = 'Easy',
  Moderate = 'Moderate',
  Hard = 'Hard',
}

export enum Semester {
  First = '1',
  Second = '2',
  Third = '3',
}

export enum QuestionSource {
  Manual = 'Manual',
  Upload = 'Upload',
  Scan = 'Scan',
  Generated = 'Generated',
}

export interface UsedIn {
  year: number;
  semester: Semester;
  paperId: string;
}

export interface Question {
  id: string;
  user_id?: string;
  class: number;
  chapter: string;
  text: string;
  answer?: string;
  marks: number;
  difficulty: Difficulty;
  used_in: UsedIn[];
  source: QuestionSource;
  year: number;
  semester: Semester;
  tags: string[];
  image_data_url?: string;
  created_at?: string;
}

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface Paper {
  id: string;
  user_id?: string;
  title: string;
  year: number;
  class: number;
  semester: Semester;
  source: QuestionSource;
  file_type?: string; // For backward compatibility
  file_types?: string[];
  text?: string;
  data_url?: string; // For backward compatibility
  data_urls?: string[];
  questions: Question[];
  created_at: string;
  grounding_sources?: GroundingSource[];
  board?: string;
  subject?: string;
  time_limit_minutes?: number;
}

export type Role = 'teacher' | 'student';

export interface Profile {
  id: string;
  full_name: string;
  role: Role | null;
  avatar_url?: string;
}

export type Language = 'en' | 'bn' | 'hi' | 'ka';

export type Tab = 'bank' | 'generator' | 'ai_tutor' | 'archive' | 'settings' | 'test_papers' | 'classroom';

export interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error';
}

// Student-specific types
export type StudentTab = 'dashboard' | 'results' | 'practice' | 'ai_tutor' | 'settings' | 'test_papers' | 'classroom';

export interface StudentAnswer {
  questionId: string;
  answer: string;
}

export interface Analysis {
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface TestAttempt {
  db_id?: string; // Unique ID from the database table
  paperId: string;
  paperTitle: string;
  studentAnswers: StudentAnswer[];
  score: number;
  totalMarks: number;
  completedAt: string;
  class: number;
  year: number;
  semester: Semester;
  analysis?: Analysis;
  paper: Paper;
  assignmentId?: string;
}

export interface Flashcard {
  question: string;
  answer: string;
}

export interface DiagramSuggestion {
  name: string;
  description: string;
  image_prompt: string;
}

export interface DiagramGrade {
  score?: number;
  strengths: string[];
  areasForImprovement: string[];
  feedback: string;
}

export interface PracticeSuggestion {
  chapter: string;
  topic: string;
  reason: string;
}

export interface UploadProgress {
  total: number;
  completed: number;
  pending: number;
  currentFile: string;
  error?: string;
}

export interface StudyMaterial {
  id: string;
  user_id: string;
  created_at: string;
  type: 'study_guide' | 'flashcards';
  title: string;
  content: any; // jsonb can be string for guide, or Flashcard[] for flashcards
}

export interface TutorSession {
  id: string;
  user_id: string;
  created_at: string;
  query_text?: string;
  query_image_url?: string;
  response_text: string;
  response_image_url?: string;
  tutor_class: number;
}
// FIX: Export ViewState for use in multiple components.
export type ViewState = 
    | { view: 'dashboard' }
    | { view: 'results'; attemptId?: string }
    | { view: 'practice' }
    | { view: 'ai_tutor' }
    | { view: 'settings' }
    | { view: 'test_papers' }
    | { view: 'classroom' }
    | { view: 'live_class'; classroom: Classroom }
    | { view: 'test'; paper: Paper; assignmentId?: string };

// Unified type for activity feeds
export type ActivityItem = {
  id: string;
  type: 'question' | 'paper' | 'tutor_session' | 'test_attempt' | 'study_material';
  timestamp: string;
  title: string;
  data: Question | Paper | TutorSession | TestAttempt | StudyMaterial;
};

// Types for Final Exam Papers
export interface FinalExamPaperQuestion {
    q_num: string; // e.g., "1.1", "2. (a)"
    text: string;
    marks: number;
    options?: string[]; // For MCQs
    answer?: string; // Optional answer key
}

export interface FinalExamPaper {
    id: string; // UUID
    board: string;
    class: number;
    subject: string;
    exam_year: number;
    paper_content: {
        title: string;
        sections: {
            title: string;
            questions: FinalExamPaperQuestion[];
        }[];
    };
    created_at: string;
    grounding_sources?: GroundingSource[];
}

// Classroom and Assignment types
export interface Classroom {
  id: string; // uuid
  teacher_id: string; // uuid
  name: string;
  class_details: {
    class: number;
    subject: string;
  };
  invite_code: string;
  created_at: string;
  student_count?: number; // from an aggregate query
  teacher_profile?: Profile;
  is_live?: boolean;
}

export interface ClassroomStudent {
  student_id: string;
  joined_at: string;
  profile: Profile;
}

export interface Assignment {
  id: string; // uuid
  paper_id: string;
  paper_snapshot: Paper;
  classroom_id: string;
  teacher_id: string;
  due_date: string;
  time_limit_minutes: number;
  created_at: string;
}

export interface AssignmentSubmission {
  id: string; // uuid
  created_at: string;
  assignment_id: string; // uuid
  student_id: string; // uuid
  teacher_id: string; // uuid
  attempt_data: TestAttempt;
  // Joined data
  student_profile?: Pick<Profile, 'full_name' | 'avatar_url'>;
}

export interface StudentQuery {
  id: string; // uuid
  created_at: string;
  student_id: string; // uuid
  teacher_id: string; // uuid
  classroom_id: string; // uuid
  query_text: string;
  query_image_url?: string;
  status: 'asked' | 'answered';
  answer_text?: string;
  answered_at?: string;
  // Joined data
  student_profile?: Pick<Profile, 'full_name' | 'avatar_url'>;
  classroom?: { name: string };
}