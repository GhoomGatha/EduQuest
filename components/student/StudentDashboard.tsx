
import React, { useMemo, useState, useEffect } from 'react';
import { Paper, TestAttempt, PracticeSuggestion, QuestionSource, Semester, Question, Difficulty } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../utils/localization';
import { suggestPracticeSetsAI, generateQuestionsAI } from '../../services/geminiService';
import LoadingSpinner from '../LoadingSpinner';

interface StudentDashboardProps {
    papers: Paper[];
    attempts: TestAttempt[];
    lang: 'en' | 'bn' | 'hi';
    onStartTest: (paper: Paper) => void;
    onViewResult: (attempt: TestAttempt) => void;
    userApiKey?: string;
    userOpenApiKey?: string;
}

const RecommendationCard: React.FC<{ attempt: TestAttempt, lang: 'en' | 'bn' | 'hi' }> = ({ attempt, lang }) => {
    if (!attempt.analysis || attempt.analysis.weaknesses.length === 0) {
        return null;
    }

    return (
        <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white p-5 rounded-xl shadow-lg">
            <h3 className="font-bold text-lg mb-2 flex items-center">
                <span className="text-2xl mr-2">💡</span>
                {t('recommendations', lang)}
            </h3>
            <p className="text-sm text-indigo-100 mb-3">{t('basedOnLastTest', lang)}</p>
            <ul className="space-y-1 list-disc list-inside">
                {attempt.analysis.weaknesses.map((item, index) => (
                    <li key={index} className="font-medium">{item}</li>
                ))}
            </ul>
        </div>
    );
};

