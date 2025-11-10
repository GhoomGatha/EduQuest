import { Tab, StudentTab } from './types';

export const LOCAL_STORAGE_KEY = 'eduquest_v1_0';
export const API_KEY_STORAGE_KEY = 'eduquest_user_api_key'; // Gemini
export const OPENAI_API_KEY_STORAGE_KEY = 'eduquest_user_openai_api_key'; // OpenAI
// FIX: Export LANGUAGE_STORAGE_KEY to be used across the application for storing language preference.
export const LANGUAGE_STORAGE_KEY = 'eduquest_lang';
export const FINAL_EXAM_PAPERS_FILTERS_KEY = 'eduquest_final_exam_filters_v1';
export const TEACHER_CURRICULUM_PREFS_KEY = 'eduquest_teacher_curriculum_prefs_v1';
export const CURRENT_YEAR = new Date().getFullYear();
export const YEARS = Array.from({ length: 26 }, (_, i) => 2020 + i);
export const CLASSES = [7, 8, 9, 10, 11, 12];
export const MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25];
export const SEMESTERS = ['1', '2', '3'];
export const BOARDS = ['WBBSE', 'WBCHSE', 'CBSE', 'ICSE', 'ISC'];

export const TABS: { id: Tab; name: string; icon: string }[] = [
  { id: 'ai_tutor', name: 'AI Tutor', icon: '🧑‍🏫' },
  { id: 'classroom', name: 'Classroom', icon: '🧑‍🎓' },
  { id: 'generator', name: 'Generator', icon: '🧾' },
  { id: 'archive', name: 'Archive', icon: '📚' },
  { id: 'bank', name: 'Question Bank', icon: '🧠' },
  { id: 'test_papers', name: 'Test Papers', icon: '📜' },
  { id: 'settings', name: 'Settings', icon: '⚙️' },
];

export const STUDENT_TABS: { id: StudentTab; name: string; icon: string }[] = [
  { id: 'dashboard', name: 'Dashboard', icon: '🏠' },
  { id: 'classroom', name: 'My Classroom', icon: '🏫' },
  { id: 'ai_tutor', name: 'AI Tutor', icon: '🧑‍🏫' },
  { id: 'practice', name: 'Practice', icon: '✍️' },
  { id: 'test_papers', name: 'Test Papers', icon: '📜' },
  { id: 'results', name: 'My Results', icon: '📊' },
  { id: 'settings', name: 'Settings', icon: '⚙️' },
];

export const STUDENT_ATTEMPTS_KEY = 'eduquest_student_attempts_v1';

// Default chapters for students if the teacher's question bank is empty.
export const DEFAULT_CHAPTERS: Record<number, string[]> = {
  7: [
    'Nutrition in Plants and Animals',
    'Fibre and Fabric',
    'Weather, Climate, and Adaptation',
    'Respiration in Organisms',
    'Transportation in Living Beings',
    'Reproduction in Plants',
    'Forests: Our Lifeline'
  ],
  8: [
    'Crop Production and Management',
    'Microorganisms: Friend and Foe',
    'Conservation of Plants and Animals',
    'Cell: Structure and Functions',
    'Reproduction in Animals',
    'Reaching the Age of Adolescence'
  ],
  9: [
    'Life and its Diversity',
    'Levels of Organization of Life',
    'Physiological Processes of Life',
    'Biology and Human Welfare',
    'Environment and its Resources'
  ],
  10: [
    'Control and Coordination in living organisms',
    'Continuity of life',
    'Heredity and some common genetic diseases',
    'Evolution and adaptation',
    'Environment, its resources and their conservation'
  ],
  11: [
    'The Living World',
    'Biological Classification',
    'Plant Kingdom',
    'Animal Kingdom',
    'Structural Organisation in Animals and Plants',
    'Cell: The Unit of Life',
    'Biomolecules',
    'Cell Cycle and Cell Division',
    'Transport in Plants',
    'Mineral Nutrition',
    'Photosynthesis in Higher Plants',
    'Respiration in Plants',
    'Plant Growth and Development',
    'Digestion and Absorption',
    'Breathing and Exchange of Gases',
    'Body Fluids and Circulation',
    'Excretory Products and their Elimination',
    'Locomotion and Movement',
    'Neural Control and Coordination',
    'Chemical Coordination and Integration'
  ],
  12: [
    'Reproduction in Organisms',
    'Sexual Reproduction in Flowering Plants',
    'Human Reproduction',
    'Reproductive Health',
    'Principles of Inheritance and Variation',
    'Molecular Basis of Inheritance',
    'Evolution',
    'Human Health and Disease',
    'Strategies for Enhancement in Food Production',
    'Microbes in Human Welfare',
    'Biotechnology: Principles and Processes',
    'Biotechnology and its Applications',
    'Organisms and Populations',
    'Ecosystem',
    'Biodiversity and Conservation',
    'Environmental Issues'
  ]
};