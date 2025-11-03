import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Paper, TestAttempt, PracticeSuggestion, QuestionSource, Semester, Question, Difficulty, StudyMaterial, Flashcard } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../utils/localization';
import { suggestPracticeSetsAI, generateQuestionsAI } from '../../services/geminiService';
import LoadingSpinner from '../LoadingSpinner';
import { supabase } from '../../services/supabaseClient';
import Modal from '../Modal';
import { loadScript } from '../../utils/scriptLoader';
import { getBengaliFontBase64, getDevanagariFontBase64 } from '../../utils/fontData';

// --- Start of Embedded MarkdownRenderer Component ---
declare global {
    interface Window {
        marked: any;
    }
}
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (containerRef.current && window.marked) {
            containerRef.current.innerHTML = window.marked.parse(content || '');
        } else if (!window.marked) {
            loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js").then(() => {
                 if (containerRef.current) {
                    containerRef.current.innerHTML = window.marked.parse(content || '');
                 }
            });
        }
    }, [content]);
    return <div ref={containerRef} className="prose prose-sm max-w-none prose-slate"></div>;
};
// --- End of Embedded MarkdownRenderer Component ---

const FlashcardViewer: React.FC<{
    flashcards: Flashcard[];
    title: string;
    lang: 'en' | 'bn' | 'hi';
}> = ({ flashcards, title, lang }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const currentCard = flashcards[currentIndex];
    const handleNext = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((p) => (p + 1) % flashcards.length), 250);
    };
    const handlePrev = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((p) => (p - 1 + flashcards.length) % flashcards.length), 250);
    };
    return (
        <div className="flex flex-col items-center">
            <h3 className="text-lg font-bold text-slate-800 mb-4">{title} ({currentIndex + 1}/{flashcards.length})</h3>
            <div className="w-full h-64 [perspective:1000px]" onClick={() => setIsFlipped(!isFlipped)}>
                <div className={`relative w-full h-full [transform-style:preserve-3d] transition-transform duration-500 cursor-pointer ${isFlipped ? '[transform:rotateY(180deg)]' : ''}`}>
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-white border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg"><p className="text-xl font-semibold text-slate-700">{currentCard.question}</p></div>
                    <div className="absolute w-full h-full [backface-visibility:hidden] bg-indigo-100 border-2 border-indigo-300 rounded-lg flex items-center justify-center p-6 text-center shadow-lg [transform:rotateY(180deg)]"><p className="text-lg text-indigo-800">{currentCard.answer}</p></div>
                </div>
            </div>
            <div className="flex justify-between w-full mt-6">
                <button onClick={handlePrev} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg">&larr; {t('previous', lang)}</button>
                <button onClick={handleNext} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg">{t('next', lang)} &rarr;</button>
            </div>
        </div>
    );
};


interface StudentDashboardProps {
    papers: Paper[];
    attempts: TestAttempt[];
    lang: 'en' | 'bn' | 'hi';
    onStartTest: (paper: Paper) => void;
    onViewResult: (attempt: TestAttempt) => void;
    userApiKey?: string;
    userOpenApiKey?: string;
    showToast: (message: string, type?: 'success' | 'error') => void;
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
        <h2 ref={ref} className="text-xl font-bold font-serif-display text-slate-700 mb-4">
            <span className={`inline-block mr-2 text-2xl ${isIntersecting ? animation : ''}`}>{emoji}</span>
            {title}
        </h2>
    );
};

