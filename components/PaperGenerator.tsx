
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Paper, Question, QuestionSource, Difficulty, Semester, GroundingSource, Language } from '../types';
import { t } from '../utils/localization';
import { generateQuestionsAI, getChaptersAI, getSubjectsAI } from '../services/geminiService';
import { CLASSES, YEARS, SEMESTERS, BOARDS, MARKS, TEACHER_CURRICULUM_PREFS_KEY } from '../constants';
import { useHistory } from '../hooks/useHistory';
import Modal from './Modal';
import { getBengaliFontBase64, getDevanagariFontBase64, getKannadaFontBase64 } from '../utils/fontData';
import { loadScript } from '../utils/scriptLoader';

const WBBSE_SYLLABUS_KEY = 'eduquest_wbbse_syllabus_only_v1';
const PAPER_GENERATOR_DRAFT_KEY = 'eduquest_paper_generator_draft_v1';

const questionTypes = ['Short Answer', 'Multiple Choice', 'Fill in the Blanks', 'True/False', 'Image-based', 'Odd Man Out', 'Matching'];

interface MarkDistributionRow {
    count: number;
    marks: number;
}

interface GeneratorSettings {
    distribution: MarkDistributionRow[];
    aiChapters: string[];
    aiDifficulty: Difficulty;
    aiKeywords: string;
    aiQuestionType: string[];
    aiGenerateAnswers: boolean;
    wbbseSyllabusOnly: boolean;
    useSearchGrounding: boolean;
}

interface PaperGeneratorDraft {
    title: string;
    year: number;
    board: string;
    selectedClass: number;
    selectedSubject: string;
    semester: Semester;
    avoidPrevious: boolean;
    distribution: MarkDistributionRow[];
    aiChapters: string[];
    aiDifficulty: Difficulty;
    aiKeywords: string;
    aiQuestionType: string[];
    aiGenerateAnswers: boolean;
    wbbseSyllabusOnly: boolean;
    useSearchGrounding: boolean;
}

interface PaperGeneratorProps {
    questions: Question[];
    onSavePaper: (paper: Paper) => Promise<Paper | void>;
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    userApiKey?: string;
    userOpenApiKey?: string;
}

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
        <h3 ref={ref} className="text-lg font-bold text-slate-700">
            <span className={`inline-block mr-2 text-2xl ${isIntersecting ? animation : ''}`}>{emoji}</span>
            {title}
        </h3>
    );
};

