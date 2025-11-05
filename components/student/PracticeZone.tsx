import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Question, Difficulty, Language, Flashcard, QuestionSource, Semester, DiagramSuggestion, DiagramGrade } from '../../types';
import { t } from '../../utils/localization';
import { generateFlashcardsAI, generateQuestionsAI, getChaptersAI, getSubjectsAI, extractQuestionsFromImageAI, suggestDiagramsAI, gradeDiagramAI, answerDoubtAI, generateStudyGuideAI } from '../../services/geminiService';
import Modal from '../Modal';
import LoadingSpinner from '../LoadingSpinner';
import CameraModal from '../CameraModal';
import { BOARDS, CLASSES } from '../../constants';
import DrawingModal from './DrawingModal';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

// --- Start of Embedded MarkdownRenderer Component ---
declare global {
    interface Window {
        marked: any;
    }
}
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (containerRef.current && window.marked) {
            containerRef.current.innerHTML = window.marked.parse(content || '');
        }
    }, [content]);
    return <div ref={containerRef} className="prose prose-sm max-w-none prose-slate"></div>;
};
// --- End of Embedded MarkdownRenderer Component ---

const FlashcardModalContent: React.FC<{
    flashcards: Flashcard[];
    chapter: string;
    lang: Language;
}> = ({ flashcards, chapter, lang }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    const currentCard = flashcards[currentIndex];

    const handleNext = () => {
        setIsFlipped(false);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % flashcards.length);
        }, 250);
    };

    const handlePrev = () => {
        setIsFlipped(false);
         setTimeout(() => {
            setCurrentIndex((prev) => (prev - 1 + flashcards.length) % flashcards.length);
        }, 250);
    };

    return (
        <div className="flex flex-col items-center">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
                {t('flashcardsFor', lang).replace('{chapter}', chapter)} ({currentIndex + 1}/{flashcards.length})
            </h3>
            <div className="w-full h-64 [perspective:1000px]">
                <div
                    className={`relative w-full h-full [transform-style:preserve-3d] transition-transform duration-500 cursor-pointer ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}
                    onClick={() => setIsFlipped(!isFlipped)}
                >
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-white border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg">
                        <p className="text-xl font-semibold text-slate-700">{currentCard.question}</p>
                    </div>
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-indigo-100 border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg [transform:rotateY(180deg)]">
                        <p className="text-lg text-indigo-800">{currentCard.answer}</p>
                    </div>
                </div>
            </div>
            <div className="flex justify-between w-full mt-6">
                <button onClick={handlePrev} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors">&larr; {t('previous', lang)}</button>
                <button onClick={() => setIsFlipped(!isFlipped)} className="px-8 py-2.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm hover:shadow-md transition-all">{t('flip', lang)}</button>
                <button onClick={handleNext} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors">{t('next', lang)} &rarr;</button>
            </div>
        </div>
    );
};


interface PracticeZoneProps {
    allQuestions: Question[];
    lang: Language;
    onStartPractice: (questions: Question[], title: string) => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
    userApiKey?: string;
    userOpenApiKey?: string;
}

const CURRICULUM_PREFS_KEY = 'eduquest_student_curriculum_prefs';

const AnimatedHeader = ({ emoji, animation, title }: { emoji: string; animation: string; title: string; }) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const [isIntersecting, setIntersecting] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                setIntersecting(entry.isIntersecting);
            },
            {
                rootMargin: '-50% 0px -50% 0px', // Trigger when the element is in the vertical center of the viewport
                threshold: 0
            }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => {
            if (ref.current) {
                observer.unobserve(ref.current);
            }
        };
    }, []);

    return (
        <h2 ref={ref} className="text-xl font-bold font-serif-display text-slate-700">
            <span className={`inline-block mr-2 text-2xl ${isIntersecting ? animation : ''}`}>{emoji}</span>
            {title}
        </h2>
    );
};

const PracticeZone: React.FC<PracticeZoneProps> = ({ allQuestions, lang, onStartPractice, showToast, userApiKey, userOpenApiKey }) => {
    const { session } = useAuth();
    // Common state
    const [board, setBoard] = useState<string>('WBBSE');
    const [studentClass, setStudentClass] = useState<number>(10);
    const [subjects, setSubjects] = useState<string[]>([]);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    const [selectedSubject, setSelectedSubject] = useState('');
    const [chapters, setChapters] = useState<string[]>([]);
    const [loadingChapters, setLoadingChapters] = useState(false);
    const [isCameraOpen, setCameraOpen] = useState(false);
    const [cameraCallback, setCameraCallback] = useState<(file: File) => void>(() => () => {});
    
    // Custom practice session
    const [customChapter, setCustomChapter] = useState('');
    const [customDifficulty, setCustomDifficulty] = useState<Difficulty | ''>('');
    const [customNumQuestions, setCustomNumQuestions] = useState(10);
    const [isGeneratingPractice, setIsGeneratingPractice] = useState(false);

    // AI MCQ Challenge
    const [mcqChapter, setMcqChapter] = useState('');
    const [mcqNumQuestions, setMcqNumQuestions] = useState(10);
    const [isGeneratingMcq, setIsGeneratingMcq] = useState(false);

    // Study Guides & Flashcards
    const [studyChapter, setStudyChapter] = useState('');
    const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);
    const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
    const [isFlashcardModalOpen, setIsFlashcardModalOpen] = useState(false);
    const [guideTopic, setGuideTopic] = useState('Definitions');
    const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
    const [guideContent, setGuideContent] = useState('');
    const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
    
    // Scan Paper
    const [isProcessingScan, setIsProcessingScan] = useState(false);
    const [extractedQuestions, setExtractedQuestions] = useState<Partial<Question>[]>([]);
    const [isReviewModalOpen, setReviewModalOpen] = useState(false);

    // Diagram Practice
    const [diagramChapter, setDiagramChapter] = useState('');
    const [isSuggestingDiagrams, setIsSuggestingDiagrams] = useState(false);
    const [suggestedDiagrams, setSuggestedDiagrams] = useState<DiagramSuggestion[]>([]);
    const [isSuggestionsModalOpen, setSuggestionsModalOpen] = useState(false);
    const [selectedDiagram, setSelectedDiagram] = useState<DiagramSuggestion | null>(null);
    const [isGrading, setIsGrading] = useState(false);
    const [diagramGrade, setDiagramGrade] = useState<DiagramGrade | null>(null);
    const [isGradeModalOpen, setGradeModalOpen] = useState(false);
    const [isDrawingModalOpen, setIsDrawingModalOpen] = useState(false);

    useEffect(() => {
        try {
            const savedPrefsRaw = localStorage.getItem(CURRICULUM_PREFS_KEY);
            if (savedPrefsRaw) {
                const savedPrefs = JSON.parse(savedPrefsRaw);
                if (savedPrefs.board) setBoard(savedPrefs.board);
                if (savedPrefs.studentClass) setStudentClass(savedPrefs.studentClass);
                // We don't set selectedSubject here as it depends on an async fetch
            }
        } catch (e) {
            console.warn("Could not load curriculum preferences from localStorage", e);
        }
    }, []);

    useEffect(() => {
        const prefs = { board, studentClass, selectedSubject };
        // Avoid saving an empty subject on initial load
        if (selectedSubject) {
            localStorage.setItem(CURRICULUM_PREFS_KEY, JSON.stringify(prefs));
        }
    }, [board, studentClass, selectedSubject]);
    
    const availableClasses = useMemo(() => {
        switch (board) {
            case 'WBBSE':
            case 'ICSE':
                return CLASSES.filter(c => c <= 10);
            case 'WBCHSE':
            case 'ISC':
                return CLASSES.filter(c => c > 10);
            case 'CBSE':
            default:
                return CLASSES;
        }
    }, [board]);
    
    useEffect(() => {
        if (!availableClasses.includes(studentClass)) {
            setStudentClass(availableClasses[0]);
        }
    }, [availableClasses, studentClass]);

    useEffect(() => {
        setLoadingSubjects(true);
        setSubjects([]);
        setSelectedSubject('');
        getSubjectsAI(board, studentClass, lang, userApiKey, userOpenApiKey)
            .then(subjectList => {
                setSubjects(subjectList);
                const savedPrefsRaw = localStorage.getItem(CURRICULUM_PREFS_KEY);
                let savedSubject = '';
                if (savedPrefsRaw) {
                    const savedPrefs = JSON.parse(savedPrefsRaw);
                    if (savedPrefs.board === board && savedPrefs.studentClass === studentClass) {
                        savedSubject = savedPrefs.selectedSubject;
                    }
                }

                if (savedSubject && subjectList.includes(savedSubject)) {
                    setSelectedSubject(savedSubject);
                } else {
                    const preferredSubject = subjectList.find(s => s.toLowerCase().includes('biology') || s.toLowerCase().includes('life science'));
                    if (preferredSubject) {
                        setSelectedSubject(preferredSubject);
                    } else if (subjectList.length > 0) {
                        setSelectedSubject(subjectList[0]);
                    }
                }
            })
            .catch(() => showToast("Could not fetch subjects.", 'error'))
            .finally(() => setLoadingSubjects(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [board, studentClass, lang, userApiKey, userOpenApiKey, showToast]);
    
    useEffect(() => {
        // Clear all chapter-dependent inputs when subject changes
        setChapters([]);
        setCustomChapter('');
        setMcqChapter('');
        setStudyChapter('');
        setDiagramChapter('');
    
        if (!selectedSubject) {
            return;
        }
        
        setLoadingChapters(true);
        getChaptersAI(board, studentClass, selectedSubject, lang, undefined, userApiKey, userOpenApiKey)
            .then(chapterList => {
                setChapters(chapterList);
            })
            .catch(() => showToast("Could not fetch chapters.", 'error'))
            .finally(() => setLoadingChapters(false));
    }, [board, studentClass, selectedSubject, lang, userApiKey, userOpenApiKey, showToast]);

    const openCamera = (onCapture: (file: File) => void) => {
        setCameraCallback(() => onCapture);
        setCameraOpen(true);
    };

    // --- Feature Handlers ---

    const handleStartPractice = async () => {
        setIsGeneratingPractice(true);
        try {
            let filtered = allQuestions.filter(q => q.class === studentClass);
            if (customChapter) filtered = filtered.filter(q => q.chapter === customChapter);
            if (customDifficulty) filtered = filtered.filter(q => q.difficulty === customDifficulty);

            let practiceQuestions = filtered.sort(() => 0.5 - Math.random()).slice(0, customNumQuestions);
            const questionsToGenerate = customNumQuestions - practiceQuestions.length;

            if (questionsToGenerate > 0 && customChapter) {
                const { generatedQuestions } = await generateQuestionsAI({
                    class: studentClass, subject: selectedSubject, chapter: customChapter, marks: 3, difficulty: customDifficulty || Difficulty.Moderate,
                    count: questionsToGenerate, generateAnswer: true, wbbseSyllabusOnly: true, lang: lang,
                }, practiceQuestions, userApiKey, userOpenApiKey);
                const newAiQuestions: Question[] = generatedQuestions.map((gq): Question => ({
                    id: `gen-${Date.now()}-${Math.random()}`, text: gq.text!, answer: gq.answer, marks: 3, difficulty: customDifficulty || Difficulty.Moderate,
                    class: studentClass, chapter: customChapter, source: QuestionSource.Generated, year: new Date().getFullYear(),
                    semester: Semester.First, tags: [], used_in: [],
                }));
                practiceQuestions = [...practiceQuestions, ...newAiQuestions];
            }
            if (practiceQuestions.length < 1) {
                showToast(t('notEnoughQuestions', lang), 'error');
                return;
            }
            onStartPractice(practiceQuestions.sort(() => 0.5 - Math.random()), `Practice: ${customChapter || t('allChapters', lang)}`);
        } catch (error) {
             showToast(t('apiError', lang), 'error');
        } finally {
            setIsGeneratingPractice(false);
        }
    };
    
    const handleStartMcqChallenge = async () => {
        if (!mcqChapter || !selectedSubject) {
            showToast(t('selectChapterForMcq', lang), 'error');
            return;
        }
        setIsGeneratingMcq(true);
        try {
            const { generatedQuestions } = await generateQuestionsAI({
                class: studentClass,
                subject: selectedSubject,
                chapter: mcqChapter,
                marks: 1, // MCQs are typically 1 mark
                difficulty: Difficulty.Moderate,
                count: mcqNumQuestions,
                questionType: 'Multiple Choice',
                generateAnswer: true,
                wbbseSyllabusOnly: true,
                lang: lang,
            }, [], userApiKey, userOpenApiKey);

            if (generatedQuestions.length < 1) {
                showToast(t('notEnoughQuestions', lang), 'error');
                return;
            }

            const mcqPracticeQuestions: Question[] = generatedQuestions.map((gq): Question => ({
                id: `mcq-${Date.now()}-${Math.random()}`,
                text: gq.text!,
                answer: gq.answer,
                marks: 1,
                difficulty: Difficulty.Moderate,
                class: studentClass,
                chapter: mcqChapter,
                source: QuestionSource.Generated,
                year: new Date().getFullYear(),
                semester: Semester.First,
                tags: ['MCQ Challenge'],
                used_in: [],
            }));

            onStartPractice(mcqPracticeQuestions, `MCQ Challenge: ${mcqChapter}`);
        } catch (error) {
            showToast(t('apiError', lang), 'error');
        } finally {
            setIsGeneratingMcq(false);
        }
    };

    const handleScanCapture = (file: File) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const dataUrl = reader.result as string;
            setCameraOpen(false);
            setIsProcessingScan(true);
            try {
                const questions = await extractQuestionsFromImageAI(dataUrl, studentClass, lang, userApiKey, userOpenApiKey);
                setExtractedQuestions(questions);
                setReviewModalOpen(true);
            } catch(e) {
                showToast("Failed to extract questions from image.", "error");
            } finally {
                setIsProcessingScan(false);
            }
        };
        reader.readAsDataURL(file);
    };
    
    const startPracticeFromScan = () => {
        const questions: Question[] = extractedQuestions.map((q, i) => ({
            ...q,
            id: `scan-${Date.now()}-${i}`,
            class: studentClass,
            chapter: 'Scanned Paper',
            marks: q.marks || 1,
            difficulty: Difficulty.Moderate,
            source: QuestionSource.Scan,
            year: new Date().getFullYear(),
            semester: Semester.First,
            tags: [], used_in: [],
        } as Question));
        onStartPractice(questions, "Scanned Paper Practice");
        setReviewModalOpen(false);
    };

    const handleSuggestDiagrams = async () => {
        if (!diagramChapter || !selectedSubject) return;
        setIsSuggestingDiagrams(true);
        try {
            const suggestions = await suggestDiagramsAI(selectedSubject, diagramChapter, studentClass, lang, userApiKey, userOpenApiKey);
            setSuggestedDiagrams(suggestions);
            setSuggestionsModalOpen(true);
        } catch (e) {
            showToast("Failed to suggest diagrams.", 'error');
        } finally {
            setIsSuggestingDiagrams(false);
        }
    };
    
    const handleDrawingSubmit = async (dataUrl: string) => {
        setIsDrawingModalOpen(false);
        setIsGrading(true);
        try {
            if (selectedDiagram && selectedSubject) {
                const grade = await gradeDiagramAI(selectedSubject, selectedDiagram.image_prompt, dataUrl, lang, userApiKey, userOpenApiKey);
                setDiagramGrade(grade);
                setGradeModalOpen(true);
            }
        } catch (e) {
            showToast("Failed to grade diagram.", 'error');
        } finally {
            setIsGrading(false);
        }
    };

    const handleDiagramCapture = (file: File) => {
        const reader = new FileReader();
        reader.onloadend = async () => {
            const dataUrl = reader.result as string;
            setCameraOpen(false);
            await handleDrawingSubmit(dataUrl); // Reuse the same grading logic
        };
        reader.readAsDataURL(file);
    };
    
    const handleGenerateGuide = async () => {
        if(!studyChapter || !session?.user || !selectedSubject) return;
        setIsGeneratingGuide(true);
        try {
            const content = await generateStudyGuideAI(selectedSubject, studyChapter, studentClass, guideTopic, lang, userApiKey, userOpenApiKey);
            setGuideContent(content);
            const { error } = await supabase.from('student_generated_content').insert({
                user_id: session.user.id,
                type: 'study_guide',
                title: `${guideTopic} for ${studyChapter}`,
                content: { markdown: content },
            });
            if (error) throw error;
            showToast("Study guide saved to your dashboard!", "success");
            setIsGuideModalOpen(true);
        } catch(e) {
            console.error("Error generating or saving guide:", e);
            showToast("Failed to generate or save guide.", "error");
        } finally {
            setIsGeneratingGuide(false);
        }
    };

    const handleGenerateFlashcards = async () => {
        if (!studyChapter || !session?.user || !selectedSubject) return;
        setIsGeneratingFlashcards(true);
        try {
            const generated = await generateFlashcardsAI(selectedSubject, studyChapter, studentClass, 10, lang, userApiKey, userOpenApiKey);
            setFlashcards(generated);
            const { error } = await supabase.from('student_generated_content').insert({
                user_id: session.user.id,
                type: 'flashcards',
                title: `Flashcards for ${studyChapter}`,
                content: generated,
            });
            if (error) throw error;
            showToast("Flashcards saved to your dashboard!", "success");
            setIsFlashcardModalOpen(true);
        } catch (error) {
            showToast(t('apiError', lang), 'error');
        } finally {
            setIsGeneratingFlashcards(false);
        }
    };

    // --- Render Logic ---
    const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
    const labelStyles = "block text-sm font-semibold text-slate-600 mb-1";
    const mainLoadingMessage = isGeneratingPractice ? t('generatingPracticeTest', lang) : isGeneratingMcq ? t('generatingMcqChallenge', lang) : null;
    if (mainLoadingMessage) return <LoadingSpinner message={mainLoadingMessage} />;

    return (
        <div className="p-4 sm:p-6 space-y-8">
            <header className="space-y-1">
                <h1 className="text-3xl font-bold font-serif-display text-slate-800">{t('practiceZoneTitle', lang)}</h1>
                <p className="text-slate-500">{t('practiceZoneSubtitle', lang)}</p>
            </header>

            {/* Curriculum Selection */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <AnimatedHeader emoji="🎯" animation="animate-pulse" title={t('curriculumSelection', lang)} />
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className={labelStyles}>{t('board', lang)}</label>
                        <select value={board} onChange={e => setBoard(e.target.value)} className={inputStyles}>
                            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelStyles}>{t('class', lang)}</label>
                        <select value={studentClass} onChange={e => setStudentClass(parseInt(e.target.value))} className={inputStyles}>
                            {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className={labelStyles}>{t('subject', lang)}</label>
                        <select 
                            value={selectedSubject} 
                            onChange={e => setSelectedSubject(e.target.value)} 
                            className={inputStyles}
                            disabled={loadingSubjects || subjects.length === 0}
                        >
                            <option value="">{loadingSubjects ? 'Loading...' : 'Select Subject'}</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
            </div>
            
            {/* AI MCQ Challenge */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <AnimatedHeader emoji="🏆" animation="animate-bobbing" title={t('aiMcqChallenge', lang)} />
                <p className="text-sm text-slate-500">{t('aiMcqChallengeSubtitle', lang)}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className={labelStyles}>{t('chapter', lang)}</label>
                        <input list="chapters-datalist" value={mcqChapter} onChange={e => setMcqChapter(e.target.value)} className={inputStyles}
                            placeholder={loadingChapters || !selectedSubject ? 'Select a subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                    </div>
                    <div>
                        <label className={labelStyles}>{t('numberOfQuestions', lang)}</label>
                        <input type="number" value={mcqNumQuestions} onChange={e => setMcqNumQuestions(Math.max(1, parseInt(e.target.value)))} min="1" max="50" className={inputStyles} />
                    </div>
                </div>
                <div className="flex justify-end">
                    <button onClick={handleStartMcqChallenge} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm transition-all">
                        {t('startMcqChallenge', lang)}
                    </button>
                </div>
            </div>

            {/* Study Smarter section with new Quick Study Guide */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-6">
                <AnimatedHeader emoji="💡" animation="animate-beat" title={t('studySmarter', lang)} />
                <div>
                    <label className={labelStyles}>{t('quickStudyGuide', lang)}</label>
                     <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input list="chapters-datalist" value={studyChapter} onChange={e => setStudyChapter(e.target.value)} className={`${inputStyles}`}
                            placeholder={loadingChapters || !selectedSubject ? 'Select a subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                        <select value={guideTopic} onChange={e => setGuideTopic(e.target.value)} className={inputStyles}>
                            <option value="Definitions">{t('definitions', lang)}</option>
                            <option value="Key Differences">{t('keyDifferences', lang)}</option>
                            <option value="Process Explanations">{t('processExplanations', lang)}</option>
                        </select>
                        <button onClick={handleGenerateGuide} disabled={isGeneratingGuide || !studyChapter} className="px-5 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-lg shadow-sm disabled:opacity-50">
                            {isGeneratingGuide ? t('generatingGuide', lang) : `📝 ${t('generateGuide', lang)}`}
                        </button>
                    </div>
                </div>
                <div>
                    <label className={labelStyles}>{t('flashcardGenerator', lang)}</label>
                     <div className="flex justify-end">
                         <button onClick={handleGenerateFlashcards} disabled={isGeneratingFlashcards || !studyChapter} className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-lg shadow-sm disabled:opacity-50">
                            {isGeneratingFlashcards ? t('generating', lang) : `🧠 ${t('generateFlashcards', lang)}`}
                        </button>
                    </div>
                </div>
            </div>

            {/* Custom Practice Session */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <AnimatedHeader emoji="✍️" animation="animate-sway" title={t('customPracticeSession', lang)} />
                <p className="text-sm text-slate-500">{t('customPracticeSessionSubtitle', lang)}</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-3">
                        <label className={labelStyles}>{t('chapter', lang)}</label>
                        <input list="chapters-datalist" value={customChapter} onChange={e => setCustomChapter(e.target.value)} className={inputStyles}
                            placeholder={loadingChapters || !selectedSubject ? 'Select a subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                    </div>
                    <div>
                        <label className={labelStyles}>{t('selectDifficulty', lang)}</label>
                        <select value={customDifficulty} onChange={e => setCustomDifficulty(e.target.value as Difficulty | '')} className={inputStyles}>
                            <option value="">{t('allDifficulties', lang)}</option>
                            {Object.values(Difficulty).map(d => <option key={d} value={d}>{t(d, lang)}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelStyles}>{t('numberOfQuestions', lang)}</label>
                        <input type="number" value={customNumQuestions} onChange={e => setCustomNumQuestions(Math.max(1, parseInt(e.target.value)))} min="1" max="50" className={inputStyles} />
                    </div>
                </div>
                <div className="flex justify-end">
                    <button onClick={handleStartPractice} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm transition-all">
                        {t('startPractice', lang)}
                    </button>
                </div>
            </div>

            {/* New Feature: Diagram Practice */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <AnimatedHeader emoji="🎨" animation="animate-tilt" title={t('diagramPractice', lang)} />
                <p className="text-sm text-slate-500">{t('diagramPracticeSubtitle', lang)}</p>
                <div className="flex flex-col sm:flex-row gap-2">
                     <input list="chapters-datalist" value={diagramChapter} onChange={e => setDiagramChapter(e.target.value)} className={`${inputStyles} flex-grow`}
                        placeholder={loadingChapters || !selectedSubject ? 'Select a subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                    <button onClick={handleSuggestDiagrams} disabled={isSuggestingDiagrams || !diagramChapter} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm transition-all disabled:bg-indigo-300">
                        {isSuggestingDiagrams ? t('suggestingDiagrams', lang) : `💡 ${t('suggestDiagrams', lang)}`}
                    </button>
                </div>
            </div>

            {/* New Feature: Scan Paper */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <AnimatedHeader emoji="📸" animation="animate-flash" title={t('scanYourPaper', lang)} />
                <p className="text-sm text-slate-500">{t('scanYourPaperSubtitle', lang)}</p>
                <div className="flex justify-end">
                    <button onClick={() => openCamera(handleScanCapture)} disabled={isProcessingScan} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm transition-all disabled:bg-indigo-300">
                        {isProcessingScan ? t('analyzingPaper', lang) : `📷 ${t('scanWithCamera', lang)}`}
                    </button>
                </div>
            </div>

            <datalist id="chapters-datalist">
                {chapters.map(c => <option key={c} value={c} />)}
            </datalist>

            {/* --- Modals --- */}
            <CameraModal isOpen={isCameraOpen} onClose={() => setCameraOpen(false)} onCapture={cameraCallback} />
            <DrawingModal 
                isOpen={isDrawingModalOpen}
                onClose={() => setIsDrawingModalOpen(false)}
                onSubmit={handleDrawingSubmit}
                diagramName={selectedDiagram?.name || ''}
            />
            <Modal isOpen={isReviewModalOpen} onClose={() => setReviewModalOpen(false)} title={t('reviewExtractedQuestions', lang)}>
                <div className="space-y-3">
                    <p className="text-sm text-slate-600">AI has extracted {extractedQuestions.length} questions. Review them and start your practice session.</p>
                    <div className="max-h-60 overflow-y-auto bg-slate-50 p-3 rounded-lg border space-y-2">
                        {extractedQuestions.map((q, i) => <p key={i} className="text-sm"><b>{i+1}.</b> {q.text} ({q.marks || 'N/A'} marks)</p>)}
                    </div>
                    <div className="flex justify-end">
                        <button onClick={startPracticeFromScan} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg">{t('startPractice', lang)}</button>
                    </div>
                </div>
            </Modal>
            <Modal isOpen={isSuggestionsModalOpen} onClose={() => setSuggestionsModalOpen(false)} title={t('importantDiagramsFor', lang).replace('{chapter}', diagramChapter)}>
                <div className="space-y-4">
                    {suggestedDiagrams.map((d, i) => (
                        <div key={i} className="p-4 bg-slate-50 rounded-lg border">
                            <h3 className="font-bold">{d.name}</h3>
                            <p className="text-sm text-slate-600 mt-1">{d.description}</p>
                            <div className="flex justify-end mt-3 gap-3">
                                <button onClick={() => { setSelectedDiagram(d); setSuggestionsModalOpen(false); setIsDrawingModalOpen(true); }}
                                    className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-lg text-sm">✏️ Draw in App</button>
                                <button onClick={() => { setSelectedDiagram(d); setSuggestionsModalOpen(false); openCamera(handleDiagramCapture); }}
                                    className="px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg text-sm">📷 Upload Photo</button>
                            </div>
                        </div>
                    ))}
                </div>
            </Modal>
             <Modal isOpen={isGradeModalOpen} onClose={() => setGradeModalOpen(false)} title={t('diagramGrade', lang)}>
                {isGrading ? <LoadingSpinner message={t('gradingDiagram', lang)} /> : diagramGrade ? (
                    <div className="space-y-4">
                        <div className="text-center">
                            <p className="text-sm text-slate-500 uppercase font-semibold">Score</p>
                            <p className="text-6xl font-bold text-indigo-600">{diagramGrade.score}<span className="text-4xl text-slate-400">/10</span></p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-green-700">Strengths</h3>
                            <ul className="list-disc list-inside text-slate-600">
                                {diagramGrade.strengths.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-semibold text-yellow-700">Areas for Improvement</h3>
                            <ul className="list-disc list-inside text-slate-600">
                                {diagramGrade.areasForImprovement.map((a, i) => <li key={i}>{a}</li>)}
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-semibold text-indigo-700">Feedback</h3>
                            <p className="text-slate-600">{diagramGrade.feedback}</p>
                        </div>
                    </div>
                ) : null}
            </Modal>
            <Modal isOpen={isFlashcardModalOpen} onClose={() => setIsFlashcardModalOpen(false)} title={t('flashcardGenerator', lang)}>
                {flashcards.length > 0 && <FlashcardModalContent flashcards={flashcards} chapter={studyChapter} lang={lang} />}
            </Modal>
            <Modal isOpen={isGuideModalOpen} onClose={() => setIsGuideModalOpen(false)} title={t('yourStudyGuide', lang)}>
                <MarkdownRenderer content={guideContent} />
            </Modal>
        </div>
    );
};

export default PracticeZone;