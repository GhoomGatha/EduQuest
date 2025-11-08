import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
// FIX: Import ViewState from the shared types file.
import { Question, Difficulty, Language, Flashcard, QuestionSource, Semester, DiagramSuggestion, DiagramGrade, ViewState } from '../../types';
import { t } from '../../utils/localization';
import { generateFlashcardsAI, generateQuestionsAI, getChaptersAI, getSubjectsAI, extractQuestionsFromImageAI, suggestDiagramsAI, gradeDiagramAI, answerDoubtAI, generateStudyGuideAI, explainDiagramAI } from '../../services/geminiService';
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
    onSetViewState: (viewState: ViewState) => void;
    onSaveTutorResponse: (queryText: string, queryImageUrl: string | null, responseText: string, tutorClass: number) => void;
}

const CURRICULUM_PREFS_KEY = 'eduquest_student_curriculum_prefs';

const PracticeZone: React.FC<PracticeZoneProps> = ({ allQuestions, lang, onStartPractice, showToast, userApiKey, userOpenApiKey, onSetViewState, onSaveTutorResponse }) => {
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
    const [isExplainingDiagram, setIsExplainingDiagram] = useState(false);
    const [diagramExplanation, setDiagramExplanation] = useState('');

    useEffect(() => {
        try {
            const savedPrefsRaw = localStorage.getItem(CURRICULUM_PREFS_KEY);
            if (savedPrefsRaw) {
                const savedPrefs = JSON.parse(savedPrefsRaw);
                if (savedPrefs.board) setBoard(savedPrefs.board);
                if (savedPrefs.studentClass) setStudentClass(savedPrefs.studentClass);
                if (savedPrefs.selectedSubject) setSelectedSubject(savedPrefs.selectedSubject);
            }
        } catch (e) {
            console.warn("Could not load curriculum preferences from localStorage", e);
        }
    }, []);

    useEffect(() => {
        const prefs = { board, studentClass, selectedSubject };
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

    const stableShowToast = useCallback(showToast, []);

    useEffect(() => {
        setLoadingSubjects(true);
        getSubjectsAI(board, studentClass, lang, userApiKey, userOpenApiKey)
            .then(subjectList => {
                setSubjects(subjectList);
                if (!subjectList.includes(selectedSubject)) {
                    const preferredSubject = subjectList.find(s => s.toLowerCase().includes('biology') || s.toLowerCase().includes('life science'));
                    if (preferredSubject) {
                        setSelectedSubject(preferredSubject);
                    } else if (subjectList.length > 0) {
                        setSelectedSubject(subjectList[0]);
                    } else {
                        setSelectedSubject('');
                    }
                }
            })
            .catch(() => stableShowToast("Could not fetch subjects.", 'error'))
            .finally(() => setLoadingSubjects(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [board, studentClass, lang, userApiKey, userOpenApiKey, stableShowToast]);
    
    useEffect(() => {
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

            if (questionsToGenerate > 0 && selectedSubject) {
                const { generatedQuestions } = await generateQuestionsAI({
                    class: studentClass, subject: selectedSubject, chapter: customChapter, marks: 3, difficulty: customDifficulty || Difficulty.Moderate,
                    count: questionsToGenerate, generateAnswer: true, wbbseSyllabusOnly: true, lang: lang,
                }, practiceQuestions, userApiKey, userOpenApiKey);
                const newAiQuestions: Question[] = generatedQuestions.map((gq): Question => ({
                    id: `gen-${Date.now()}-${Math.random()}`, text: gq.text!, answer: gq.answer, marks: gq.marks || 3, difficulty: customDifficulty || Difficulty.Moderate,
                    class: studentClass, chapter: gq.chapter || customChapter || 'General', source: QuestionSource.Generated, year: new Date().getFullYear(),
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

    const handleExplainDiagram = async (diagram: DiagramSuggestion) => {
        setIsExplainingDiagram(true);
        setDiagramExplanation('');
        try {
            const explanation = await explainDiagramAI(diagram.image_prompt, lang, userApiKey, userOpenApiKey);
            setDiagramExplanation(explanation);
            onSaveTutorResponse(`Explain the diagram: ${diagram.name}`, null, explanation, studentClass);
        } catch(e) {
            showToast("Failed to get explanation.", 'error');
        } finally {
            setIsExplainingDiagram(false);
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
    const cardInputStyles = "w-full p-2.5 bg-white/20 border border-white/30 rounded-lg text-white placeholder-white/70 focus:ring-2 focus:ring-white/50 focus:border-white transition";
    const cardLabelStyles = "block text-sm font-semibold text-white/90 mb-1";
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
                <h2 className="text-xl font-bold font-serif-display text-slate-700">
                    <span className="inline-block mr-2 text-2xl">🎯</span>
                    {t('curriculumSelection', lang)}
                </h2>
                 <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-semibold text-slate-600 mb-1">{t('board', lang)}</label>
                        <select value={board} onChange={e => setBoard(e.target.value)} className="w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition">
                            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-slate-600 mb-1">{t('class', lang)}</label>
                        <select value={studentClass} onChange={e => setStudentClass(parseInt(e.target.value))} className="w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition">
                            {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="block text-sm font-semibold text-slate-600 mb-1">{t('subject', lang)}</label>
                        <select 
                            value={selectedSubject} 
                            onChange={e => setSelectedSubject(e.target.value)} 
                            className="w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition"
                            disabled={loadingSubjects || subjects.length === 0}
                        >
                            <option value="">{loadingSubjects ? 'Loading...' : 'Select Subject'}</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                
                {/* AI MCQ Challenge */}
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">🏆</span>{t('aiMcqChallenge', lang)}</h2>
                    <p className="text-sm text-indigo-100 mb-4 flex-grow">{t('aiMcqChallengeSubtitle', lang)}</p>
                    <div className="space-y-4">
                        <div>
                            <label className={cardLabelStyles}>{t('chapter', lang)}</label>
                            <input list="chapters-datalist" value={mcqChapter} onChange={e => setMcqChapter(e.target.value)} className={cardInputStyles}
                                placeholder={loadingChapters || !selectedSubject ? 'Select subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                        </div>
                        <div>
                            <label className={cardLabelStyles}>{t('numberOfQuestions', lang)}</label>
                            <input type="number" value={mcqNumQuestions} onChange={e => setMcqNumQuestions(Math.max(1, parseInt(e.target.value)))} min="1" max="50" className={cardInputStyles} />
                        </div>
                    </div>
                    <button onClick={handleStartMcqChallenge} className="mt-6 w-full py-3 bg-white/90 text-indigo-700 font-bold rounded-lg shadow-md hover:bg-white transition-all">
                        {t('startMcqChallenge', lang)}
                    </button>
                </div>

                {/* Custom Practice */}
                <div className="bg-gradient-to-br from-sky-500 to-cyan-400 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">✍️</span>{t('customPracticeSession', lang)}</h2>
                    <p className="text-sm text-sky-100 mb-4 flex-grow">{t('customPracticeSessionSubtitle', lang)}</p>
                    <div className="space-y-4">
                        <div>
                            <label className={cardLabelStyles}>{t('chapter', lang)}</label>
                            <input list="chapters-datalist" value={customChapter} onChange={e => setCustomChapter(e.target.value)} className={cardInputStyles}
                                placeholder={loadingChapters || !selectedSubject ? 'Select subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className={cardLabelStyles}>{t('selectDifficulty', lang)}</label>
                                <select value={customDifficulty} onChange={e => setCustomDifficulty(e.target.value as Difficulty | '')} className={cardInputStyles}>
                                    <option value="">{t('allDifficulties', lang)}</option>
                                    {Object.values(Difficulty).map(d => <option key={d} value={d} className="text-black">{t(d, lang)}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={cardLabelStyles}>{t('numberOfQuestions', lang)}</label>
                                <input type="number" value={customNumQuestions} onChange={e => setCustomNumQuestions(Math.max(1, parseInt(e.target.value)))} min="1" max="50" className={cardInputStyles} />
                            </div>
                        </div>
                    </div>
                    <button onClick={handleStartPractice} className="mt-6 w-full py-3 bg-white/90 text-sky-700 font-bold rounded-lg shadow-md hover:bg-white transition-all">
                        {t('startPractice', lang)}
                    </button>
                </div>

                {/* Study Tools */}
                <div className="bg-gradient-to-br from-emerald-500 to-green-600 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">💡</span>{t('studySmarter', lang)}</h2>
                    <p className="text-sm text-emerald-100 mb-4 flex-grow">Generate flashcards or a quick study guide for any topic.</p>
                    <div className="space-y-4">
                        <div>
                            <label className={cardLabelStyles}>{t('chapter', lang)}</label>
                             <input list="chapters-datalist" value={studyChapter} onChange={e => setStudyChapter(e.target.value)} className={cardInputStyles}
                                placeholder={loadingChapters || !selectedSubject ? 'Select subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                        </div>
                        <div>
                            <label className={cardLabelStyles}>{t('contentType', lang)}</label>
                            <select value={guideTopic} onChange={e => setGuideTopic(e.target.value)} className={cardInputStyles}>
                                <option value="Definitions" className="text-black">{t('definitions', lang)}</option>
                                <option value="Key Differences" className="text-black">{t('keyDifferences', lang)}</option>
                                <option value="Process Explanations" className="text-black">{t('processExplanations', lang)}</option>
                            </select>
                        </div>
                    </div>
                    <div className="mt-6 grid grid-cols-2 gap-3">
                         <button onClick={handleGenerateGuide} disabled={isGeneratingGuide || !studyChapter} className="w-full py-3 bg-white/90 text-emerald-700 font-bold rounded-lg shadow-md hover:bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                            {isGeneratingGuide ? '...' : t('generateGuide', lang)}
                        </button>
                        <button onClick={handleGenerateFlashcards} disabled={isGeneratingFlashcards || !studyChapter} className="w-full py-3 bg-white/90 text-emerald-700 font-bold rounded-lg shadow-md hover:bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                            {isGeneratingFlashcards ? '...' : t('generateFlashcards', lang)}
                        </button>
                    </div>
                </div>

                {/* Diagram Practice */}
                <div className="bg-gradient-to-br from-amber-500 to-orange-500 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">🎨</span>{t('diagramPractice', lang)}</h2>
                    <p className="text-sm text-amber-100 mb-4 flex-grow">{t('diagramPracticeSubtitle', lang)}</p>
                    <div className="space-y-4">
                        <div>
                            <label className={cardLabelStyles}>{t('chapter', lang)}</label>
                             <input list="chapters-datalist" value={diagramChapter} onChange={e => setDiagramChapter(e.target.value)} className={cardInputStyles}
                                placeholder={loadingChapters || !selectedSubject ? 'Select subject first' : t('selectOrTypeChapter', lang)} disabled={loadingChapters || !selectedSubject}/>
                        </div>
                    </div>
                     <button onClick={handleSuggestDiagrams} disabled={isSuggestingDiagrams || !diagramChapter} className="mt-6 w-full py-3 bg-white/90 text-amber-700 font-bold rounded-lg shadow-md hover:bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                        {isSuggestingDiagrams ? t('suggestingDiagrams', lang) : `💡 ${t('suggestDiagrams', lang)}`}
                    </button>
                </div>

                {/* Scan Your Paper */}
                <div className="bg-gradient-to-br from-slate-600 to-gray-800 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">📸</span>{t('scanYourPaper', lang)}</h2>
                    <p className="text-sm text-slate-200 mb-4 flex-grow">{t('scanYourPaperSubtitle', lang)}</p>
                     <button onClick={() => openCamera(handleScanCapture)} disabled={isProcessingScan} className="mt-6 w-full py-3 bg-white/90 text-slate-700 font-bold rounded-lg shadow-md hover:bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed">
                        {isProcessingScan ? t('analyzingPaper', lang) : `📷 ${t('scanWithCamera', lang)}`}
                    </button>
                </div>
                
                 {/* Quick Link to AI Tutor */}
                <div className="bg-gradient-to-br from-rose-500 to-pink-500 p-6 rounded-xl shadow-lg text-white flex flex-col transition-transform hover:-translate-y-1">
                    <h2 className="text-2xl font-bold font-serif-display flex items-center mb-2"><span className="text-3xl mr-3">🧑‍🏫</span>{t('ai_tutor', lang)}</h2>
                    <p className="text-sm text-rose-100 mb-4 flex-grow">{t('aiTutorSubtitle', lang)}</p>
                     <button onClick={() => onSetViewState({ view: 'ai_tutor' })} className="mt-6 w-full py-3 bg-white/90 text-rose-700 font-bold rounded-lg shadow-md hover:bg-white transition-all">
                        Ask a Question
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
                                <button onClick={() => { handleExplainDiagram(d); }}
                                    className="px-4 py-2 bg-green-100 text-green-800 font-semibold rounded-lg text-sm" disabled={isExplainingDiagram}>
                                        {isExplainingDiagram ? '...' : 'Explain'}
                                    </button>
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
            <Modal isOpen={!!diagramExplanation} onClose={() => setDiagramExplanation('')} title={`Explanation: ${selectedDiagram?.name}`}>
                 {isExplainingDiagram ? <LoadingSpinner message="Getting explanation..." /> : <MarkdownRenderer content={diagramExplanation} />}
            </Modal>
        </div>
    );
};

export default PracticeZone;
