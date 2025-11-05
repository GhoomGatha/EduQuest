import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Question, Difficulty, Language } from '../types';
import { t } from '../utils/localization';
import { CLASSES, MARKS } from '../constants';

interface QuestionBankProps {
  questions: Question[];
  onAddQuestion: () => void;
  onEditQuestion: (question: Question) => void;
  onDeleteQuestion: (id: string) => void;
  lang: Language;
  showToast: (message: string, type?: 'success' | 'error') => void;
  onFileImport: (e: React.ChangeEvent<HTMLInputElement>, fileType: 'pdf' | 'csv' | 'txt' | 'image') => void;
  isProcessingFile: boolean;
}

const QuestionCard: React.FC<{ question: Question; onEdit: () => void; onDelete: () => void; onCopy: () => void; lang: Language }> = ({ question, onEdit, onDelete, onCopy, lang }) => (
    <div className="bg-white p-4 rounded-xl shadow-sm space-y-3 border border-slate-200">
        <p className="text-slate-800">{question.text}</p>
        {question.image_data_url && (
            <div className="flex justify-center p-2 bg-slate-50 rounded-lg">
                <img src={question.image_data_url} alt="Question illustration" className="rounded-md max-w-full h-auto max-h-48 object-contain border" />
            </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
            <span className="bg-indigo-50 text-indigo-700 font-medium px-2.5 py-1 rounded-full">{`${t('class', lang)} ${question.class}`}</span>
            <span className="bg-green-50 text-green-700 font-medium px-2.5 py-1 rounded-full">{`${question.marks} ${t('marks', lang)}`}</span>
            <span className="bg-yellow-50 text-yellow-700 font-medium px-2.5 py-1 rounded-full">{t(question.difficulty, lang)}</span>
            <span className="bg-slate-100 text-slate-700 font-medium px-2.5 py-1 rounded-full">{question.chapter}</span>
        </div>
         {question.tags && question.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
                {question.tags.map(tag => (
                    <span key={tag} className="bg-cyan-50 text-cyan-700 font-medium px-2.5 py-1 rounded-full">{tag}</span>
                ))}
            </div>
        )}
        <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onCopy} className="text-slate-500 hover:text-slate-800 text-sm font-semibold">{t('copy', lang)}</button>
            <button onClick={onEdit} className="text-indigo-600 hover:text-indigo-800 text-sm font-semibold">{t('edit', lang)}</button>
            <button onClick={onDelete} className="text-red-600 hover:text-red-800 text-sm font-semibold">{t('delete', lang)}</button>
        </div>
    </div>
);

type ActionButtonType = 'pdf' | 'csv' | 'txt' | 'image' | 'word' | 'manual';

const ActionButton: React.FC<{
    onClick: () => void,
    disabled: boolean,
    isAnimating: boolean,
    emoji: string,
    label: string,
    gradient: string
}> = ({ onClick, disabled, isAnimating, emoji, label, gradient }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`flex flex-col items-center justify-center p-2 rounded-lg text-white shadow-md transform transition-all duration-300 hover:scale-105 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 w-16 h-16 ${gradient}`}
    >
        <span className={`text-xl ${isAnimating ? 'animate-pulse-once' : ''}`}>{emoji}</span>
        <span className="text-xs font-bold mt-1">{label}</span>
    </button>
);