const StudentDashboard: React.FC<StudentDashboardProps> = ({ papers, attempts, lang, onStartTest, onViewResult, userApiKey, userOpenApiKey, showToast }) => {
    const { profile, session } = useAuth();
    const [suggestions, setSuggestions] = useState<PracticeSuggestion[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(true);
    const [generatingPractice, setGeneratingPractice] = useState<string | null>(null);
    const [studyMaterials, setStudyMaterials] = useState<StudyMaterial[]>([]);
    const [loadingMaterials, setLoadingMaterials] = useState(true);
    const [viewingMaterial, setViewingMaterial] = useState<StudyMaterial | null>(null);

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
        
        const fetchStudyMaterials = async () => {
            if (!session?.user) return;
            setLoadingMaterials(true);
            const { data, error } = await supabase
                .from('student_generated_content')
                .select('*')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: false });

            if (error) {
                console.error("Failed to fetch study materials", error);
            } else {
                setStudyMaterials(data as StudyMaterial[]);
            }
            setLoadingMaterials(false);
        };

        if (attempts.length > 0) {
          fetchSuggestions();
        } else {
          setLoadingSuggestions(false);
        }
        fetchStudyMaterials();
    }, [attempts, lang, userApiKey, userOpenApiKey, session]);
    
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

    const handleExportMaterial = async (format: 'pdf' | 'txt' | 'xlsx' | 'word') => {
        if (!viewingMaterial) return;
        
        const title = viewingMaterial.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        
        try {
            if (viewingMaterial.type === 'study_guide') {
                const content = (viewingMaterial.content as any).markdown || '';
                if (format === 'txt') {
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                } else if (format === 'word') {
                     await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js");
                     if (!window.marked) throw new Error("Marked.js library not loaded.");
                     const htmlContent = `<html><head><meta charset="UTF-8"></head><body>${window.marked.parse(content)}</body></html>`;
                     const blob = new Blob([`\ufeff${htmlContent}`], { type: 'application/msword' });
                     const url = URL.createObjectURL(blob);
                     const a = document.createElement('a');
                     a.href = url;
                     a.download = `${title}.doc`;
                     a.click();
                     URL.revokeObjectURL(url);
                } else if (format === 'pdf') {
                    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                    await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js");

                    if (!(window as any).jspdf || !window.marked) {
                        throw new Error("Required libraries (jsPDF, Marked.js) not loaded.");
                    }

                    const { jsPDF } = (window as any).jspdf;
                    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

                    let fontName = 'helvetica';
                    if (lang === 'bn') {
                        const fontData = await getBengaliFontBase64();
                        if (fontData) { doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData); doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal'); fontName = 'NotoSansBengali'; }
                    } else if (lang === 'hi') {
                        const fontData = await getDevanagariFontBase64();
                        if (fontData) { doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData); doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal'); fontName = 'NotoSansDevanagari'; }
                    }
                    doc.setFont(fontName, 'normal');

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
                    const titleLines = doc.splitTextToSize(viewingMaterial.title, maxLineWidth);
                    checkPageBreak(titleLines.length * 6 + 8);
                    doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
                    y += titleLines.length * 6 + 8;
                    
                    doc.setFontSize(10);
                    doc.setFont(fontName, 'normal');

                    const div = document.createElement('div');
                    div.innerHTML = window.marked.parse(content);
                    const textContent = div.innerText;
                    
                    const lines = doc.splitTextToSize(textContent, maxLineWidth);
                    lines.forEach((line: string) => {
                        const textHeight = 5;
                        checkPageBreak(textHeight);
                        doc.text(line, margin, y);
                        y += textHeight;
                    });

                    doc.save(`${title}.pdf`);

                } else if (format === 'xlsx') {
                    await loadScript("https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js");
                    const XLSX = (window as any).XLSX;
                    const ws = XLSX.utils.json_to_sheet([{ "Study Guide Content": content }]);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Study Guide");
                    XLSX.writeFile(wb, `${title}.xlsx`);
                }

            } else if (viewingMaterial.type === 'flashcards') {
                const flashcards = viewingMaterial.content as Flashcard[];
                 if (format === 'txt') {
                    const content = flashcards.map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n---\n\n');
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${title}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                } else if (format === 'xlsx') {
                    await loadScript("https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js");
                    const XLSX = (window as any).XLSX;
                    const ws = XLSX.utils.json_to_sheet(flashcards);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "Flashcards");
                    XLSX.writeFile(wb, `${title}.xlsx`);
                } else if (format === 'word') {
                     let htmlContent = `<html><head><meta charset="UTF-8"></head><body><h1>${viewingMaterial.title}</h1>`;
                     flashcards.forEach(f => {
                         htmlContent += `<p><b>Question:</b> ${f.question}</p><p><b>Answer:</b> ${f.answer}</p><hr/>`;
                     });
                     htmlContent += `</body></html>`;
                     const blob = new Blob([`\ufeff${htmlContent}`], { type: 'application/msword' });
                     const url = URL.createObjectURL(blob);
                     const a = document.createElement('a');
                     a.href = url;
                     a.download = `${title}.doc`;
                     a.click();
                     URL.revokeObjectURL(url);
                } else if (format === 'pdf') {
                    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                    const { jsPDF } = (window as any).jspdf;
                    const doc = new jsPDF();
                    let y = 10;
                    flashcards.forEach(f => {
                        if (y > 280) { doc.addPage(); y = 10; }
                        doc.text(`Q: ${f.question}`, 10, y);
                        y += 7;
                        doc.text(`A: ${f.answer}`, 15, y);
                        y+= 10;
                    });
                    doc.save(`${title}.pdf`);
                }
            }
            showToast("Export successful!", "success");
        } catch (e) {
            console.error("Export failed", e);
            showToast("Export failed.", 'error');
        }
    };


    const availablePapers = papers.filter(p => p.questions.length > 0);
    const recentAttempts = attempts.slice(0, 5);

    const latestAnalyzedAttempt = useMemo(() => {
        return attempts.find(a => !!a.analysis);
    }, [attempts]);

    const renderMaterialContent = () => {
        if (!viewingMaterial) return null;
        if (viewingMaterial.type === 'flashcards') {
            return <FlashcardViewer flashcards={viewingMaterial.content as Flashcard[]} title={viewingMaterial.title} lang={lang} />;
        }
        if (viewingMaterial.type === 'study_guide') {
            return <MarkdownRenderer content={(viewingMaterial.content as any).markdown || ''} />;
        }
        return null;
    };


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
                <AnimatedHeader emoji="📁" animation="animate-bobbing" title="My Study Materials" />
                {loadingMaterials ? <p>Loading materials...</p> : studyMaterials.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {studyMaterials.map(material => (
                            <button key={material.id} onClick={() => setViewingMaterial(material)} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 text-left hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all">
                                <h3 className="font-bold text-slate-800">{material.title}</h3>
                                <p className="text-sm text-slate-500 capitalize">{material.type.replace('_', ' ')}</p>
                                <p className="text-xs text-slate-400 mt-2">{new Date(material.created_at).toLocaleString()}</p>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <p>Any study guides or flashcards you generate will be saved here.</p>
                    </div>
                )}
            </section>

            <section>
                <AnimatedHeader emoji="📝" animation="animate-bobbing" title={t('availableTests', lang)} />
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
                <AnimatedHeader emoji="📊" animation="animate-bobbing" title={t('recentAttempts', lang)} />
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
            <Modal isOpen={!!viewingMaterial} onClose={() => setViewingMaterial(null)} title={viewingMaterial?.title || ''}>
                {viewingMaterial && (
                    <>
                        <div>{renderMaterialContent()}</div>
                        <div className="flex flex-wrap justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
                            <button onClick={() => handleExportMaterial('txt')} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg text-sm">{t('exportTXT', lang)}</button>
                             <button onClick={() => handleExportMaterial('word')} className="px-4 py-2 bg-blue-700 text-white font-semibold rounded-lg text-sm">{t('exportWord', lang)}</button>
                            <button onClick={() => handleExportMaterial('xlsx')} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm">{t('exportXLSX', lang)}</button>
                            <button onClick={() => handleExportMaterial('pdf')} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg text-sm">{t('exportPDF', lang)}</button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default StudentDashboard;