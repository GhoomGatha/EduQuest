import React, { useState, useRef, useEffect } from 'react';
import { Language } from '../types';
import { t } from '../utils/localization';
import { answerTeacherDoubtAI } from '../services/geminiService';
import { CLASSES } from '../constants';
import { loadScript } from '../utils/scriptLoader';
import { getBengaliFontBase64, getDevanagariFontBase64 } from '../utils/fontData';

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

interface AITutorProps {
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    userApiKey?: string;
    userOpenApiKey?: string;
    onSaveResponse: (query: string, response: string, tutorClass: number) => void;
}

const AITutor: React.FC<AITutorProps> = ({ lang, showToast, userApiKey, userOpenApiKey, onSaveResponse }) => {
    const [query, setQuery] = useState('');
    const [image, setImage] = useState<string | null>(null);
    const [tutorClass, setTutorClass] = useState<number>(10);
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
    const labelStyles = "block text-sm font-semibold text-slate-600 mb-1";
    
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => setImage(reader.result as string);
            reader.readAsDataURL(file);
        }
    };
    
    const handleAskTutor = async () => {
        if (!query && !image) return;
        setIsLoading(true);
        setResponse('');
        try {
            const aiResponse = await answerTeacherDoubtAI(tutorClass, lang, query, image || undefined, userApiKey, userOpenApiKey);
            setResponse(aiResponse);
            if (aiResponse) {
                onSaveResponse(query || 'Image-based query', aiResponse, tutorClass);
            }
        } catch(e) {
            showToast("AI Tutor is currently unavailable.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportPDF = async () => {
        if (!response) return;

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
        if (lang === 'bn') {
            const fontData = await getBengaliFontBase64();
            if (fontData) {
                doc.addFileToVFS('NotoSansBengali-Regular.ttf', fontData);
                doc.addFont('NotoSansBengali-Regular.ttf', 'NotoSansBengali', 'normal');
                fontName = 'NotoSansBengali';
            } else {
                showToast('Could not load Bengali font for PDF.', 'error');
            }
        } else if (lang === 'hi') {
            const fontData = await getDevanagariFontBase64();
            if (fontData) {
                doc.addFileToVFS('NotoSansDevanagari-Regular.ttf', fontData);
                doc.addFont('NotoSansDevanagari-Regular.ttf', 'NotoSansDevanagari', 'normal');
                fontName = 'NotoSansDevanagari';
            } else {
                showToast('Could not load Hindi font for PDF.', 'error');
            }
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
        const title = "AI Tutor Response";
        const titleLines = doc.splitTextToSize(title, maxLineWidth);
        doc.text(titleLines, pageWidth / 2, y, { align: 'center' });
        y += titleLines.length * 6 + 8;

        if(query) {
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            const queryTitle = "Your Query:";
            doc.text(queryTitle, margin, y);
            y += 8;

            doc.setFontSize(10);
            doc.setFont(fontName, 'normal');
            const queryLines = doc.splitTextToSize(query, maxLineWidth);
            const queryTextHeight = queryLines.length * 5;
            checkPageBreak(queryTextHeight + 3);
            doc.text(queryLines, margin, y);
            y += queryTextHeight + 8;
        }

        doc.setFontSize(12);
        doc.setFont(fontName, 'bold');
        const responseTitle = "AI Response:";
        doc.text(responseTitle, margin, y);
        y += 8;

        doc.setFontSize(10);
        doc.setFont(fontName, 'normal');

        const lines = doc.splitTextToSize(response, maxLineWidth);
        lines.forEach((line: string) => {
            const textHeight = 5; // Approximate height for one line
            checkPageBreak(textHeight);
            doc.text(line, margin, y);
            y += textHeight;
        });

        doc.save(`ai_tutor_response.pdf`);
    };

    const handleExportCSV = () => {
        if (!response) return;
        
        const headers = ['Query', 'Response'];
        const data = [{
            'Query': query || 'N/A',
            'Response': response,
        }];

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
        link.setAttribute('download', `ai_tutor_response.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
                <h2 className="text-xl font-bold font-serif-display text-slate-800">{t('tutorForTeachers', lang)}</h2>
                <p className="text-sm text-slate-500">{t('tutorForTeachersSubtitle', lang)}</p>

                <div className="space-y-4 pt-4 border-t">
                    <div>
                        <label className={labelStyles}>{t('class', lang)}</label>
                        <select value={tutorClass} onChange={e => setTutorClass(parseInt(e.target.value))} className={inputStyles}>
                            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelStyles}>{t('yourQuery', lang)}</label>
                        <textarea value={query} onChange={e => setQuery(e.target.value)} rows={5} className={inputStyles} placeholder={t('typeYourQueryHere', lang)} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">{t('orUploadImage', lang)}</label>
                        <input type="file" onChange={handleImageChange} accept="image/*" className="mt-1 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/>
                        {image && <img src={image} alt="Doubt preview" className="mt-2 rounded-lg max-h-40 w-auto border" />}
                    </div>
                    <div className="flex justify-end pt-4">
                        <button onClick={handleAskTutor} disabled={isLoading} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm disabled:bg-indigo-300">
                           {isLoading ? t('gettingExplanation', lang) : `🧠 ${t('getExplanation', lang)}`}
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">{t('tutorResponse', lang)}</h2>
                {isLoading && (
                    <div className="flex-grow flex items-center justify-center">
                        <div className="w-8 h-8 border-4 border-t-indigo-600 border-slate-200 rounded-full animate-spin"></div>
                    </div>
                )}
                {response && (
                    <>
                        <div className="bg-slate-50 p-4 rounded-lg border max-h-[70vh] overflow-y-auto flex-grow">
                            <MarkdownRenderer content={response} />
                        </div>
                        <div className="flex flex-wrap justify-end gap-3 pt-4 mt-4 border-t border-slate-200">
                            <button onClick={handleExportCSV} className="px-5 py-2.5 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportCSV', lang)}</button>
                            <button onClick={handleExportPDF} className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm hover:shadow-md hover:-translate-y-px transition-all">{t('exportPDF', lang)}</button>
                        </div>
                    </>
                )}
                {!isLoading && !response && (
                    <div className="flex-grow flex items-center justify-center text-center text-slate-500">
                        <p>Your explanation will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AITutor;