const QuestionBank: React.FC<QuestionBankProps> = ({ questions, onAddQuestion, onEditQuestion, onDeleteQuestion, lang, showToast, onFileImport, isProcessingFile }) => {
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterClass, setFilterClass] = useState<number | ''>('');
  const [filterMarks, setFilterMarks] = useState<number | ''>('');
  const [filterDifficulty, setFilterDifficulty] = useState<Difficulty | ''>('');
  const [filterChapter, setFilterChapter] = useState<string>('');
  const [filterTag, setFilterTag] = useState<string>('');
  const [animatingButton, setAnimatingButton] = useState<ActionButtonType | null>(null);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  
  const pdfUploadRef = useRef<HTMLInputElement>(null);
  const csvUploadRef = useRef<HTMLInputElement>(null);
  const txtUploadRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
            setIsActionMenuOpen(false);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const triggerAnimation = (type: ActionButtonType) => {
    setAnimatingButton(type);
    setTimeout(() => setAnimatingButton(null), 500); // Animation duration
  };

  const handleActionClick = (type: ActionButtonType) => {
    triggerAnimation(type);
    switch (type) {
        case 'manual': onAddQuestion(); break;
        case 'pdf': pdfUploadRef.current?.click(); break;
        case 'csv': csvUploadRef.current?.click(); break;
        case 'txt': txtUploadRef.current?.click(); break;
        case 'image': imageUploadRef.current?.click(); break;
        case 'word': showToast(t('wordSupportComingSoon', lang), 'success'); break;
    }
  };


  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      setSearchTerm(inputValue);
    }, 300); // 300ms debounce delay

    return () => {
      clearTimeout(debounceTimer);
    };
  }, [inputValue]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('questionCopied', lang), 'success');
    } catch (err) {
      console.error('Failed to copy text: ', err);
      showToast(t('copyFailed', lang), 'error');
    }
  };

  const uniqueChapters = useMemo(() => {
    const chapters = new Set(questions.map(q => q.chapter));
    return Array.from(chapters).sort();
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    return questions.filter(q => 
        (q.text.toLowerCase().includes(searchTerm.toLowerCase()) || q.chapter.toLowerCase().includes(searchTerm.toLowerCase())) &&
        (filterClass === '' || q.class === filterClass) &&
        (filterMarks === '' || q.marks === filterMarks) &&
        (filterDifficulty === '' || q.difficulty === filterDifficulty) &&
        (filterChapter === '' || q.chapter === filterChapter) &&
        (filterTag === '' || (q.tags && q.tags.some(tag => tag.toLowerCase().includes(filterTag.toLowerCase()))))
    ).sort((a,b) => b.class - a.class);
  }, [questions, searchTerm, filterClass, filterMarks, filterDifficulty, filterChapter, filterTag]);

  const inputStyles = "w-full p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition";
  
  const actionButtons: { type: ActionButtonType, emoji: string, label: string, gradient: string }[] = [
    { type: 'manual', emoji: '✍️', label: t('addManually', lang), gradient: 'bg-gradient-to-br from-indigo-500 to-purple-600 focus:ring-purple-300' },
    { type: 'pdf', emoji: '📄', label: t('uploadPDF', lang), gradient: 'bg-gradient-to-br from-red-500 to-orange-500 focus:ring-orange-300' },
    { type: 'csv', emoji: '📊', label: t('uploadCSV', lang), gradient: 'bg-gradient-to-br from-green-500 to-emerald-500 focus:ring-emerald-300' },
    { type: 'txt', emoji: '📝', label: t('uploadTXT', lang), gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500 focus:ring-cyan-300' },
    { type: 'image', emoji: '📷', label: t('scanImage', lang), gradient: 'bg-gradient-to-br from-purple-500 to-pink-500 focus:ring-pink-300' },
    { type: 'word', emoji: '📖', label: t('uploadWord', lang), gradient: 'bg-gradient-to-br from-sky-500 to-blue-600 focus:ring-sky-300' },
  ];

  return (
    <div className="p-2 sm:p-4 space-y-4">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div className="flex justify-between items-center" ref={actionMenuRef}>
            <h3 className="font-bold text-lg text-slate-800">{t('importFrom', lang)}</h3>
            <div className="relative">
                <button
                    onClick={() => setIsActionMenuOpen(prev => !prev)}
                    disabled={isProcessingFile}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-60"
                >
                    <span className="text-lg">➕</span>
                    <span>Actions</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 transition-transform ${isActionMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
                {isActionMenuOpen && (
                    <div className="absolute top-full right-0 mt-2 bg-white rounded-xl shadow-lg border border-slate-200 z-20 p-2">
                        <div className="grid grid-cols-3 gap-2">
                            {actionButtons.map(btn => (
                                <ActionButton
                                    key={btn.type}
                                    onClick={() => { handleActionClick(btn.type); setIsActionMenuOpen(false); }}
                                    disabled={isProcessingFile}
                                    isAnimating={animatingButton === btn.type}
                                    emoji={btn.emoji}
                                    label={btn.label}
                                    gradient={btn.gradient}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>
    
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <input
          type="text"
          placeholder={t('search', lang)}
          className={`${inputStyles} lg:col-span-2`}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
        />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value === '' ? '' : parseInt(e.target.value))} className={inputStyles}>
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterChapter} onChange={e => setFilterChapter(e.target.value)} className={inputStyles}>
            <option value="">{t('allChapters', lang)}</option>
            {uniqueChapters.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterMarks} onChange={e => setFilterMarks(e.target.value === '' ? '' : parseInt(e.target.value))} className={inputStyles}>
            <option value="">All Marks</option>
            {MARKS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value as Difficulty | '')} className={inputStyles}>
            <option value="">All Difficulties</option>
            {Object.values(Difficulty).map(d => <option key={d} value={d}>{t(d, lang)}</option>)}
        </select>
        <input
            type="text"
            placeholder="Filter by tag..."
            className={`${inputStyles} md:col-span-3 lg:col-span-6`}
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
        />
      </div>

      <div className="hidden md:block overflow-x-auto">
        <div className="bg-white shadow-sm rounded-xl border border-slate-200">
          <table className="min-w-full ">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('questionText', lang)}</th>
                <th className="p-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('class', lang)}</th>
                <th className="p-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('marks', lang)}</th>
                <th className="p-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('difficulty', lang)}</th>
                <th className="p-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Tags</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredQuestions.map(q => (
                <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 text-slate-700 text-sm max-w-md">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">{q.text}</div>
                      {q.image_data_url && (
                        <img src={q.image_data_url} alt="Question thumbnail" className="w-20 h-auto rounded-md border flex-shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-slate-600 text-sm">{q.class}</td>
                  <td className="p-4 text-slate-600 text-sm">{q.marks}</td>
                  <td className="p-4 text-slate-600 text-sm">{t(q.difficulty, lang)}</td>
                  <td className="p-4 text-slate-600 text-sm max-w-xs">
                    <div className="flex flex-wrap gap-1">
                        {q.tags && q.tags.map(tag => (
                            <span key={tag} className="text-xs bg-cyan-50 text-cyan-700 font-medium px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                    </div>
                  </td>
                  <td className="p-4 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => handleCopy(q.text)} className="font-semibold text-slate-500 hover:text-slate-800">{t('copy', lang)}</button>
                    <button onClick={() => onEditQuestion(q)} className="font-semibold text-indigo-600 hover:text-indigo-800">{t('edit', lang)}</button>
                    <button onClick={() => onDeleteQuestion(q.id)} className="font-semibold text-red-600 hover:text-red-800">{t('delete', lang)}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="md:hidden space-y-4">
        {filteredQuestions.map(q => (
          <QuestionCard key={q.id} question={q} onEdit={() => onEditQuestion(q)} onDelete={() => onDeleteQuestion(q.id)} onCopy={() => handleCopy(q.text)} lang={lang} />
        ))}
      </div>

      {filteredQuestions.length === 0 && (
        <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-slate-200">
          <p>{t('noQuestions', lang)}</p>
        </div>
      )}
      
      <input type="file" ref={pdfUploadRef} onChange={(e) => onFileImport(e, 'pdf')} className="hidden" accept="application/pdf" />
      <input type="file" ref={csvUploadRef} onChange={(e) => onFileImport(e, 'csv')} className="hidden" accept=".csv" />
      <input type="file" ref={txtUploadRef} onChange={(e) => onFileImport(e, 'txt')} className="hidden" accept="text/plain" />
      <input type="file" ref={imageUploadRef} onChange={(e) => onFileImport(e, 'image')} className="hidden" accept="image/*" />
    </div>
  );
};

export default QuestionBank;