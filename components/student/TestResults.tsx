

import React, { useState, useMemo } from 'react';
import { TestAttempt, Paper, StudentAnswer, Question, QuestionSource } from '../../types';
import { t } from '../../utils/localization';
import { analyzeTestAttempt } from '../../services/geminiService';

interface TestResultsProps {
    attempts: TestAttempt[];
    papers: Paper[];
    lang: 'en' | 'bn' | 'hi';
    initialAttemptId?: string;
    onUpdateAttempt: (updatedAttempt: TestAttempt) => void;
    onNavigateBack: () => void;
    onStartTest: (paper: Paper) => void;
    onGoToDashboard: () => void;
    userApiKey?: string;
    userOpenApiKey?: string;
}

const TestResults: React.FC<TestResultsProps> = ({ attempts, papers, lang, initialAttemptId, onUpdateAttempt, onNavigateBack, onStartTest, onGoToDashboard, userApiKey, userOpenApiKey }) => {
    const [selectedAttempt, setSelectedAttempt] = useState<TestAttempt | null>(() => {
        return attempts.find(a => (a.paperId + a.completedAt) === initialAttemptId) || null;
    });

    const paperForSelectedAttempt = useMemo(() => {
        if (!selectedAttempt) return null;
        // Prioritize the full paper object stored within the attempt for self-contained results
        if (selectedAttempt.paper) {
            return selectedAttempt.paper;
        }
        // Fallback for official tests or older attempts without an embedded paper
        return papers.find(p => p.id === selectedAttempt.paperId);
    }, [selectedAttempt, papers]);


    const handleBack = () => {
        setSelectedAttempt(null);
        onNavigateBack();
    }

    if (selectedAttempt && paperForSelectedAttempt) {
        return <DetailedResultView 
                    attempt={selectedAttempt} 
                    paper={paperForSelectedAttempt} 
                    lang={lang} 
                    onBack={handleBack}
                    onRetake={() => onStartTest(paperForSelectedAttempt)}
                    onGoToDashboard={onGoToDashboard}
                    onUpdateAttempt={onUpdateAttempt}
                    userApiKey={userApiKey}
                    userOpenApiKey={userOpenApiKey}
                />;
    }

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <header>
                <h1 className="text-3xl font-bold font-serif-display text-slate-800">{t('testResults', lang)}</h1>
            </header>
            {attempts.length > 0 ? (
                <div className="space-y-4">
                    {attempts.map(attempt => {
                        const paper = attempt.paper;
                        const isPractice = paper?.source === QuestionSource.Generated;

                        return (
                            <div key={attempt.paperId + attempt.completedAt} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                                <div className="flex justify-between items-start gap-4">
                                    <div>
                                        <h3 className="font-bold text-slate-800">{attempt.paperTitle}</h3>
                                        <div className="text-sm text-slate-500 mt-1 flex items-center flex-wrap gap-x-3 gap-y-1">
                                            <span>{new Date(attempt.completedAt).toLocaleString()}</span>
                                            {paper && <span>Class {paper.class}</span>}
                                            {paper?.board && <span>{paper.board}</span>}
                                            {isPractice && <span className="font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Practice</span>}
                                        </div>
                                    </div>
                                    <div className="text-right flex-shrink-0 ml-4">
                                         <p className="font-bold text-lg text-indigo-600">
                                            {attempt.score}/{attempt.totalMarks}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex justify-end mt-3">
                                    <button
                                        onClick={() => setSelectedAttempt(attempt)}
                                        className="px-4 py-2 bg-indigo-100 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-200 transition-colors text-sm"
                                    >
                                        {t('viewResults', lang)}
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="text-center py-16 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                    <p>{t('noAttempts', lang)}</p>
                </div>
            )}
        </div>
    );
};


interface DetailedResultViewProps {
    attempt: TestAttempt;
    paper: Paper;
    lang: 'en' | 'bn' | 'hi';
    onBack: () => void;
    onRetake: () => void;
    onGoToDashboard: () => void;
    onUpdateAttempt: (updatedAttempt: TestAttempt) => void;
    userApiKey?: string;
    userOpenApiKey?: string;
}

const DetailedResultView: React.FC<DetailedResultViewProps> = ({ attempt, paper, lang, onBack, onRetake, onGoToDashboard, onUpdateAttempt, userApiKey, userOpenApiKey }) => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    
    const getStudentAnswer = (questionId: string) => {
        return attempt.studentAnswers.find(a => a.questionId === questionId)?.answer || '';
    };
    
    const isCorrect = (questionId: string, correctAnswer?: string) => {
        if (!correctAnswer) return false;
        const studentAnswer = getStudentAnswer(questionId);
        return studentAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
    };

    const handleGetAnalysis = async () => {
        setIsAnalyzing(true);
        setAnalysisError(null);
        try {
            const analysisResult = await analyzeTestAttempt(paper, attempt.studentAnswers, lang, userApiKey, userOpenApiKey);
            onUpdateAttempt({ ...attempt, analysis: analysisResult });
        } catch (error) {
            console.error("Failed to get AI analysis:", error);
            setAnalysisError("Sorry, the analysis could not be generated at this time.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="p-4 sm:p-6">
            <header className="mb-6">
                <button onClick={onBack} className="text-indigo-600 font-semibold mb-4 flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l-4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t('backToResults', lang)}
                </button>
                <h1 className="text-2xl font-bold font-serif-display text-slate-800">{t('testReport', lang)}</h1>
                <p className="text-slate-500">
                    {paper.board && <span className="font-semibold">{paper.board}</span>}
                    {paper.board && ' - '}
                    Class {paper.class} - {attempt.paperTitle}
                </p>
            </header>

            <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-6 flex flex-col sm:flex-row justify-between items-center text-center sm:text-left">
                <div className="mb-4 sm:mb-0">
                    <p className="text-sm text-slate-500 uppercase font-semibold">{t('yourScore', lang)}</p>
                    <p className="text-5xl font-bold text-indigo-600">{attempt.score}<span className="text-3xl text-slate-400">/{attempt.totalMarks}</span></p>
                </div>
                 <div className="flex gap-3">
                    <button onClick={onRetake} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm transition-all">{t('retakeTest', lang)}</button>
                    <button onClick={onGoToDashboard} className="px-5 py-2.5 bg-slate-200 text-slate-800 font-semibold rounded-lg hover:bg-slate-300 transition-all">{t('backToDashboard', lang)}</button>
                </div>
            </div>

            {attempt.analysis ? (
                <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 mb-6">
                    <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">{t('performanceAnalysis', lang)}</h2>
                    <div className="space-y-4">
                        <div>
                            <h3 className="font-semibold text-green-700">{t('strengths', lang)}</h3>
                            <ul className="list-disc list-inside text-slate-600 space-y-1 mt-1">
                                {attempt.analysis.strengths.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-semibold text-yellow-700">{t('weaknesses', lang)}</h3>
                            <ul className="list-disc list-inside text-slate-600 space-y-1 mt-1">
                                {attempt.analysis.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-semibold text-indigo-700">{t('summary', lang)}</h3>
                            <p className="text-slate-600 mt-1">{attempt.analysis.summary}</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="mb-6">
                    <button 
                        onClick={handleGetAnalysis} 
                        disabled={isAnalyzing || !attempt.db_id} 
                        className="w-full px-5 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-semibold rounded-lg hover:from-purple-600 hover:to-indigo-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all disabled:from-purple-300 disabled:to-indigo-400 disabled:cursor-not-allowed"
                        title={!attempt.db_id ? "Analysis requires the result to be saved to your account." : ""}
                    >
                        {isAnalyzing ? t('analyzing', lang) : `🚀 ${t('getAIAnalysis', lang)}`}
                    </button>
                    {analysisError && <p className="text-sm text-center text-red-600 mt-2">{analysisError}</p>}
                </div>
            )}


            <div className="space-y-4">
                {paper.questions.map((q, index) => {
                    const studentAnswer = getStudentAnswer(q.id);
                    const correct = isCorrect(q.id, q.answer);
                    const borderColor = !q.answer ? 'border-slate-300' : correct ? 'border-green-400' : 'border-red-400';
                    const bgColor = !q.answer ? 'bg-white' : correct ? 'bg-green-50' : 'bg-red-50';

                    return (
                        <div key={q.id} className={`p-5 rounded-xl border-2 ${borderColor} ${bgColor}`}>
                            <p className="font-semibold text-slate-800">{index + 1}. {q.text}</p>
                            {q.image_data_url && <img src={q.image_data_url} alt="Question" className="my-3 rounded-lg border max-w-sm" />}
                            <div className="mt-4 pt-4 border-t border-dashed">
                                <p>
                                    <span className="font-semibold text-sm text-slate-500">{t('yourAnswer', lang)}:</span>
                                    <span className="ml-2 text-slate-700">{studentAnswer || <span className="italic text-slate-400">{t('notAttempted', lang)}</span>}</span>
                                </p>
                                {q.answer && !correct && (
                                     <p className="mt-2">
                                        <span className="font-semibold text-sm text-green-700">{t('correctAnswer', lang)}</span>
                                        <span className="ml-2 text-green-800">{q.answer}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default TestResults;