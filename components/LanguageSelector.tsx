import React, { useState, useRef, useEffect } from 'react';
import { Language } from '../types';

interface LanguageSelectorProps {
  lang: Language;
  onLangChange: (lang: Language) => void;
}

const languageOptions: { code: Language; name: string; fontClass: string }[] = [
  { code: 'en', name: 'English', fontClass: '' },
  { code: 'bn', name: 'বাংলা', fontClass: 'font-noto-bengali' },
  { code: 'hi', name: 'हिन्दी', fontClass: 'font-noto-devanagari' },
  { code: 'ka', name: 'ಕನ್ನಡ', fontClass: 'font-noto-kannada' },
];

const LanguageSelector: React.FC<LanguageSelectorProps> = ({ lang, onLangChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const handleSelect = (newLang: Language) => {
    onLangChange(newLang);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="bg-slate-100/50 border border-slate-200/80 rounded-lg px-3 py-2 shadow-inner flex items-center transition-colors hover:bg-slate-200/50"
      >
        <span className="font-mono text-sm font-semibold tracking-wider animate-text-color-cycle">
          {lang.toUpperCase()}
        </span>
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ml-1.5 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-40 bg-white rounded-lg shadow-lg border border-slate-200 z-50 overflow-hidden animate-fade-in-down">
          <ul>
            {languageOptions.map(option => (
              <li key={option.code}>
                <button
                  onClick={() => handleSelect(option.code)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-100 ${option.fontClass} ${lang === option.code ? 'font-bold text-indigo-600' : 'text-slate-700'}`}
                >
                  {option.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
       <style>{`
        @keyframes fade-in-down {
          0% {
            opacity: 0;
            transform: translateY(-10px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-down {
          animation: fade-in-down 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default LanguageSelector;
