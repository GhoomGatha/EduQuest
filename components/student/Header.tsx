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
    <header className="bg-green-50/80 backdrop-blur-lg shadow-md sticky top-0 z-40 border-b border-green-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
        {children}
      </div>
    </header>
  );
};

export default Header;