const PaperGenerator: React.FC<PaperGeneratorProps> = ({ questions, onSavePaper, lang, showToast, userApiKey, userOpenApiKey }) => {
    const [title, setTitle] = useState('');
    const [year, setYear] = useState(new Date().getFullYear());
    const [board, setBoard] = useState(() => {
        try {
            const saved = localStorage.getItem(TEACHER_CURRICULUM_PREFS_KEY);
            return saved ? JSON.parse(saved).board || 'WBBSE' : 'WBBSE';
        } catch { return 'WBBSE'; }
    });
    const [selectedClass, setClass] = useState(() => {
        try {
            const saved = localStorage.getItem(TEACHER_CURRICULUM_PREFS_KEY);
            return saved ? JSON.parse(saved).class || 10 : 10;
        } catch { return 10; }
    });
    const [selectedSubject, setSelectedSubject] = useState(() => {
        try {
            const saved = localStorage.getItem(TEACHER_CURRICULUM_PREFS_KEY);
            return saved ? JSON.parse(saved).subject || '' : '';
        } catch { return ''; }
    });
    const [semester, setSemester] = useState<Semester>(Semester.First);
    const [avoidPrevious, setAvoidPrevious] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedPaper, setGeneratedPaper] = useState<Paper | null>(null);
    const [isDraftLoaded, setIsDraftLoaded] = useState(false);
    const [isImageViewerOpen, setImageViewerOpen] = useState(false);
    const [viewingImage, setViewingImage] = useState<string | null>(null);
    
    const [subjectsList, setSubjectsList] = useState<string[]>([]);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    
    const [chaptersList, setChaptersList] = useState<string[]>([]);
    const [loadingChapters, setLoadingChapters] = useState(false);
    const [chapterInput, setChapterInput] = useState('');
    const [isChapterDropdownOpen, setIsChapterDropdownOpen] = useState(false);
    
    const draftStateRef = useRef<PaperGeneratorDraft>();
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        // Cleanup function to abort any ongoing AI requests when the component unmounts.
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort('Component unmounted');
                console.log("Paper generator request aborted due to component unmount.");
            }
        };
    }, []);

    const getInitialWbbseState = () => {
        const saved = localStorage.getItem(WBBSE_SYLLABUS_KEY);
        return saved !== null ? JSON.parse(saved) : true;
    };

    const {
        state: settings,
        set: setSettings,
        undo,
        redo,
        canUndo,
        canRedo,
        reset: resetSettings
    } = useHistory<GeneratorSettings>({
        distribution: [{ count: 5, marks: 1 }, { count: 5, marks: 2 }, { count: 2, marks: 5 }],
        aiChapters: [],
        aiDifficulty: Difficulty.Moderate,
        aiKeywords: '',
        aiQuestionType: [],
        aiGenerateAnswers: false,
        wbbseSyllabusOnly: getInitialWbbseState(),
        useSearchGrounding: false,
    });
        
    const handleSettingsChange = useCallback((field: keyof GeneratorSettings, value: any) => {
        setSettings({ ...settings, [field]: value });
    }, [settings, setSettings]);

    useEffect(() => {
        localStorage.setItem(WBBSE_SYLLABUS_KEY, JSON.stringify(settings.wbbseSyllabusOnly));
    }, [settings.wbbseSyllabusOnly]);

    // Persist curriculum changes to local storage to be shared across components.
    useEffect(() => {
        try {
            const currentPrefs = JSON.parse(localStorage.getItem(TEACHER_CURRICULUM_PREFS_KEY) || '{}');
            const newPrefs = {
                ...currentPrefs,
                board,
                class: selectedClass,
                subject: selectedSubject,
            };
            localStorage.setItem(TEACHER_CURRICULUM_PREFS_KEY, JSON.stringify(newPrefs));
        } catch (e) {
            console.warn("Could not save curriculum preferences in PaperGenerator", e);
        }
    }, [board, selectedClass, selectedSubject]);

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
        if (!availableClasses.includes(selectedClass)) {
            setClass(availableClasses[0]);
        }
    }, [availableClasses, selectedClass]);

    const stableShowToast = useCallback(showToast, []);

    useEffect(() => {
        setLoadingSubjects(true);
        setSubjectsList([]);
        
        getSubjectsAI(board, selectedClass, lang, userApiKey, userOpenApiKey)
            .then(subjects => {
                setSubjectsList(subjects);
                
                // If the currently selected subject is no longer in the list (e.g., after changing class),
                // update it to the first available subject to avoid an invalid state.
                if (!subjects.includes(selectedSubject)) {
                    if (subjects.length > 0) {
                        setSelectedSubject(subjects[0]);
                    } else {
                        setSelectedSubject('');
                    }
                }
            })
            .catch(err => {
                console.error("Failed to fetch subjects", err);
                stableShowToast(err.message || "Could not fetch subjects.", 'error');
            })
            .finally(() => {
                setLoadingSubjects(false);
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [board, selectedClass, lang, stableShowToast, userApiKey, userOpenApiKey]);

    useEffect(() => {
        if (!selectedSubject) {
            setChaptersList([]);
            handleSettingsChange('aiChapters', []);
            return;
        }
        setLoadingChapters(true);
        getChaptersAI(board, selectedClass, selectedSubject, lang, semester, userApiKey, userOpenApiKey)
            .then(chapters => {
                setChaptersList(chapters);
            })
            .catch(err => {
                console.error("Failed to fetch chapters", err);
                stableShowToast(err.message || "Could not fetch chapters.", 'error');
            })
            .finally(() => {
                setLoadingChapters(false);
            });
    }, [board, selectedClass, selectedSubject, semester, lang, stableShowToast, userApiKey, userOpenApiKey, handleSettingsChange]);


    useEffect(() => {
        const savedDraft = localStorage.getItem(PAPER_GENERATOR_DRAFT_KEY);
        if (savedDraft) {
            const draftData = JSON.parse(savedDraft);
            setTitle(draftData.title || '');
            setYear(draftData.year || new Date().getFullYear());
            // Board, class, and subject are handled by persistent curriculum state, not the draft.
            setSemester(draftData.semester || Semester.First);
            setAvoidPrevious(draftData.avoidPrevious !== undefined ? draftData.avoidPrevious : true);
            
            const loadedAiQuestionType = draftData.aiQuestionType;
            let aiQuestionTypeArray: string[] = [];
            if (Array.isArray(loadedAiQuestionType)) {
                aiQuestionTypeArray = loadedAiQuestionType;
            } else if (typeof loadedAiQuestionType === 'string' && loadedAiQuestionType) {
                aiQuestionTypeArray = [loadedAiQuestionType];
            }

            let chaptersArray: string[] = [];
            if (draftData.aiChapters && Array.isArray(draftData.aiChapters)) {
                chaptersArray = draftData.aiChapters;
            } else if (draftData.aiChapter && typeof draftData.aiChapter === 'string') {
                chaptersArray = draftData.aiChapter.split(',').map((c: string) => c.trim()).filter(Boolean);
            }

            resetSettings({
                distribution: draftData.distribution || [{ count: 5, marks: 1 }, { count: 5, marks: 2 }, { count: 2, marks: 5 }],
                aiChapters: chaptersArray,
                aiDifficulty: draftData.aiDifficulty || Difficulty.Moderate,
                aiKeywords: draftData.aiKeywords || '',
                aiQuestionType: aiQuestionTypeArray,
                aiGenerateAnswers: draftData.aiGenerateAnswers !== undefined ? draftData.aiGenerateAnswers : false,
                wbbseSyllabusOnly: draftData.wbbseSyllabusOnly !== undefined ? draftData.wbbseSyllabusOnly : true,
                useSearchGrounding: draftData.useSearchGrounding || false,
            });

            setIsDraftLoaded(true);
            stableShowToast(t('draftLoaded', lang));
        }
    // The dependency array is correct; we don't want to re-load the draft when curriculum state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang, stableShowToast, resetSettings]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            if (draftStateRef.current) {
                // The draft no longer saves board, class, or subject.
                const { board, selectedClass, selectedSubject, ...draftToSave } = draftStateRef.current;
                localStorage.setItem(PAPER_GENERATOR_DRAFT_KEY, JSON.stringify(draftToSave));
            }
        }, 30000); // Auto-save every 30 seconds

        return () => clearInterval(intervalId); // Cleanup on unmount
    }, []);

    const draftData: PaperGeneratorDraft = {
        title,
        year,
        board,
        selectedClass,
        selectedSubject,
        semester,
        avoidPrevious,
        ...settings,
    };
    draftStateRef.current = draftData;
    
    const handleQuestionTypeChange = (type: string) => {
        const isAdding = !settings.aiQuestionType.includes(type);
        const newTypes = isAdding
            ? [...settings.aiQuestionType, type]
            : settings.aiQuestionType.filter(t => t !== type);
    
        const requiresAnswer = ['Multiple Choice', 'Fill in the Blanks', 'True/False', 'Odd Man Out', 'Matching'].includes(type);
    
        let newGenerateAnswers = settings.aiGenerateAnswers;
        if (isAdding && requiresAnswer) {
            // If a type that requires an answer is added, automatically enable answer generation.
            // We avoid automatically disabling it to respect a user's manual choice for other types like Short Answer.
            newGenerateAnswers = true;
        }
    
        setSettings({ ...settings, aiQuestionType: newTypes, aiGenerateAnswers: newGenerateAnswers });
    };

    const handleDistributionChange = (index: number, field: 'count' | 'marks', value: number) => {
        const newDistribution = [...settings.distribution];
        if (value >= 0) { // Ensure non-negative numbers
            newDistribution[index] = { ...newDistribution[index], [field]: value };
            setSettings({ ...settings, distribution: newDistribution });
        }
    };

    const addDistributionRow = () => {
        const newDistribution = [...settings.distribution, { count: 1, marks: 1 }];
        setSettings({ ...settings, distribution: newDistribution });
    };

    const removeDistributionRow = (index: number) => {
        const newDistribution = settings.distribution.filter((_, i) => i !== index);
        setSettings({ ...settings, distribution: newDistribution });
    };

    const generateFromBank = useCallback((distribution: MarkDistributionRow[]): { questions: Question[] } | { error: string } => {
        let sourcePool = questions.filter(q => q.class === selectedClass);
        if (avoidPrevious) {
            sourcePool = sourcePool.filter(q => q.used_in.length === 0);
        }

        const requiredCounts = new Map<number, number>();
        for (const { count, marks } of distribution) {
            requiredCounts.set(marks, (requiredCounts.get(marks) || 0) + count);
        }

        const missingMessages: string[] = [];
        for (const [marks, requiredCount] of requiredCounts.entries()) {
            const availableCount = sourcePool.filter(q => q.marks === marks).length;
            if (availableCount < requiredCount) {
                missingMessages.push(`need ${requiredCount} for ${marks} marks (found ${availableCount})`);
            }
        }

        if (missingMessages.length > 0) {
            return { error: `Not enough questions in bank: ${missingMessages.join('; ')}.` };
        }
        
        let finalQuestions: Question[] = [];
        for (const { count, marks } of distribution) {
            const suitableQuestions = sourcePool.filter(q => q.marks === marks);
            const selected = suitableQuestions.sort(() => 0.5 - Math.random()).slice(0, count);
            finalQuestions.push(...selected);
            sourcePool = sourcePool.filter(q => !selected.some(s => s.id === q.id));
        }
        return { questions: finalQuestions };
    }, [questions, selectedClass, avoidPrevious]);
    
    const createPaper = useCallback((questions: Question[], source: QuestionSource, grounding_sources?: GroundingSource[]): Paper => {
        return {
            id: new Date().toISOString(),
            title: title.trim() || `Class ${selectedClass} Paper - ${year}`,
            year,
            class: selectedClass,
            semester,
            board,
            subject: selectedSubject,
            source,
            questions,
            created_at: new Date().toISOString(),
            grounding_sources,
        };
    }, [title, year, selectedClass, semester, board, selectedSubject]);


    const handleGenerate = async (useAI: boolean) => {
        setIsGenerating(true);
        setGeneratedPaper(null);
    
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
    
        const distribution = settings.distribution.filter(d => d.count > 0 && d.marks > 0);
        try {
            if (distribution.length === 0) {
                showToast('Please add at least one question type to the mark distribution.', 'error');
                return;
            }
    
            if (useAI) {
                if (!selectedSubject) {
                    showToast('Please select a subject first.', 'error');
                    return;
                }
                if (settings.aiChapters.length === 0) {
                    showToast('Please provide at least one chapter for AI generation.', 'error');
                    return;
                }
                
                let existingQuestionPool = questions.filter(q => 
                    q.class === selectedClass && 
                    (avoidPrevious ? q.used_in.length === 0 : true)
                );
                
                let finalQuestions: Question[] = [];
                let allGroundingChunks: any[] = [];
                
                const allQuestionTypes = settings.aiQuestionType.length > 0 ? settings.aiQuestionType : ['Short Answer'];
                const textQuestionTypes = allQuestionTypes.filter(t => t !== 'Image-based');
                const hasImageQuestions = allQuestionTypes.includes('Image-based');

                let textPaperStructure: { count: number; marks: number; types: string[]; }[] = [];
                let imageGenerationRequests: { count: number; marks: number; }[] = [];

                if (hasImageQuestions && textQuestionTypes.length > 0) {
                    // Mixed mode: split the distribution
                    distribution.forEach(({ count, marks }) => {
                        const imageCount = Math.round(count / allQuestionTypes.length);
                        const textCount = count - imageCount;
                        if (textCount > 0) {
                            textPaperStructure.push({ count: textCount, marks: marks, types: textQuestionTypes });
                        }
                        if (imageCount > 0) {
                            imageGenerationRequests.push({ count: imageCount, marks: marks });
                        }
                    });
                } else if (hasImageQuestions) {
                    // Only image questions
                    distribution.forEach(({ count, marks }) => {
                        imageGenerationRequests.push({ count: count, marks: marks });
                    });
                } else {
                    // Only text questions
                    textPaperStructure = distribution.map(d => ({ ...d, types: textQuestionTypes }));
                }

                // 1. Generate text-based questions if any
                if (textPaperStructure.length > 0) {
                    const { generatedQuestions, groundingChunks } = await generateQuestionsAI({
                        class: selectedClass, subject: selectedSubject, chapters: settings.aiChapters, difficulty: settings.aiDifficulty,
                        paperStructure: textPaperStructure,
                        keywords: settings.aiKeywords, generateAnswer: settings.aiGenerateAnswers,
                        wbbseSyllabusOnly: settings.wbbseSyllabusOnly, lang: lang, useSearchGrounding: settings.useSearchGrounding,
                    }, existingQuestionPool, userApiKey, userOpenApiKey, signal);

                    if (generatedQuestions.length > 0) {
                         const newQuestions = (generatedQuestions as any[]).map((g): Question => ({
                            id: `gen-${new Date().toISOString()}-${Math.random()}`, text: g.text!, answer: g.answer,
                            image_data_url: g.image_data_url, class: selectedClass, chapter: g.chapter, marks: g.marks,
                            difficulty: settings.aiDifficulty, used_in: [], source: QuestionSource.Generated,
                            year: year, semester: semester, tags: settings.aiKeywords.split(',').map(t => t.trim()).filter(Boolean),
                        }));
                        finalQuestions.push(...newQuestions);
                        existingQuestionPool.push(...newQuestions);
                    }
                    if (groundingChunks) allGroundingChunks.push(...groundingChunks);
                }

                // 2. Concurrently generate image-based questions
                if (imageGenerationRequests.length > 0) {
                    const imageQuestionPromises = imageGenerationRequests.map(({ count, marks }) => {
                        return generateQuestionsAI({
                            class: selectedClass, subject: selectedSubject, chapter: settings.aiChapters[0], marks,
                            difficulty: settings.aiDifficulty, count: count, questionType: 'Image-based',
                            keywords: settings.aiKeywords, generateAnswer: settings.aiGenerateAnswers,
                            wbbseSyllabusOnly: settings.wbbseSyllabusOnly, lang: lang,
                        }, existingQuestionPool, userApiKey, userOpenApiKey, signal);
                    });

                    const imageQuestionResults = await Promise.all(imageQuestionPromises);

                    imageQuestionResults.forEach((result, index) => {
                        if (!result || !result.generatedQuestions) return;
                        const { generatedQuestions } = result;
                        if (generatedQuestions.length > 0) {
                            const { marks } = imageGenerationRequests[index];
                            const newQuestions = generatedQuestions.map((g): Question => ({
                                id: `gen-img-${new Date().toISOString()}-${Math.random()}`, text: g.text!, answer: g.answer,
                                image_data_url: g.image_data_url, class: selectedClass, chapter: settings.aiChapters[0], marks: marks,
                                difficulty: settings.aiDifficulty, used_in: [], source: QuestionSource.Generated,
                                year: year, semester: semester, tags: settings.aiKeywords.split(',').map(t => t.trim()).filter(Boolean),
                            }));
                            finalQuestions.push(...newQuestions);
                            existingQuestionPool.push(...newQuestions);
                        }
                    });
                }

                const grounding_sources = allGroundingChunks
                    ?.map((chunk: any) => chunk.web)
                    .filter(Boolean)
                    .map((source: any) => ({ uri: source.uri, title: source.title }))
                    .filter((source, index, self) => index === self.findIndex(s => s.uri === source.uri));


                const paper = createPaper(finalQuestions, QuestionSource.Generated, grounding_sources);
                const savedPaper = await onSavePaper(paper);
                if (savedPaper) {
                    setGeneratedPaper(savedPaper);
                }
            } else {
                const result = generateFromBank(distribution);
                if ('error' in result) {
                    showToast(result.error, 'error');
                } else {
                    const paper = createPaper(result.questions, QuestionSource.Manual);
                    const savedPaper = await onSavePaper(paper);
                     if (savedPaper) {
                        setGeneratedPaper(savedPaper);
                    }
                }
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log("Generation aborted.");
                showToast('Generation cancelled.', 'success');
            } else {
                console.error("Error generating paper with AI:", error);

                if (typeof error.message === 'string' && error.message.includes("API Key is not configured")) {
                    showToast(error.message, 'error');
                    return;
                }

                const fallbackResult = generateFromBank(distribution);

                if ('error' in fallbackResult) {
                    let isQuotaError = false;
                    const errorDetails = error?.error || error;
                    const messageText = String(error?.message || errorDetails?.message || '').toLowerCase();
                    
                    if (
                        errorDetails?.status === 'RESOURCE_EXHAUSTED' ||
                        errorDetails?.code === 429 ||
                        messageText.includes('quota') ||
                        messageText.includes('rate limit')
                    ) {
                        isQuotaError = true;
                    }

                    const aiErrorMessage = isQuotaError ? t('apiQuotaError', lang) : t('apiError', lang);
                    showToast(`${aiErrorMessage}. ${fallbackResult.error}`, 'error');
                    
                } else {
                    showToast(t('fallbackToBank', lang), 'success');
                    const paper = createPaper(fallbackResult.questions, QuestionSource.Manual);
                    const savedPaper = await onSavePaper(paper);
                    if (savedPaper) {
                        setGeneratedPaper(savedPaper);
                    }
                }
            }
        } finally {
            setIsGenerating(false);
            abortControllerRef.current = null;
        }
    };

    const openImageViewer = (imageDataURL: string) => {
        setViewingImage(imageDataURL);
        setImageViewerOpen(true);
    };
    
    const handleSaveDraft = () => {
        const { board, selectedClass, selectedSubject, ...draftToSave } = draftData;
        localStorage.setItem(PAPER_GENERATOR_DRAFT_KEY, JSON.stringify(draftToSave));
        showToast(t('draftSaved', lang));
    };

    const handleClearDraft = () => {
        localStorage.removeItem(PAPER_GENERATOR_DRAFT_KEY);
        setTitle('');
        setYear(new Date().getFullYear());
        setSemester(Semester.First);
        setAvoidPrevious(true);
        resetSettings({
            distribution: [{ count: 5, marks: 1 }, { count: 5, marks: 2 }, { count: 2, marks: 5 }],
            aiChapters: [],
            aiDifficulty: Difficulty.Moderate,
            aiKeywords: '',
            aiQuestionType: [],
            aiGenerateAnswers: false,
            wbbseSyllabusOnly: getInitialWbbseState(),
            useSearchGrounding: false,
        });
        showToast(t('draftCleared', lang));
    };

    const handleClearAISettings = () => {
        const currentSettings = { ...settings };
        currentSettings.aiChapters = [];
        currentSettings.aiKeywords = '';
        currentSettings.aiQuestionType = [];
        currentSettings.aiDifficulty = Difficulty.Moderate;
        currentSettings.aiGenerateAnswers = false;
        currentSettings.useSearchGrounding = false;
        setSettings(currentSettings);
        showToast(t('aiSettingsCleared', lang));
    };
    
    const handleExportTXT = (paper: Paper) => {
        if (!paper) return;

        let content = `${paper.title}\n`;
        content += `Class: ${paper.class}, Year: ${paper.year}, Semester: ${paper.semester}\n`;
        content += `Total Marks: ${paper.questions.reduce((acc, q) => acc + q.marks, 0)}\n`;
        content += '====================================\n\n';

        paper.questions.forEach((q, index) => {
            content += `${index + 1}. ${q.text} (${q.marks} ${t('marks', lang)})\n\n`;
            if (q.image_data_url) {
                content += `[Image-based question. Image not included in text export.]\n\n`;
            }
        });
        
        const questionsWithAnswers = paper.questions.filter(q => q.answer);
        if (questionsWithAnswers.length > 0) {
            content += '====================================\n';
            content += `${t('answerKey', lang)}\n`;
            content += '====================================\n\n';
            questionsWithAnswers.forEach((q) => {
                const answerIndex = paper.questions.findIndex(pq => pq.id === q.id) + 1;
                content += `${answerIndex}. ${q.answer}\n`;
            });
            content += '\n';
        }

        if (paper.grounding_sources && paper.grounding_sources.length > 0) {
            content += '====================================\n';
            content += `${t('sources', lang)}\n`;
            content += '====================================\n\n';
            paper.grounding_sources.forEach(source => {
                content += `${source.title || 'Untitled'}: ${source.uri}\n`;
            });
            content += '\n';
        }

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${paper.title.replace(/ /g, '_')}.txt`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleExportWord = async (paper: Paper) => {
        if (!paper) return;

        let htmlContent = `
            <html>
                <head><meta charset="UTF-8"></head>
                <body>
                    <h1 style="text-align: center;">${paper.title}</h1>
                    <p><strong>Class:</strong> ${paper.class}, <strong>Year:</strong> ${paper.year}, <strong>Semester:</strong> ${paper.semester}</p>
                    <hr />
        `;
    
        paper.questions.forEach((q, index) => {
            htmlContent += `
                <p><strong>${index + 1}.</strong> ${q.text} <em>(${q.marks} ${t('marks', lang)})</em></p>
            `;
            if (q.image_data_url) {
                htmlContent += `<p><img src="${q.image_data_url}" alt="Question Image" style="max-width: 400px; height: auto;" /></p>`;
            }
        });
    
        if (paper.questions.some(q => q.answer)) {
            htmlContent += `
                <hr />
                <h2>${t('answerKey', lang)}</h2>
            `;
            paper.questions.forEach((q, index) => {
                if (q.answer) {
                    htmlContent += `<p><strong>${index + 1}.</strong> ${q.answer}</p>`;
                }
            });
        }
        
        if (paper.grounding_sources && paper.grounding_sources.length > 0) {
            htmlContent += `
                <hr />
                <h2>${t('sources', lang)}</h2>
            `;
            paper.grounding_sources.forEach(source => {
                htmlContent += `<p><a href="${source.uri}">${source.title || source.uri}</a></p>`;
            });
        }
    
        htmlContent += '</body></html>';
    
        const blob = new Blob([`\ufeff${htmlContent}`], { type: 'application/msword' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `${paper.title.replace(/ /g, '_')}.doc`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    
    const handleExportPDF = async (paper: Paper) => {
        if (!paper) return;

        try {
            await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
        } catch (error) {
            console.error("Failed to load jsPDF library", error);
            showToast("Failed to load PDF export library.", "error");
            return;
        }

        const { jsPDF } = (window as any).jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        let fontName = 'helvetica';
        let fontLoaded = false;
        const languageMap: Record<Language, string> = { en: 'English', bn: 'Bengali', hi: 'Hindi', ka: 'Kannada' };

        if (lang === 'bn') {
            const fontData = await getBengaliFontBase64();
            if (fontData) {
                doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData);
                doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal');
                fontName = 'NotoSansBengali';
                fontLoaded = true;
            }
        } else if (lang === 'hi') {
            const fontData = await getDevanagariFontBase64();
            if (fontData) {
                doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData);
                doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal');
                fontName = 'NotoSansDevanagari';
                fontLoaded = true;
            }
        } else if (lang === 'ka') {
            const fontData = await getKannadaFontBase64();
            if (fontData) {
                doc.addFileToVFS('NotoSansKannada-Regular.ttf', fontData);
                doc.addFont('NotoSansKannada-Regular.ttf', 'NotoSansKannada', 'normal');
                fontName = 'NotoSansKannada';
                fontLoaded = true;
            }
        }

        if (lang !== 'en' && !fontLoaded) {
            showToast(`Could not load the font for ${languageMap[lang]}. PDF content may not display correctly.`, 'error');
        }

        const pageHeight = doc.internal.pageSize.getHeight();
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 15;
        const maxLineWidth = pageWidth - margin * 2;
        let y = margin;

        const checkPageBreak = (neededHeight: number) => {
            if (y + neededHeight > pageHeight - margin) {
                doc.addPage();
                y = margin;
            }
        };
        
        doc.setFontSize(14);
        doc.setFont(fontName, 'bold');
        const titleLines = doc.splitTextToSize(paper.title, maxLineWidth);
        doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
        y += titleLines.length * 6 + 8;

        doc.setFontSize(10);
        doc.setFont(fontName, 'normal');

        paper.questions.forEach((q, index) => {
            const questionText = `${index + 1}. ${q.text} (${q.marks} ${t('marks', lang)})`;
            
            if (q.image_data_url) {
                try {
                    const imgProps = doc.getImageProperties(q.image_data_url);
                    const imgWidth = 80; // Fixed width for consistency
                    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                    checkPageBreak(imgHeight + 5); // Check for image height + padding
                    doc.addImage(q.image_data_url, 'JPEG', margin, y, imgWidth, imgHeight);
                    y += imgHeight + 5; // Move y cursor down
                } catch (e) {
                    console.error("Error adding image to PDF:", e);
                }
            }

            const lines = doc.splitTextToSize(questionText, maxLineWidth);
            const textHeight = lines.length * 4.5;
            checkPageBreak(textHeight + 3);
            doc.text(lines, margin, y);
            y += textHeight + 3;
        });

        if (paper.grounding_sources && paper.grounding_sources.length > 0) {
            const sourcesTitle = t('sources', lang);
            checkPageBreak(8 + 3 + 4.5);
            y += 8;
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(sourcesTitle, margin, y);
            y += 6 + 2;
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            paper.grounding_sources.forEach(source => {
                const sourceText = `${source.title || 'Untitled'}: ${source.uri}`;
                const lines = doc.splitTextToSize(sourceText, maxLineWidth);
                const textHeight = lines.length * 4;
                checkPageBreak(textHeight + 2);
                doc.textWithLink(source.title || source.uri, margin, y, { url: source.uri });
                y += textHeight + 2;
            });
        }
        
        const questionsWithAnswers = paper.questions.filter(q => q.answer);
        if (questionsWithAnswers.length > 0) {
            const answerKeyTitle = t('answerKey', lang);
            checkPageBreak(8 + 3 + 4.5);
            y += 8;
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(answerKeyTitle, margin, y);
            y += 6 + 2;
            doc.setFontSize(10);
            doc.setFont(fontName, 'normal');
            questionsWithAnswers.forEach((q) => {
                const answerIndex = paper.questions.findIndex(pq => pq.id === q.id) + 1;
                const answerText = `${answerIndex}. ${q.answer}`;
                const lines = doc.splitTextToSize(answerText, maxLineWidth);
                const textHeight = lines.length * 4.5;
                checkPageBreak(textHeight + 2);
                doc.text(lines, margin, y);
                y += textHeight + 2;
            });
        }

        doc.save(`${paper.title.replace(/ /g, '_')}.pdf`);
    };
    
    const handleExportXLSX = async (paper: Paper) => {
        if (!paper) return;

        try {
            await loadScript("https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js");
        } catch (error) {
            console.error("Failed to load XLSX library", error);
            showToast("Failed to load Excel export library.", "error");
            return;
        }

        const XLSX = (window as any).XLSX;
        const questionData = paper.questions.map((q, index) => ({
            'No.': index + 1,
            'Question': q.image_data_url ? `[Image-based question] ${q.text}` : q.text,
            'Marks': q.marks,
        }));
        const answerData = paper.questions
            .filter(q => q.answer)
            .map((q) => ({
                'No.': paper.questions.findIndex(pq => pq.id === q.id) + 1,
                'Answer': q.answer,
            }));
        
        const sourceData = (paper.grounding_sources || []).map(s => ({
            'Title': s.title,
            'URL': s.uri,
        }));

        const questionSheet = XLSX.utils.json_to_sheet(questionData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, questionSheet, 'Questions');

        if (answerData.length > 0) {
            const answerSheet = XLSX.utils.json_to_sheet(answerData);
            XLSX.utils.book_append_sheet(wb, answerSheet, 'Answer Key');
        }

        if (sourceData.length > 0) {
            const sourceSheet = XLSX.utils.json_to_sheet(sourceData);
            XLSX.utils.book_append_sheet(wb, sourceSheet, 'Sources');
        }

        XLSX.writeFile(wb, `${paper.title.replace(/ /g, '_')}.xlsx`);
    };

    const handleExportCSV = (paper: Paper) => {
        if (!paper) return;
        const headers = ['No.', 'Question', 'Marks', 'Answer'];
        const data = paper.questions.map((q, index) => ({
            'No.': index + 1,
            'Question': q.text,
            'Marks': q.marks,
            'Answer': q.answer || '',
        }));

        const csvRows = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => 
                    `"${String(row[header as keyof typeof row]).replace(/"/g, '""')}"`
                ).join(',')
            )
        ];
        const csvString = csvRows.join('\r\n');

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${paper.title.replace(/ /g, '_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const calculatedTotal = useMemo(() => {
        try {
            return settings.distribution.reduce((acc, { count, marks }) => acc + (count * marks), 0);
        } catch {
            return 'N/A';
        }
    }, [settings.distribution]);
    
    const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
    const labelStyles = "block text-sm font-semibold text-slate-600 mb-1";

    const chapterDropdownItems = useMemo(() => {
        const lowercasedInput = chapterInput.toLowerCase();
        // Filter out already selected chapters
        const availableChapters = chaptersList.filter(c => !settings.aiChapters.includes(c));

        if (!chapterInput) {
            return availableChapters; // If input is empty, show all available chapters
        }
        
        // If there is input, filter the available chapters
        return availableChapters.filter(c => c.toLowerCase().includes(lowercasedInput));
    }, [chapterInput, chaptersList, settings.aiChapters]);
    
    const addChapter = (chapter: string) => {
        const trimmed = chapter.trim();
        if (trimmed && !settings.aiChapters.includes(trimmed)) {
            handleSettingsChange('aiChapters', [...settings.aiChapters, trimmed]);
        }
        setChapterInput('');
    };

    const removeChapter = (index: number) => {
        const newChapters = settings.aiChapters.filter((_, i) => i !== index);
        handleSettingsChange('aiChapters', newChapters);
    };

    const handleChapterInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && chapterInput) {
            e.preventDefault();
            addChapter(chapterInput);
        }
    };

    const handleChapterInputFocus = () => {
        setIsChapterDropdownOpen(true);
    };

    const handleChapterInputBlur = () => {
        // We use a short timeout to allow a click on a dropdown item to register before we close it.
        setTimeout(() => {
            setIsChapterDropdownOpen(false);
        }, 150);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-2 sm:p-4">
            {/* Left Column: Generator Settings */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
                <h2 className="text-xl font-bold font-serif-display text-slate-800">{t('generatePaper', lang)}</h2>
                
                {/* Paper Details Section */}
                <div className="border-t border-slate-200 pt-5 space-y-4">
                    <AnimatedHeader emoji="📋" animation="animate-tilt" title={t('paperDetails', lang)} />
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex-grow min-w-[200px] sm:min-w-[250px]">
                            <label htmlFor="title" className={labelStyles}>{t('paperTitle', lang)}</label>
                            <input id="title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={`e.g., Mid-term Exam`} className={inputStyles} />
                        </div>
                        <div className="flex-1 min-w-[80px]">
                            <label htmlFor="board" className={labelStyles}>{t('board', lang)}</label>
                            <select id="board" value={board} onChange={e => setBoard(e.target.value)} className={inputStyles}>
                                {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                         <div className="flex-1 min-w-[80px]">
                            <label htmlFor="class" className={labelStyles}>{t('class', lang)}</label>
                            <select id="class" value={selectedClass} onChange={e => setClass(parseInt(e.target.value))} className={inputStyles}>
                                {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="flex-1 min-w-[120px]">
                            <label htmlFor="subject" className={labelStyles}>{t('subject', lang)}</label>
                            <select 
                                id="subject" 
                                value={selectedSubject} 
                                onChange={e => setSelectedSubject(e.target.value)} 
                                className={inputStyles}
                                disabled={loadingSubjects || subjectsList.length === 0}
                            >
                                <option value="">{loadingSubjects ? 'Loading...' : 'Select Subject'}</option>
                                {subjectsList.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                        <div className="flex-1 min-w-[80px]">
                            <label htmlFor="year" className={labelStyles}>{t('year', lang)}</label>
                            <select id="year" value={year} onChange={e => setYear(parseInt(e.target.value))} className={inputStyles}>
                                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="flex-1 min-w-[80px]">
                            <label htmlFor="semester" className={labelStyles}>{t('semester', lang)}</label>
                            <select id="semester" value={semester} onChange={e => setSemester(e.target.value as Semester)} className={inputStyles}>
                                 {SEMESTERS.map(s => <option key={s} value={s}>{`Sem ${s}`}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                
                 {/* AI Settings */}
                <div className="border-t border-slate-200 pt-5 space-y-4">
                    <div className="flex justify-between items-center">
                        <AnimatedHeader emoji="✨" animation="animate-sparkle" title={t('aiGeneration', lang)} />
                        <div className="flex items-center space-x-2">
                             <button onClick={handleClearAISettings} className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors">{t('clearAISettings', lang)}</button>
                            <div className="flex items-center space-x-2">
                                <button onClick={undo} disabled={!canUndo} className="disabled:opacity-40">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                    <span className="sr-only">{t('undo', lang)}</span>
                                </button>
                                <button onClick={redo} disabled={!canRedo} className="disabled:opacity-40">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                                    <span className="sr-only">{t('redo', lang)}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                     <div>
                        <label htmlFor="aiChapterInput" className={labelStyles}>{t('selectChapterForAI', lang)}</label>
                        <div className="relative">
                            <div className="flex flex-wrap gap-2 p-2 border border-slate-300 bg-white rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-indigo-400 transition min-h-[46px]">
                                {settings.aiChapters.map((chapter, index) => (
                                    <span key={index} className="flex items-center gap-2 bg-indigo-100 text-indigo-800 text-sm font-medium px-2 py-1 rounded-full">
                                        {chapter}
                                        <button type="button" onClick={() => removeChapter(index)} className="text-indigo-600 hover:text-indigo-800 font-bold" aria-label={`Remove ${chapter}`}>
                                            &times;
                                        </button>
                                    </span>
                                ))}
                                <input
                                    id="aiChapterInput"
                                    type="text"
                                    value={chapterInput}
                                    onChange={e => setChapterInput(e.target.value)}
                                    onKeyDown={handleChapterInputKeyDown}
                                    onFocus={handleChapterInputFocus}
                                    onBlur={handleChapterInputBlur}
                                    autoComplete="off"
                                    placeholder={!selectedSubject ? 'Select a subject first' : loadingChapters ? t('fetchingChapters', lang) : t('addChapterPlaceholder', lang)}
                                    className="flex-grow bg-transparent outline-none p-1"
                                    disabled={loadingChapters || !selectedSubject}
                                />
                            </div>
                            {isChapterDropdownOpen && chapterDropdownItems.length > 0 && selectedSubject && (
                                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg flex flex-col">
                                    <div className="text-right p-1 border-b">
                                        <button 
                                            type="button" 
                                            onMouseDown={(e) => { e.preventDefault(); setIsChapterDropdownOpen(false); }} 
                                            className="text-slate-400 hover:text-red-600 p-1 rounded-full hover:bg-red-50 transition-colors"
                                            aria-label="Close"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </div>
                                    <ul className="max-h-48 overflow-y-auto">
                                        {chapterDropdownItems.map(suggestion => (
                                            <li key={suggestion} onMouseDown={(e) => { e.preventDefault(); addChapter(suggestion); }} className="p-2 cursor-pointer hover:bg-slate-100 text-sm">
                                                {suggestion}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                    <div>
                        <label htmlFor="aiKeywords" className={labelStyles}>{t('keywordsForAI', lang)}</label>
                        <input id="aiKeywords" type="text" value={settings.aiKeywords} onChange={e => handleSettingsChange('aiKeywords', e.target.value)} className={inputStyles} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelStyles}>{t('questionTypeForAI', lang)}</label>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {questionTypes.map(type => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => handleQuestionTypeChange(type)}
                                        className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-full transition-colors ${
                                            settings.aiQuestionType.includes(type)
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                        }`}
                                    >
                                        {t(type, lang)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                             <label htmlFor="aiDifficulty" className={labelStyles}>{t('difficulty', lang)}</label>
                            <select id="aiDifficulty" value={settings.aiDifficulty} onChange={e => handleSettingsChange('aiDifficulty', e.target.value as Difficulty)} className={inputStyles}>
                                {Object.values(Difficulty).map(d => <option key={d} value={d}>{t(d, lang)}</option>)}
                            </select>
                        </div>
                    </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 pt-2">
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input type="checkbox" checked={avoidPrevious} onChange={e => setAvoidPrevious(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm font-medium text-slate-700">{t('avoidPrevious', lang)}</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input type="checkbox" checked={settings.aiGenerateAnswers} onChange={e => handleSettingsChange('aiGenerateAnswers', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm font-medium text-slate-700">{t('generateAnswersForAI', lang)}</span>
                        </label>
                         <label className="flex items-center space-x-2 cursor-pointer">
                            <input type="checkbox" checked={settings.wbbseSyllabusOnly} onChange={e => handleSettingsChange('wbbseSyllabusOnly', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm font-medium text-slate-700">{t('wbbseSyllabusOnly', lang)}</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                            <input type="checkbox" checked={settings.useSearchGrounding} onChange={e => handleSettingsChange('useSearchGrounding', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span className="text-sm font-medium text-slate-700">{t('useSearchGrounding', lang)}</span>
                        </label>
                    </div>
                </div>

                {/* New Mark Distribution */}
                <div className="border-t border-slate-200 pt-5">
                    <div className="flex items-center justify-between mb-2">
                        <AnimatedHeader emoji="📊" animation="animate-pulse" title={t('markDistribution', lang)} />
                         <p className="text-sm font-bold text-slate-700">{t('totalMarks', lang)}: <span className="text-indigo-600">{calculatedTotal}</span></p>
                    </div>
                     <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center px-1 mb-1">
                            <label className="text-xs font-semibold text-slate-500">{t('numberOfQuestions', lang)}</label>
                            <div></div>
                            <label className="text-xs font-semibold text-slate-500">{t('marksPerQuestion', lang)}</label>
                            <div></div>
                        </div>
                        {settings.distribution.map((dist, index) => (
                            <div key={index} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={dist.count}
                                    onChange={e => {
                                        const value = e.target.value.replace(/\D/g, '');
                                        handleDistributionChange(index, 'count', value === '' ? 0 : parseInt(value, 10));
                                    }}
                                    className={inputStyles}
                                    aria-label={t('numberOfQuestions', lang)}
                                />
                                <div className="text-slate-500 font-medium text-center">x</div>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    list="marks-options"
                                    value={dist.marks}
                                    onChange={e => {
                                        const value = e.target.value.replace(/\D/g, '');
                                        handleDistributionChange(index, 'marks', value === '' ? 0 : parseInt(value, 10));
                                    }}
                                    className={inputStyles}
                                    aria-label={t('marksPerQuestion', lang)}
                                />
                                <button onClick={() => removeDistributionRow(index)} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100 transition-colors" aria-label={`${t('remove', lang)} row`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                                </button>
                            </div>
                        ))}
                         <datalist id="marks-options">
                            {MARKS.map(m => <option key={m} value={m} />)}
                        </datalist>
                        <button onClick={addDistributionRow} className="w-full text-center px-4 py-2 bg-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-300 transition-colors">
                            + {t('addQuestionType', lang)}
                        </button>
                    </div>
                </div>

                {/* Actions */}
                <div className="border-t border-slate-200 pt-5 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <button onClick={() => handleGenerate(false)} disabled={isGenerating} className="flex-1 px-5 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:bg-indigo-300">
                            {isGenerating ? t('generating', lang) : t('generate', lang)}
                        </button>
                        <button onClick={() => handleGenerate(true)} disabled={isGenerating} className="flex-1 px-5 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-lg hover:from-purple-600 hover:to-indigo-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:from-purple-300 disabled:to-indigo-400">
                           {isGenerating ? t('generating', lang) : `🚀 ${t('generateWithAI', lang)}`}
                        </button>
                    </div>
                    <div className="flex justify-center space-x-4">
                        <button onClick={handleSaveDraft} className="text-sm font-semibold text-slate-600 hover:text-indigo-700">{t('saveDraft', lang)}</button>
                        <button onClick={handleClearDraft} className="text-sm font-semibold text-slate-600 hover:text-red-700">{t('clearDraft', lang)}</button>
                    </div>
                </div>
            </div>

            {/* Right Column: Paper Preview */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 lg:max-h-[85vh] flex flex-col">
                 <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">{t('paperPreview', lang)}</h2>
                {isGenerating && (
                    <div className="flex-grow flex flex-col items-center justify-center space-y-3">
                        <div className="w-12 h-12 border-4 border-t-indigo-600 border-slate-200 rounded-full animate-spin"></div>
                        <p className="text-slate-600 font-semibold">{t('generating', lang)}</p>
                    </div>
                )}
                
                {!isGenerating && generatedPaper && (
                    <div className="flex-grow flex flex-col">
                        <div className="overflow-y-auto pr-2 flex-grow">
                             <h3 className="text-xl font-bold font-serif-display text-slate-800 text-center mb-6">{generatedPaper.title}</h3>
                            <div className="prose max-w-none prose-slate space-y-4">
                                {generatedPaper.questions.map((q, index) => (
                                    <div key={q.id}>
                                        {q.image_data_url && (
                                            <img 
                                                src={q.image_data_url} 
                                                alt="Question illustration" 
                                                className="max-w-xs mx-auto rounded-lg border my-2 cursor-pointer hover:shadow-md transition-shadow"
                                                onClick={() => openImageViewer(q.image_data_url!)}
                                            />
                                        )}
                                        <p><strong>{index + 1}.</strong> {q.text} <span className="text-sm text-slate-500">({q.marks} ${t('marks', lang)})</span></p>
                                    </div>
                                ))}
                            </div>
                            
                            {generatedPaper.grounding_sources && generatedPaper.grounding_sources.length > 0 && (
                                <div className="mt-8 pt-4 border-t border-slate-200">
                                    <h3 className="text-lg font-bold font-serif-display text-slate-800 mb-3">{t('sources', lang)}</h3>
                                    <ul className="prose prose-sm max-w-none prose-slate list-disc list-inside space-y-1">
                                        {generatedPaper.grounding_sources.map(source => (
                                            <li key={source.uri}>
                                                <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                                                    {source.title || source.uri}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {generatedPaper.questions.some(q => q.answer) && (
                                <div className="mt-8 pt-4 border-t border-slate-200">
                                    <h3 className="text-lg font-bold font-serif-display text-slate-800 mb-3">{t('answerKey', lang)}</h3>
                                    <div className="prose max-w-none prose-slate space-y-2">
                                        {generatedPaper.questions.map((q, index) => (
                                            q.answer ? (
                                                <p key={`ans-${q.id}`}><strong>{index + 1}.</strong> {q.answer}</p>
                                            ) : null
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
                            <button onClick={() => handleExportTXT(generatedPaper)} className="px-5 py-2.5 bg-slate-600 text-white font-semibold rounded-lg hover:bg-slate-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportTXT', lang)}</button>
                            <button onClick={() => handleExportWord(generatedPaper)} className="px-5 py-2.5 bg-blue-700 text-white font-semibold rounded-lg hover:bg-blue-800 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportWord', lang)}</button>
                            <button onClick={() => handleExportCSV(generatedPaper)} className="px-5 py-2.5 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportCSV', lang)}</button>
                            <button onClick={() => handleExportXLSX(generatedPaper)} className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportXLSX', lang)}</button>
                            <button onClick={() => handleExportPDF(generatedPaper)} className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportPDF', lang)}</button>
                        </div>
                    </div>
                )}
                {!isGenerating && !generatedPaper && <div className="flex-grow flex items-center justify-center text-slate-500"><p>Generate a paper to see a preview.</p></div>}
            </div>

            <Modal isOpen={isImageViewerOpen} onClose={() => setImageViewerOpen(false)} title="Image Preview">
                {viewingImage && <img src={viewingImage} alt="Full size preview" className="w-full h-auto rounded-lg" />}
            </Modal>
        </div>
    );
};

export default PaperGenerator;
