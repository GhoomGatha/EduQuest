

import React from 'react';
import { Language } from '../../types';
import { t } from '../../utils/localization';
import LiveClock from '../LiveClock';
import LanguageSelector from '../LanguageSelector';

interface HeaderProps {
  lang: Language;
  onLangChange: (lang: Language) => void;
  children?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ lang, onLangChange, children }) => {
  return (
    <header className="bg-green-200/50 backdrop-blur-xl shadow-sm sticky top-0 z-40 border-b border-white/30">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 equipment-title-container">
              <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center mr-3 shadow-md">
                <span className="text-xl microscope-emoji">{t('appHeaderEmoji', lang)}</span>
              </div>
              <span className="font-serif-display animate-text-color-cycle">{t('appHeaderText', lang)}</span>
            </h1>
            <p className="text-sm text-slate-500">{t('studentAppSubtitle', lang)}</p>
          </div>
          <div className="flex items-center space-x-3">
            <LiveClock />
            <LanguageSelector lang={lang} onLangChange={onLangChange} />
          </div>
        </div>
        {/* The two separate lines are replaced by this single framing div that wraps the Nav */}
        <div className="my-2 p-[1.5px] rounded-full animate-background-color-cycle">
            {children}
        </div>
      </div>
    </header>
  );
};

export default Header;