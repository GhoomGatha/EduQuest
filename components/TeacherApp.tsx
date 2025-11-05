

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
import { Question, Paper, Tab, Language, Profile, QuestionSource, Difficulty, Semester, UploadProgress, TutorSession } from './types';
import { t } from './utils/localization';
import { TABS, LOCAL_STORAGE_KEY } from './constants';
import Modal from './components/Modal';
import QuestionForm from './components/QuestionForm';
import { useAuth } from './hooks/useAuth';
import { supabase } from './services/supabaseClient';
import LoadingSpinner from './components/LoadingSpinner';
import SecretMessageModal from './components/SecretMessageModal';
import { OPENAI_API_KEY_STORAGE_KEY } from './services/openaiService';
import LiveClock from './components/LiveClock';
import LanguageSelector from './components/LanguageSelector';
import { extractQuestionsFromImageAI, extractQuestionsFromPdfAI, extractQuestionsFromTextAI } from './services/geminiService';

const QuestionBank = lazy(() => import('./components/QuestionBank'));
const PaperGenerator = lazy(() => import('./components/PaperGenerator'));
const AITutor = lazy(() => import('./components/AITutor'));
const ExamArchive = lazy(() => import('./components/ExamArchive'));
const Settings = lazy(() => import('./components/Settings'));

const API_KEY_STORAGE_KEY = 'eduquest_user_api_key';
const LANGUAGE_STORAGE_KEY = 'eduquest_lang';

const tabIconAnimations: Record<Tab, string> = {
  bank: 'animate-glow',
  generator: 'animate-sway',
  ai_tutor: 'animate-glow',
  archive: 'animate-bobbing',
  settings: 'animate-slow-spin',
};

const dataURLtoBlob = (dataurl: string): Blob | null => {
    try {
        const arr = dataurl.split(',');
        if (arr.length < 2) return null;

        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) return null;
        
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (error) {
        console.error("Error converting data URL to blob:", error);
        return null;
    }
}

const readFileAsDataURL = (fileToRead: File, signal: AbortSignal): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const abortHandler = () => {
            reader.abort();
            reject(new DOMException('Aborted', 'AbortError'));
        };
        reader.onload = () => {
            signal.removeEventListener('abort', abortHandler);
            resolve(reader.result as string);
        };
        reader.onerror = (error) => {
            signal.removeEventListener('abort', abortHandler);
            reject(error);
        };

        if (signal.aborted) {
            return reject(new DOMException('Aborted', 'AbortError'));
        }
        signal.addEventListener('abort', abortHandler, { once: true });

        reader.readAsDataURL(fileToRead);
    });
};

interface TeacherAppProps {
    showToast: (message: string, type?: 'success' | 'error') => void;
}

const getFontClassForLang = (language: Language): string => {
    switch (language) {
        case 'bn': return 'font-noto-bengali';
        case 'hi': return 'font-noto-devanagari';
        case 'ka': return 'font-noto-kannada';
        default: return '';
    }
};

const TeacherApp: React.FC<TeacherAppProps> = ({ showToast }) => {
  const { session, profile, setProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('ai_tutor');
  const [lang, setLang] = useState<Language>('en');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [tutorSessions, setTutorSessions] = useState<TutorSession[]>([]);
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [userOpenApiKey, setUserOpenApiKey] = useState<string>('');
  const [isSecretMessageOpen, setSecretMessageOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({});
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ lastLogin: string; currentSessionStart: string }>({ lastLogin: 'N/A', currentSessionStart: '