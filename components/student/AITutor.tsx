import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Language, TutorSession } from '../../types';
import { t } from '../../utils/localization';
import { answerDoubtAI } from '../../services/geminiService';
import { loadScript } from '../../utils/scriptLoader';
import { getBengaliFontBase64, getDevanagariFontBase64, getKannadaFontBase64 } from '../../utils/fontData';
import Modal from '../Modal';

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


interface AITutorProps {
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    userApiKey?: string;
    userOpenApiKey?: string;
    sessions: TutorSession[];
    onSaveResponse: (queryText: string, queryImageUrl: string | null, responseText: string, responseImageUrl: string | undefined, tutorClass: number) => void;
    onDeleteSession: (sessionId: string) => void;
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
        <h2 ref={ref} className="text-xl font-bold font-serif-display text-slate-800 mb-4">
            <span className={`inline-block mr-2 text-2xl ${isIntersecting ? animation : ''}`}>{emoji}</span>
            {title}
        </h2>
    );
};

const AITutor: React.FC<AITutorProps> = ({ lang, showToast, userApiKey, userOpenApiKey, sessions, onSaveResponse, onDeleteSession }) => {
    const [query, setQuery] = useState('');
    const [image, setImage] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [previewResponse, setPreviewResponse] = useState<{ text: string; imageUrl?: string } | null>(null);
    const [viewingSession, setViewingSession] = useState<TutorSession | null>(null);
    const [newlyAddedSessionId, setNewlyAddedSessionId] = useState<string | null>(null);
    const prevSessionCount = useRef(sessions.length);
    const [openYears, setOpenYears] = useState<Set<string>>(new Set([new Date().getFullYear().toString()]));

    useEffect(() => {
        if (sessions.length > prevSessionCount.current) {
            const newSessionId = sessions[0].id;
            setNewlyAddedSessionId(newSessionId);
    
            const timer = setTimeout(() => {
                setNewlyAddedSessionId(null);
            }, 3000); // highlight duration
    
            return () => clearTimeout(timer);
        }
        prevSessionCount.current = sessions.length;
    }, [sessions]);

    const toggleYear = (year: string) => {
        setOpenYears(prevOpenYears => {
            const newSet = new Set(prevOpenYears);
            if (newSet.has(year)) {
                newSet.delete(year);
            } else {
                newSet.add(year);
            }
            return newSet;
        });
    };

    const groupedSessions = useMemo(() => {
        if (!sessions || sessions.length === 0) {
            return { recent: [], older: [] };
        }
    
        const recentGroups: { [key: string]: TutorSession[] } = {
            "Today": [],
            "Yesterday": [],
            "Previous 7 Days": [],
        };
        const olderGroupsByYear: { [year: string]: { [month: string]: TutorSession[] } } = {};
    
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
        sessions.forEach(session => {
            const sessionDate = new Date(session.created_at);
            const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());
    
            if (sessionDay.getTime() === today.getTime()) {
                recentGroups["Today"].push(session);
            } else if (sessionDay.getTime() === yesterday.getTime()) {
                recentGroups["Yesterday"].push(session);
            } else if (sessionDay > sevenDaysAgo) {
                recentGroups["Previous 7 Days"].push(session);
            } else {
                const year = sessionDate.getFullYear().toString();
                const month = sessionDate.toLocaleString(lang, { month: 'long' });
    
                if (!olderGroupsByYear[year]) {
                    olderGroupsByYear[year] = {};
                }
                if (!olderGroupsByYear[year][month]) {
                    olderGroupsByYear[year][month] = [];
                }
                olderGroupsByYear[year][month].push(session);
            }
        });
        
        const recent = Object.entries(recentGroups)
            .filter(([, sessions]) => sessions.length > 0)
            .map(([title, sessions]) => ({ title, sessions }));
            
        const older = Object.keys(olderGroupsByYear)
            .sort((a, b) => parseInt(b) - parseInt(a)) // Sort years descending
            .map(year => {
                const months = olderGroupsByYear[year];
                const sortedMonths = Object.keys(months)
                    .sort((a, b) => {
                        const dateA = new Date(`01 ${a} ${year}`);
                        const dateB = new Date(`01 ${b} ${year}`);
                        return dateB.getTime() - dateA.getTime();
                    })
                    .map(month => ({
                        month,
                        sessions: months[month]
                    }));
                return {
                    year,
                    months: sortedMonths
                };
            });
    
        return { recent, older };
    }, [sessions, lang]);

    const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
    const labelStyles = "block text-sm font-semibold text-slate-600 mb-1";

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result as string);
                if (e.target) e.target.value = '';
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleAskTutor = async () => {
        if (!query && !image) return;
        setIsLoading(true);
        try {
            const tutorClass = 10; // Default class, no longer selectable by user
            const { text: aiResponse, imageUrl: aiImageUrl } = await answerDoubtAI(tutorClass, lang, query, image || undefined, userApiKey, userOpenApiKey);
            if (aiResponse) {
                setPreviewResponse({ text: aiResponse, imageUrl: aiImageUrl });
                onSaveResponse(query, image, aiResponse, aiImageUrl, tutorClass);
                setQuery('');
                setImage(null);
            } else {
                showToast("AI returned an empty response.", "error");
            }
        } catch(e) {
            showToast("AI Tutor is currently unavailable.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = (sessionId: string) => {
        if (window.confirm("Are you sure you want to delete this session? This action cannot be undone.")) {
            onDeleteSession(sessionId);
        }
    };

    const handleShare = async (text: string, imageUrl?: string) => {
        const shareData: ShareData = {
            title: 'EduQuest AI Tutor Response',
            text: text,
        };
    
        if (navigator.share) {
            if (imageUrl) {
                try {
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const file = new File([blob], 'ai-tutor-image.png', { type: blob.type });
                    
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            ...shareData,
                            files: [file],
                        });
                        showToast("Shared successfully!", "success");
                        return;
                    }
                } catch (error) {
                    console.error("Error sharing image, falling back to text only:", error);
                }
            }
            
            try {
                await navigator.share(shareData);
                showToast("Shared successfully!", "success");
            } catch (error: any) {
                if (error.name !== 'AbortError') {
                  console.error("Error sharing:", error);
                  showToast("Could not share.", "error");
                }
            }
    
        } else {
            try {
                let textToCopy = text;
                if (imageUrl) {
                    textToCopy += "\n\n[An image was included in the AI's response.]";
                }
                await navigator.clipboard.writeText(textToCopy);
                showToast("Response copied to clipboard!", "success");
            } catch (error) {
                console.error("Failed to copy to clipboard:", error);
                showToast("Could not copy response.", "error");
            }
        }
    };
    
    const handleExport = async (format: 'pdf' | 'txt' | 'xlsx' | 'word') => {
        if (!viewingSession) return;
        const { query_text, response_text, created_at } = viewingSession;
        const title = `ai_tutor_session_${new Date(created_at).toISOString().split('T')[0]}`;

        try {
            if (format === 'txt') {
                const content = `Query:\n${query_text || 'Image Query'}\n\n---\n\nResponse:\n${response_text}`;
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
                const data = [{ Query: query_text || 'Image Query', Response: response_text }];
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "AI Tutor Session");
                XLSX.writeFile(wb, `${title}.xlsx`);
            } else if (format === 'word') {
                 await loadScript("https://cdn.jsdelivr.net/npm/marked/marked.min.js");
                 if (!window.marked) throw new Error("Marked.js library not loaded.");
                 const htmlContent = `<html><head><meta charset="UTF-8"></head><body><h1>AI Tutor Session</h1><h2>Query</h2><p>${query_text || 'Image Query'}</p><hr/><h2>Response</h2>${window.marked.parse(response_text)}</body></html>`;
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
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
                let fontName = 'helvetica';
                if (lang === 'bn') {
                    const fontData = await getBengaliFontBase64();
                    if (fontData) { doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData); doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal'); fontName = 'NotoSansBengali'; }
                } else if (lang === 'hi') {
                    const fontData = await getDevanagariFontBase64();
                    if (fontData) { doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData); doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal'); fontName = 'NotoSansDevanagari'; }
                } else if (lang === 'ka') {
                    const fontData = await getKannadaFontBase64();
                    if (fontData) { doc.addFileToVFS('NotoSansKannada-Regular.ttf', fontData); doc.addFont('NotoSansKannada-Regular.ttf', 'NotoSansKannada', 'normal'); fontName = 'NotoSansKannada'; }
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
                
                const addWrappedText = (text: string, size: number, style: string, spacing: number) => {
                    doc.setFontSize(size);
                    doc.setFont(fontName, style);
                    const lines = doc.splitTextToSize(text, maxLineWidth);
                    checkPageBreak(lines.length * (size / 2.5) + spacing);
                    lines.forEach((line: string) => {
                        if (y + (size / 2.5) > pageHeight - margin) { doc.addPage(); y = margin; }
                        doc.text(line, margin, y);
                        y += (size / 2.5);
                    });
                    y += spacing;
                };

                const addImageToPdf = async (imageUrl: string, yPos: number): Promise<number> => {
                    try {
                        let imageData = imageUrl;
                        if (!imageUrl.startsWith('data:')) {
                            const response = await fetch(imageUrl);
                            const blob = await response.blob();
                            imageData = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result as string);
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });
                        }
                        
                        const imgProps = doc.getImageProperties(imageData);
                        const imgWidth = Math.min(maxLineWidth, 120);
                        const imgHeight = (imgProps.height * imgWidth) / imgProps.width;
                        checkPageBreak(imgHeight + 5);
                        doc.addImage(imageData, 'PNG', margin, yPos, imgWidth, imgHeight);
                        return yPos + imgHeight + 5;
                    } catch (e) {
                        console.error("Error adding image to PDF:", e);
                        addWrappedText("[Error loading image]", 10, 'italic', 5);
                        return yPos + 10;
                    }
                };
    
                addWrappedText("AI Tutor Session", 16, 'bold', 10);
                addWrappedText(`Query from ${new Date(created_at).toLocaleString()}`, 10, 'italic', 5);
                
                if (viewingSession.query_image_url) {
                    y = await addImageToPdf(viewingSession.query_image_url, y);
                }
                if (viewingSession.query_text) {
                    addWrappedText(viewingSession.query_text, 12, 'normal', 10);
                }
                
                addWrappedText("AI Response:", 14, 'bold', 5);
    
                if (viewingSession.response_image_url) {
                    y = await addImageToPdf(viewingSession.response_image_url, y);
                }
                addWrappedText(response_text, 12, 'normal', 5);
    
                doc.save(`${title}.pdf`);
            }
            showToast("Export successful!", "success");
        } catch (e) {
            console.error("Export failed", e);
            showToast("Export failed.", 'error');
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <AnimatedHeader emoji="✨" animation="animate-sparkle" title={t('newSession', lang)} />
                <p className="text-sm text-slate-500 -mt-4 mb-4">{t('aiTutorSubtitle', lang)}</p>
                <div className="space-y-4">
                    <div>
                        <label className={labelStyles}>{t('typeYourQuestion', lang)}</label>
                        <textarea value={query} onChange={e => setQuery(e.target.value)} rows={5} className={inputStyles} placeholder="..." />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">{t('orUploadImage', lang)}</label>
                        <input type="file" onChange={handleImageChange} accept="image/*" className="mt-1 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
                        {image && (
                            <div className="relative w-fit mt-2">
                                <img src={image} alt="Doubt preview" className="rounded-lg max-h-40 w-auto border" />
                                <button onClick={() => setImage(null)} className="absolute top-1 right-1 bg-white/70 rounded-full p-0.5 leading-none text-xl font-bold text-red-500 hover:bg-red-100">&times;</button>
                            </div>
                        )}
                    </div>
                    <div className="flex justify-end pt-2">
                        <button onClick={handleAskTutor} disabled={isLoading || (!query && !image)} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm disabled:bg-indigo-300">
                           {isLoading ? <div className="flex items-center"><div className="w-4 h-4 border-2 border-t-transparent border-white rounded-full animate-spin mr-2"></div>{t('gettingExplanation', lang)}</div> : `🧠 ${t('getExplanation', lang)}`}
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <AnimatedHeader emoji="📜" animation="animate-bobbing" title={t('tutorHistory', lang)} />
                <div className="max-h-[70vh] overflow-y-auto">
                    {sessions.length > 0 ? (
                        <>
                            {groupedSessions.recent.map(group => (
                                <div key={group.title}>
                                    <h3 className="text-sm font-bold text-slate-500 bg-slate-100 p-2 sticky top-0 z-10">
                                        {group.title}
                                    </h3>
                                    <div className="space-y-2 pt-2">
                                        {group.sessions.map(s => (
                                            <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-all duration-1000 ${s.id === newlyAddedSessionId ? 'bg-cyan-50' : ''}`}>
                                                <div className="flex-grow min-w-0">
                                                    <p className="font-semibold text-sm text-slate-700 truncate">{s.query_text || 'Image Query'}</p>
                                                    <p className="text-xs text-slate-500">{new Date(s.created_at).toLocaleString()}</p>
                                                </div>
                                                <div className="flex-shrink-0 space-x-3 ml-4">
                                                    <button onClick={() => setViewingSession(s)} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">{t('view', lang)}</button>
                                                    <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:text-red-800 text-sm font-semibold">{t('delete', lang)}</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                            {groupedSessions.older.map(({ year, months }) => (
                                <div key={year} className="border-t">
                                    <button 
                                        onClick={() => toggleYear(year)}
                                        className="w-full flex justify-between items-center text-left text-sm font-bold text-slate-600 bg-slate-100 p-2 hover:bg-slate-200 transition-colors"
                                    >
                                        <span>{year}</span>
                                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${openYears.has(year) ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    {openYears.has(year) && (
                                        <div className="pl-4">
                                            {months.map(({ month, sessions: monthSessions }) => (
                                                <div key={month}>
                                                    <h4 className="text-xs font-semibold text-slate-500 py-2">{month}</h4>
                                                    <div className="space-y-2 pb-2">
                                                        {monthSessions.map(s => (
                                                            <div key={s.id} className={`flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-all duration-1000 ${s.id === newlyAddedSessionId ? 'bg-cyan-50' : ''}`}>
                                                                <div className="flex-grow min-w-0">
                                                                    <p className="font-semibold text-sm text-slate-700 truncate">{s.query_text || 'Image Query'}</p>
                                                                    <p className="text-xs text-slate-500">{new Date(s.created_at).toLocaleString()}</p>
                                                                </div>
                                                                <div className="flex-shrink-0 space-x-3 ml-4">
                                                                    <button onClick={() => setViewingSession(s)} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">{t('view', lang)}</button>
                                                                    <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:text-red-800 text-sm font-semibold">{t('delete', lang)}</button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </>
                    ) : (
                        <p className="text-center text-sm text-slate-500 p-4">{t('noTutorHistory', lang)}</p>
                    )}
                </div>
            </div>

            <Modal isOpen={!!previewResponse} onClose={() => setPreviewResponse(null)} title={t('tutorResponse', lang)}>
                {previewResponse && (
                     <>
                        <div className="max-h-[60vh] overflow-y-auto pr-2 space-y-4">
                            {previewResponse.imageUrl && <img src={previewResponse.imageUrl} alt="AI generated diagram" className="max-w-full h-auto rounded-lg border my-4" />}
                            <MarkdownRenderer content={previewResponse.text} />
                        </div>
                        <div className="flex justify-end pt-4 mt-4 border-t border-slate-200">
                            <button
                                onClick={() => handleShare(previewResponse.text, previewResponse.imageUrl)}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" /></svg>
                                Share
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            <Modal isOpen={!!viewingSession} onClose={() => setViewingSession(null)} title="Conversation Details">
                {viewingSession && (
                    <>
                        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-2">
                           <div>
                                <h3 className="font-bold text-slate-700">{t('yourQuery', lang)}</h3>
                                {viewingSession.query_image_url && <img src={viewingSession.query_image_url} alt="Query" className="mt-2 rounded-lg max-h-48 w-auto border" />}
                                <p className="mt-2 text-slate-600 bg-slate-50 p-3 rounded-md">{viewingSession.query_text || 'Image-based query'}</p>
                           </div>
                           <div>
                                <h3 className="font-bold text-slate-700 mt-4">{t('tutorResponse', lang)}</h3>
                                <div className="mt-2 bg-slate-50 p-3 rounded-md">
                                    {viewingSession.response_image_url && <img src={viewingSession.response_image_url} alt="AI response diagram" className="max-w-full h-auto rounded-lg border my-4" />}
                                    <MarkdownRenderer content={viewingSession.response_text} />
                                </div>
                           </div>
                        </div>
                         <div className="flex flex-wrap justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
                             <button
                                onClick={() => handleShare(viewingSession.response_text, viewingSession.response_image_url)}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" /></svg>
                                Share
                            </button>
                             <button onClick={() => handleExport('txt')} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg text-sm">{t('exportTXT', lang)}</button>
                             <button onClick={() => handleExport('word')} className="px-4 py-2 bg-blue-700 text-white font-semibold rounded-lg text-sm">{t('exportWord', lang)}</button>
                            <button onClick={() => handleExport('xlsx')} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm">{t('exportXLSX', lang)}</button>
                            <button onClick={() => handleExport('pdf')} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg text-sm">{t('exportPDF', lang)}</button>
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default AITutor;
