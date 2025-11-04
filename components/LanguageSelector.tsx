
import React, { useState, useRef, useEffect } from 'react';
import { Language } from '../types';

interface LanguageSelectorProps {
  lang: Language;
  onLangChange: (lang: Language) => void;
}

const languageOptions: { code: Language; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
];

const GlobeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m0 0a9 9 0 019-9m-9 9a9 9 0 009 9" />
    </svg>
);

const ChevronDownIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
);


const LanguageSelector: React.FC<LanguageSelectorProps> = ({ lang, onLangChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (selectedLang: Language) => {
    onLangChange(selectedLang);
    setIsOpen(false);
  };

  const currentLanguageCode = lang.toUpperCase();

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-slate-100/50 border border-slate-200/80 rounded-lg px-3 py-2 shadow-inner hover:bg-slate-200/60 transition-colors"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <GlobeIcon />
        <span className="font-mono text-sm font-semibold tracking-wider animate-text-color-cycle">{currentLanguageCode}</span>
        <ChevronDownIcon />
      </button>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-2 w-36 bg-white/80 backdrop-blur-lg rounded-lg shadow-lg border border-slate-200 overflow-hidden z-50"
          role="menu"
        >
          {languageOptions.map(({ code, name }) => (
            <button
              key={code}
              onClick={() => handleSelect(code)}
              className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${
                lang === code
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-700 hover:bg-indigo-50'
              }`}
              role="menuitem"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSelector;