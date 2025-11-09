
import React, { useState, useEffect } from 'react';
import { Paper, Question, StudentAnswer, TestAttempt, QuestionSource } from '../../types';
import { t } from '../../utils/localization';
import Modal from '../Modal';

interface PracticeTestProps {
    paper: Paper;
    lang: 'en' | 'bn' | 'hi';
    onComplete: (attempt: TestAttempt) => void;
    onQuit: () => void;
}

const PracticeTest: React.FC<PracticeTestProps> = ({ paper, lang, onComplete, onQuit }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [studentAnswers, setStudentAnswers] = useState<Record<string, string>>({});
    const [timeLeft, setTimeLeft] = useState(() => {
        if (paper.time_limit_minutes && paper.time_limit_minutes > 0) {
            return paper.time_limit_minutes * 60;
        }
        return paper.questions.length * 90; // Default time
    });
    const hasTimeLimit = paper.time_limit_minutes !== undefined && paper.time_limit_minutes > 0;
    const [isQuitModalOpen, setQuitModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const currentQuestion = paper.questions[currentQuestionIndex];

    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
    
        let score = 0;
        const totalMarks = paper.questions.reduce((acc, q) => acc + q.marks, 0);
        const finalAnswers: StudentAnswer[] = [];
        
        const isPractice = paper.id.startsWith('practice-') || paper.id.startsWith('suggested-practice-') || paper.id.startsWith('mcq-') || paper.id.startsWith('scan-');
    
        paper.questions.forEach(q => {
            const studentAnswer = studentAnswers[q.id]?.trim() || '';
            finalAnswers.push({ questionId: q.id, answer: studentAnswer });
            
            if (!isPractice) {
                const correctAnswer = q.answer?.trim() || '';
                if (correctAnswer && studentAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
                    score += q.marks;
                }
            }
        });
    
        const attempt: TestAttempt = {
            paperId: paper.id,
            paperTitle: paper.title,
            studentAnswers: finalAnswers,
            score: isPractice ? -1 : score,
            totalMarks: isPractice ? -1 : totalMarks,
            completedAt: new Date().toISOString(),
            class: paper.class,
            year: paper.year,
            semester: paper.semester,
            paper: paper,
        };
        
        await (onComplete(attempt) as unknown as Promise<void>);
        
        setIsSubmitting(false);
    };

    useEffect(() => {
        if (!hasTimeLimit) return; // Don't start timer if no time limit

        const timer = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    handleSubmit();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasTimeLimit]);

    const handleAnswerChange = (questionId: string, answer: string) => {
        setStudentAnswers(prev => ({ ...prev, [questionId]: answer }));
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };
    
    const progress = ((currentQuestionIndex + 1) / paper.questions.length) * 100;
    
    const getOptionsForMCQ = (text: string): string[] => {
        const parts = text.split(/A\)|B\)|C\)|D\)/);
        if (parts.length >= 5) {
            return parts.slice(1).map(s => s.trim().replace(/^[.)]?\s*/, ''));
        }
        return [];
    };

    const getQuestionTextOnly = (text: string): string => {
        return text.split(/A\)|B\)|C\)|D\)/)[0].trim();
    }

    const getQuestionType = (question: Question): string => {
        if (getOptionsForMCQ(question.text).length === 4 && question.answer && ['A', 'B', 'C', 'D'].includes(question.answer.toUpperCase())) return 'Multiple Choice';
        if (question.text.includes('____')) return 'Fill in the Blanks';
        if (question.answer?.toLowerCase() === 'true' || question.answer?.toLowerCase() === 'false') return 'True/False';
        return 'Short Answer';
    }

    const renderAnswerInput = (question: Question) => {
        const questionType = getQuestionType(question);
        const studentAnswer = studentAnswers[question.id] || '';

        switch(questionType) {
            case 'Multiple Choice':
                const options = getOptionsForMCQ(question.text);
                const labels = ['A', 'B', 'C', 'D'];
                return (
                    <div className="space-y-3">
                        {options.map((option, index) => (
                            <label key={index} className="flex items-center p-4 bg-slate-100 rounded-lg cursor-pointer border-2 border-transparent has-[:checked]:bg-indigo-50 has-[:checked]:border-indigo-400 transition-all">
                                <input
                                    type="radio"
                                    name={question.id}
                                    value={labels[index]}
                                    checked={studentAnswer === labels[index]}
                                    onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                                    className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 border-slate-300"
                                />
                                <span className="ml-4 text-slate-700">{labels[index]}) {option}</span>
                            </label>
                        ))}
                    </div>
                );
            default:
                return (
                    <textarea
                        value={studentAnswer}
                        onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                        rows={5}
                        className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-400 bg-white text-slate-800"
                        placeholder="Type your answer here..."
                    />
                );
        }
    }

    if (!currentQuestion) {
        return (
            <div className="fixed inset-0 bg-slate-50 flex items-center justify-center">
                <p>Loading test...</p>
            </div>
        );
    }

    return (
       <>
        <div className="fixed inset-0 bg-slate-50 flex flex-col p-4">
            <header className="flex-shrink-0">
                <div className="flex justify-between items-center mb-2">
                    <h1 className="text-lg font-bold text-slate-800 truncate pr-4">{paper.title}</h1>
                    {hasTimeLimit ? (
                        <div className="font-semibold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full text-sm">
                           {t('timeRemaining', lang).replace('{time}', formatTime(timeLeft))}
                        </div>
                    ) : (
                        <div className="font-semibold text-green-600 bg-green-100 px-3 py-1 rounded-full text-sm">
                           No Time Limit
                        </div>
                    )}
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                    <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.3s ease' }}></div>
                </div>
                 <p className="text-center text-sm font-medium text-slate-500 mt-2">
                    {t('questionOf', lang).replace('{current}', String(currentQuestionIndex + 1)).replace('{total}', String(paper.questions.length))}
                </p>
            </header>

            <main className="flex-grow overflow-y-auto py-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-start">
                        <div className="prose max-w-none prose-slate">
                            <p className="text-lg font-semibold">
                                {getQuestionType(currentQuestion) === 'Multiple Choice' ? getQuestionTextOnly(currentQuestion.text) : currentQuestion.text}
                            </p>
                        </div>
                         <span className={`text-xs font-semibold px-2 py-1 rounded-full ${currentQuestion.source === QuestionSource.Generated ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                            {t(currentQuestion.source, lang)}
                        </span>
                    </div>

                    {currentQuestion.image_data_url && (
                         <img src={currentQuestion.image_data_url} alt="Question" className="max-w-full h-auto my-4 rounded-lg border" />
                    )}
                    <div className="mt-6">
                        {renderAnswerInput(currentQuestion)}
                    </div>
                </div>
            </main>

            <footer className="flex-shrink-0 border-t border-slate-200 pt-4">
                <div className="flex justify-between items-center">
                    <button 
                        onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                        disabled={currentQuestionIndex === 0}
                        className="px-6 py-3 font-semibold text-slate-700 bg-slate-200 rounded-lg disabled:opacity-50"
                    >
                        {t('previous', lang)}
                    </button>
                    <button 
                         onClick={() => setQuitModalOpen(true)}
                         className="px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg"
                    >{t('quitTest', lang)}</button>
                    {currentQuestionIndex === paper.questions.length - 1 ? (
                        <button 
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="px-6 py-3 font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-green-400"
                        >
                           {isSubmitting ? 'Submitting...' : t('submitTest', lang)}
                        </button>
                    ) : (
                        <button 
                            onClick={() => setCurrentQuestionIndex(prev => Math.min(paper.questions.length - 1, prev + 1))}
                            className="px-6 py-3 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                        >
                            {t('next', lang)}
                        </button>
                    )}
                </div>
            </footer>
        </div>
        <Modal isOpen={isQuitModalOpen} onClose={() => setQuitModalOpen(false)} title={t('quitTest', lang)}>
            <p className="text-slate-600 mb-6">{t('quitConfirmation', lang)}</p>
            <div className="flex justify-end space-x-3">
                <button onClick={() => setQuitModalOpen(false)} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium transition-colors">{t('cancel', lang)}</button>
                <button onClick={onQuit} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold shadow-sm transition-all">{t('quitTest', lang)}</button>
            </div>
        </Modal>
       </>
    );
};

export default PracticeTest;