const StudentDashboard: React.FC<StudentDashboardProps> = ({ papers, attempts, lang, onStartTest, onViewResult, userApiKey, userOpenApiKey }) => {
    const { profile } = useAuth();
    const [suggestions, setSuggestions] = useState<PracticeSuggestion[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(true);
    const [generatingPractice, setGeneratingPractice] = useState<string | null>(null);

    useEffect(() => {
        const fetchSuggestions = async () => {
            const analyzedAttempts = attempts.filter(a => a.analysis);
            if (analyzedAttempts.length > 0) {
                try {
                    const classNum = analyzedAttempts[0].class || 10;
                    const result = await suggestPracticeSetsAI(analyzedAttempts, classNum, lang, userApiKey, userOpenApiKey);
                    setSuggestions(result);
                } catch (error) {
                    console.error("Failed to fetch practice suggestions:", error);
                }
            }
            setLoadingSuggestions(false);
        };
        
        // Only run if there are attempts, to avoid unnecessary API calls
        if (attempts.length > 0) {
          fetchSuggestions();
        } else {
          setLoadingSuggestions(false);
        }
    }, [attempts, lang, userApiKey, userOpenApiKey]);
    
    const handleStartSuggestedPractice = async (suggestion: PracticeSuggestion) => {
        setGeneratingPractice(suggestion.topic);
        try {
            const { generatedQuestions } = await generateQuestionsAI({
                class: profile?.role ? 10 : 0, // Placeholder class
                chapter: suggestion.chapter,
                keywords: suggestion.topic,
                marks: 2,
                difficulty: 'Moderate',
                count: 5,
                generateAnswer: true,
                wbbseSyllabusOnly: true,
                lang: lang
            }, [], userApiKey, userOpenApiKey);
            
            const newQuestions: Question[] = generatedQuestions.map((gq, i): Question => ({
                id: `gen-sugg-${Date.now()}-${i}`,
                text: gq.text!,
                answer: gq.answer,
                marks: 2,
                difficulty: Difficulty.Moderate,
                class: profile?.role ? 10 : 0,
                chapter: suggestion.chapter,
                source: QuestionSource.Generated,
                year: new Date().getFullYear(),
                semester: Semester.First,
                tags: [suggestion.topic],
                used_in: []
            }));

            if (newQuestions.length > 0) {
                const practicePaper: Paper = {
                    id: `suggested-practice-${Date.now()}`,
                    title: `Practice: ${suggestion.topic}`,
                    year: new Date().getFullYear(),
                    class: profile?.role ? 10 : 0,
                    semester: Semester.First,
                    source: QuestionSource.Generated,
                    questions: newQuestions,
                    created_at: new Date().toISOString(),
                };
                onStartTest(practicePaper);
            } else {
                 console.error("AI did not return any questions for the suggestion.");
            }

        } catch (error) {
            console.error("Failed to generate suggested practice test", error);
        } finally {
            setGeneratingPractice(null);
        }
    };


    const availablePapers = papers.filter(p => p.questions.length > 0);
    const recentAttempts = attempts.slice(0, 5);

    const latestAnalyzedAttempt = useMemo(() => {
        return attempts.find(a => !!a.analysis);
    }, [attempts]);

    return (
        <div className="p-4 sm:p-6 space-y-8">
            {generatingPractice && <LoadingSpinner message={`Generating practice set for ${generatingPractice}...`} />}
            <header className="space-y-1">
                <h1 className="text-3xl font-bold font-serif-display text-slate-800">
                    {t('welcomeStudent', lang).replace('{name}', profile?.full_name?.split(' ')[0] || '')}
                </h1>
                <p className="text-slate-500">Ready to test your knowledge?</p>
            </header>

            {!loadingSuggestions && suggestions.length > 0 && (
                <section>
                    <h2 className="text-xl font-bold font-serif-display text-slate-700 mb-4">Suggested Practice</h2>
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {suggestions.map((s, i) => (
                            <div key={i} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                                <h3 className="font-bold text-slate-800 flex-grow">{s.topic}</h3>
                                <p className="text-sm font-medium text-slate-500">{s.chapter}</p>
                                <p className="text-sm text-slate-600 mt-2 flex-grow">{s.reason}</p>
                                <button
                                    onClick={() => handleStartSuggestedPractice(s)}
                                    className="mt-4 w-full px-4 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 shadow-sm transition-all"
                                >
                                    Start Practice (5 Qs)
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {latestAnalyzedAttempt && suggestions.length === 0 && (
                <section>
                    <RecommendationCard attempt={latestAnalyzedAttempt} lang={lang} />
                </section>
            )}

            <section>
                <h2 className="text-xl font-bold font-serif-display text-slate-700 mb-4">{t('availableTests', lang)}</h2>
                {availablePapers.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {availablePapers.map(paper => (
                            <div key={paper.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                                <h3 className="font-bold text-slate-800 flex-grow">{paper.title}</h3>
                                <p className="text-sm text-slate-500 mt-1">{paper.questions.length} Questions</p>
                                <button
                                    onClick={() => onStartTest(paper)}
                                    className="mt-4 w-full px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all"
                                >
                                    {t('startTest', lang)}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <p>{t('noAvailableTests', lang)}</p>
                    </div>
                )}
            </section>

            <section>
                <h2 className="text-xl font-bold font-serif-display text-slate-700 mb-4">{t('recentAttempts', lang)}</h2>
                 {recentAttempts.length > 0 ? (
                    <div className="space-y-3">
                        {recentAttempts.map(attempt => (
                            <div key={attempt.paperId + attempt.completedAt} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between gap-4">
                                <div className="flex-grow">
                                    <h3 className="font-bold text-slate-800">{attempt.paperTitle}</h3>
                                    <p className="text-sm text-slate-500 mt-1">
                                        {t('scoreLabel', lang)
                                            .replace('{score}', attempt.score.toString())
                                            .replace('{total}', attempt.totalMarks.toString())
                                        } &middot; {new Date(attempt.completedAt).toLocaleString()}
                                    </p>
                                </div>
                                <button
                                    onClick={() => onViewResult(attempt)}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                    {t('viewResults', lang)}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <p>{t('noAttempts', lang)}</p>
                    </div>
                 )}
            </section>
        </div>
    );
};

export default StudentDashboard;