
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FinalExamPaper, Language, Paper, Question, QuestionSource, Difficulty, Semester, UploadProgress } from '../types';
import { supabase } from '../services/supabaseClient';
import { BOARDS, CLASSES, YEARS, FINAL_EXAM_PAPERS_FILTERS_KEY } from '../constants';
import { getSubjectsAI, generateFinalExamPaperAI, findAndRecreateFinalExamPaperAI, analyzeAndSuggestPaperAI } from '../services/geminiService';
import { t } from '../utils/localization';
import Modal from './Modal';

interface FinalExamPapersProps {
    lang: Language;
    userApiKey?: string;
    userOpenApiKey?: string;
    showToast: (message: string, type?: 'success' | 'error') => void;
    onSavePaper: (paper: Paper) => void;
}

const PaperContent: React.FC<{ paper: FinalExamPaper, lang: Language }> = ({ paper, lang }) => {
    return (
        <div className="prose prose-slate max-w-none">
            {paper.paper_content?.sections?.map((section, sectionIndex) => (
                <div key={sectionIndex}>
                    <h3>{section.title}</h3>
                    {section.questions?.map((q, qIndex) => (
                        <div key={qIndex} className="mt-4">
                            <p><strong>{q.q_num}.</strong> {q.text} <span className="text-sm text-slate-500">({q.marks} {t('marks', lang)})</span></p>
                            {q.options && (
                                <ul className="list-none p-0 ml-4">
                                    {q.options.map((opt, optIndex) => <li key={optIndex}>{opt}</li>)}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            ))}
            {paper.grounding_sources && paper.grounding_sources.length > 0 && (
                <div className="mt-8 pt-4 border-t">
                    <h3 className="font-bold">{t('sources', lang)}</h3>
                    <ul className="list-disc list-inside text-sm">
                        {paper.grounding_sources.map(source => (
                            <li key={source.uri}>
                                <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                                    {source.title || source.uri}
                                </a>
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-slate-500 mt-2">
                        This paper was recreated by AI based on information found at the source(s) above.
                    </p>
                </div>
            )}
        </div>
    )
}

const FinalExamPapers: React.FC<FinalExamPapersProps> = ({ lang, userApiKey, userOpenApiKey, showToast, onSavePaper }) => {
    const [filters, setFilters] = useState(() => {
        try {
            const saved = localStorage.getItem(FINAL_EXAM_PAPERS_FILTERS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return {
                    board: parsed.board || 'WBBSE',
                    selectedClass: parsed.selectedClass || 10,
                    selectedSubject: parsed.selectedSubject || '',
                    selectedYear: parsed.selectedYear === 0 ? 0 : (parsed.selectedYear || ''),
                };
            }
        } catch (e) {
            console.warn('Could not parse saved filters for final exam papers', e);
        }
        return {
            board: 'WBBSE',
            selectedClass: 10,
            selectedSubject: '',
            selectedYear: '' as number | '',
        };
    });

    const [subjects, setSubjects] = useState<string[]>([]);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    const [papers, setPapers] = useState<FinalExamPaper[]>([]);
    const [loadingPapers, setLoadingPapers] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [viewingPaper, setViewingPaper] = useState<FinalExamPaper | null>(null);

    // State for the new "Upload & Analyze" feature
    const [analysisFile, setAnalysisFile] = useState<File | null>(null);
    const [targetYear, setTargetYear] = useState(new Date().getFullYear() + 1);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [suggestedPaper, setSuggestedPaper] = useState<FinalExamPaper | null>(null);

    const stableShowToast = useCallback(showToast, []);
    
    useEffect(() => {
        localStorage.setItem(FINAL_EXAM_PAPERS_FILTERS_KEY, JSON.stringify(filters));
    }, [filters]);

    const handleFilterChange = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const availableClasses = useMemo(() => {
        switch (filters.board) {
            case 'WBBSE': case 'ICSE': return CLASSES.filter(c => c <= 10);
            case 'WBCHSE': case 'ISC': return CLASSES.filter(c => c > 10);
            case 'CBSE': default: return CLASSES;
        }
    }, [filters.board]);

    useEffect(() => {
        if (!availableClasses.includes(filters.selectedClass)) {
            handleFilterChange('selectedClass', availableClasses[0] || 10);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableClasses, filters.selectedClass]);

    useEffect(() => {
        setLoadingSubjects(true);
        setSubjects([]);
        
        getSubjectsAI(filters.board, filters.selectedClass, lang, userApiKey, userOpenApiKey)
            .then(subjectList => {
                setSubjects(subjectList);
                if (subjectList.length > 0) {
                    // If the saved subject isn't in the new list, reset it
                    if (!subjectList.includes(filters.selectedSubject)) {
                        const preferred = subjectList.find(s => s.toLowerCase().includes('life science') || s.toLowerCase().includes('biology'));
                        handleFilterChange('selectedSubject', preferred || subjectList[0]);
                    }
                } else {
                     handleFilterChange('selectedSubject', '');
                }
            })
            .catch(() => stableShowToast("Could not fetch subjects.", 'error'))
            .finally(() => setLoadingSubjects(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters.board, filters.selectedClass, lang, userApiKey, userOpenApiKey, stableShowToast]);

    const handleFetchPapers = async () => {
        if (!filters.selectedSubject) {
            showToast("Please select a subject first.", 'error');
            return;
        }
        setLoadingPapers(true);
        setLoadingMessage(t('fetchingPapers', lang));
        setPapers([]); // Clear previous results
        try {
            let query = supabase
                .from('final_exam_papers')
                .select('*')
                .eq('board', filters.board)
                .eq('class', filters.selectedClass)
                .eq('subject', filters.selectedSubject);
            
            if (filters.selectedYear) {
                query = query.eq('exam_year', filters.selectedYear as number);
            }

            const { data, error } = await query.order('exam_year', { ascending: false });

            if (error) throw error;
            
            if (data && data.length > 0) {
                setPapers(data as FinalExamPaper[]);
            } else {
                showToast("No official paper found in the database. Searching the web with AI...", 'success');
                setLoadingMessage('Searching the web with AI...');

                const searchResult = await findAndRecreateFinalExamPaperAI(
                    filters.board,
                    filters.selectedClass,
                    filters.selectedSubject,
                    (filters.selectedYear as number) || new Date().getFullYear(),
                    lang,
                    userApiKey,
                    userOpenApiKey
                );

                if (searchResult) {
                    // AI Search was successful
                    const finalPaper = { ...searchResult.paper, grounding_sources: searchResult.sources };
                    setPapers([finalPaper]);
                    showToast("Found and recreated the paper using AI and Google Search!", 'success');
                } else {
                    // AI Search failed, now fall back to generation
                    showToast("Could not find the official paper online. Generating a realistic sample paper with AI...", 'success');
                    setLoadingMessage('Generating a sample paper with AI...');
                    
                    const generatedPaper = await generateFinalExamPaperAI(
                        filters.board,
                        filters.selectedClass,
                        filters.selectedSubject,
                        (filters.selectedYear as number) || new Date().getFullYear(), // Use selected year or current year
                        lang,
                        userApiKey,
                        userOpenApiKey
                    );
                    
                    if (generatedPaper) {
                        setPapers([generatedPaper]);
                        showToast("AI-generated sample paper is ready!", 'success');
                    } else {
                        showToast("Could not generate a sample paper at this time.", 'error');
                    }
                }
            }
        } catch (err: any) {
            const errorMessage = err.message || 'An unknown error occurred.';
            console.error("Error in handleFetchPapers:", errorMessage, err);
            stableShowToast(`Failed to load or generate papers: ${errorMessage}`, 'error');
        } finally {
            setLoadingPapers(false);
            setLoadingMessage('');
        }
    };
    
    const handleStartAnalysis = async () => {
        if (!analysisFile) {
            showToast(t('selectPaperFile', lang), 'error');
            return;
        }
         if (!filters.selectedSubject) {
            showToast("Please select a subject for context.", 'error');
            return;
        }
        setIsAnalyzing(true);
        setSuggestedPaper(null);
    
        const abortController = new AbortController();
    
        const performAnalysis = async () => {
            if (!analysisFile) return;
            try {
                const fileDataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(analysisFile);
                });
        
                const result = await analyzeAndSuggestPaperAI(
                    fileDataUrl,
                    targetYear,
                    filters.board,
                    filters.selectedClass,
                    filters.selectedSubject,
                    lang,
                    userApiKey,
                    userOpenApiKey,
                    abortController.signal
                );
        
                if (result) {
                    setSuggestedPaper(result);
                    setViewingPaper(result);
                } else {
                    showToast("AI could not generate a suggested paper from the provided file.", 'error');
                }
        
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    stableShowToast(err.message || "An error occurred during analysis.", 'error');
                }
            }
        };
    
        await performAnalysis();
    
        setIsAnalyzing(false);
    };
    
    const handleSaveSuggestionToArchive = () => {
        if (!suggestedPaper) return;
    
        const newQuestions: Question[] = suggestedPaper.paper_content.sections.flatMap(section => 
            section.questions.map((q, index): Question => ({
                id: `gen-${Date.now()}-${section.title.replace(/\s/g, '')}-${index}`,
                class: suggestedPaper.class,
                chapter: 'AI Suggested', 
                text: `${q.q_num} ${q.text}` + (q.options ? `\n${q.options.join('\n')}` : ''),
                answer: q.answer,
                marks: q.marks,
                difficulty: Difficulty.Moderate,
                used_in: [],
                source: QuestionSource.Generated,
                year: suggestedPaper.exam_year,
                semester: Semester.First, // Default semester
                tags: ['AI Suggested', suggestedPaper.subject],
                created_at: new Date().toISOString()
            }))
        );
        
        const newPaper: Paper = {
            id: suggestedPaper.id,
            title: t('aiSuggestedPaperFor', lang).replace('{year}', String(suggestedPaper.exam_year)),
            year: suggestedPaper.exam_year,
            class: suggestedPaper.class,
            semester: Semester.First,
            board: suggestedPaper.board,
            subject: suggestedPaper.subject,
            source: QuestionSource.Generated,
            questions: newQuestions,
            created_at: new Date().toISOString(),
        };
        
        onSavePaper(newPaper);
        setViewingPaper(null);
        setSuggestedPaper(null);
    };

    const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
    const labelStyles = "block text-sm font-semibold text-slate-600 mb-1";

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4 flex items-center"><span className="text-2xl mr-2 animate-bobbing">📜</span>{t('finalExamPapers', lang)}</h2>
                <div className="flex flex-wrap items-end gap-4">
                    <div className="flex-1 min-w-[120px]">
                        <label className={labelStyles}>{t('board', lang)}</label>
                        <select value={filters.board} onChange={e => handleFilterChange('board', e.target.value)} className={inputStyles}>
                            {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[80px]">
                        <label className={labelStyles}>{t('class', lang)}</label>
                        <select value={filters.selectedClass} onChange={e => handleFilterChange('selectedClass', parseInt(e.target.value))} className={inputStyles}>
                            {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className={labelStyles}>{t('subject', lang)}</label>
                        <select value={filters.selectedSubject} onChange={e => handleFilterChange('selectedSubject', e.target.value)} className={inputStyles} disabled={loadingSubjects || subjects.length === 0}>
                            <option value="">{loadingSubjects ? 'Loading...' : 'Select Subject'}</option>
                            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[100px]">
                        <label className={labelStyles}>{t('year', lang)}</label>
                        <select value={filters.selectedYear} onChange={e => handleFilterChange('selectedYear', e.target.value ? parseInt(e.target.value) : '')} className={inputStyles}>
                            <option value="">All Years</option>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                </div>
                 <div className="mt-4">
                    <button
                        onClick={handleFetchPapers}
                        disabled={loadingSubjects || !filters.selectedSubject || loadingPapers}
                        className="w-full px-5 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:bg-indigo-300 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {loadingPapers ? (
                            <>
                                <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin mr-2"></div>
                                {loadingMessage || `⏳ ${t('fetchingPapers', lang)}`}
                            </>
                        ) : (
                            <>
                                <span className="mr-2 text-xl">🔍</span>
                                {t('fetchPapers', lang)}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {loadingPapers ? (
                <div className="text-center py-10">
                    <div className="w-8 h-8 border-4 border-t-indigo-600 border-slate-200 rounded-full animate-spin mx-auto"></div>
                    <p className="mt-2 font-semibold text-slate-600">{loadingMessage || t('fetchingPapers', lang)}</p>
                </div>
            ) : papers.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {papers.map(paper => (
                        <button key={paper.id} onClick={() => setViewingPaper(paper)} className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-200 text-left hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all transform hover:-translate-y-1 flex items-center justify-between gap-4">
                            <h3 className="font-bold text-md text-slate-800 truncate">
                                <span className="font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded-md mr-3">{paper.exam_year}</span>
                                {paper.subject}
                                {paper.id.startsWith('ai-gen') && <span className="ml-2 text-xs font-semibold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">AI Sample</span>}
                                {paper.id.startsWith('ai-search') && <span className="ml-2 text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">AI Sourced</span>}
                            </h3>
                            <span className="text-xs font-semibold px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full flex-shrink-0 flex items-center gap-1">👁️ {t('view', lang)}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                    <p>😕 {filters.selectedSubject ? t('noPapersFoundForSelection', lang) : t('selectCurriculumToViewPapers', lang)}</p>
                </div>
            )}
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-xl font-bold font-serif-display text-slate-800 flex items-center"><span className="text-2xl mr-2 animate-bobbing">🔬</span>{t('uploadAndAnalyze', lang)}</h2>
                <p className="text-sm text-slate-500 mb-4">{t('analyzePastPaperSubtitle', lang)}</p>
                <div className="space-y-4 p-4 bg-slate-50 border rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                        <div>
                            <label className={labelStyles}>{t('selectPaperFile', lang)}</label>
                            <input type="file" onChange={e => setAnalysisFile(e.target.files ? e.target.files[0] : null)} accept=".pdf,image/*,.txt" className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
                        </div>
                        <div>
                            <label htmlFor="targetYear" className={labelStyles}>{t('targetExamYear', lang)}</label>
                            <select id="targetYear" value={targetYear} onChange={e => setTargetYear(parseInt(e.target.value))} className={inputStyles}>
                                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                    </div>
                     <button
                        onClick={handleStartAnalysis}
                        disabled={isAnalyzing || !analysisFile || !filters.selectedSubject}
                        className="w-full mt-2 px-5 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 shadow-sm transition-all disabled:bg-purple-300 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isAnalyzing ? (
                            <>
                                <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin mr-2"></div>
                                {t('analyzingPaperForSuggestions', lang)}
                            </>
                        ) : `🚀 ${t('startAnalysis', lang)}`}
                    </button>
                </div>
            </div>

            <Modal isOpen={viewingPaper !== null} onClose={() => { setViewingPaper(null); setSuggestedPaper(null); }}>
                {viewingPaper && (
                    <>
                        <div className="max-h-[60vh] overflow-y-auto pr-2">
                             <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">
                                {suggestedPaper && viewingPaper.id === suggestedPaper.id
                                    ? `✨ ${t('aiSuggestedPaperFor', lang).replace('{year}', String(viewingPaper.exam_year))}`
                                    : `${viewingPaper.subject} - ${viewingPaper.exam_year}`
                                }
                            </h2>
                            <PaperContent paper={viewingPaper} lang={lang} />
                        </div>
                        {suggestedPaper && viewingPaper.id === suggestedPaper.id && (
                            <div className="flex justify-end pt-4 mt-4 border-t border-slate-200">
                                <button
                                    onClick={handleSaveSuggestionToArchive}
                                    className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm transition-all flex items-center gap-2"
                                >
                                    💾 {t('saveToArchive', lang)}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
};

export default FinalExamPapers;
