
import React, { useRef, useState, useEffect } from 'react';
import { StudentTab } from '../../types';
import { STUDENT_TABS } from '../../constants';
import { t } from '../../utils/localization';

interface NavProps {
  activeTab: StudentTab;
  onTabChange: (tab: StudentTab) => void;
  lang: 'en' | 'bn' | 'hi';
}

const tabIconAnimations: Record<StudentTab, string> = {
  dashboard: 'animate-glow',
  results: 'animate-sway',
  practice: 'animate-bobbing',
  settings: 'animate-slow-spin',
};

const Nav: React.FC<NavProps> = ({ activeTab, onTabChange, lang }) => {
  const navRef = useRef<HTMLDivElement>(null);
  const [sliderStyle, setSliderStyle] = useState({});

  useEffect(() => {
    if (navRef.current) {
      const activeTabElement = navRef.current.querySelector(`[data-tab-id="${activeTab}"]`) as HTMLElement;
      if (activeTabElement) {
        const { offsetLeft, offsetWidth } = activeTabElement;
        setSliderStyle({
          left: `${offsetLeft}px`,
          width: `${offsetWidth}px`,
        });
        activeTabElement.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest'
        });
      }
    }
  }, [activeTab, lang]);

  return (
    <nav className="relative pb-2 pt-1">
      <div ref={navRef} className="relative flex items-center bg-slate-200/80 p-1 rounded-full overflow-x-auto no-scrollbar">
        <div
          className="absolute bg-green-50/80 backdrop-blur-lg rounded-full h-10 shadow-md transition-all duration-300 ease-in-out border border-green-200"
          style={sliderStyle}
          aria-hidden="true"
        />
        {STUDENT_TABS.map(tab => (
          <button
            key={tab.id}
            data-tab-id={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative z-10 flex-shrink-0 px-3 sm:px-4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 flex items-center justify-center whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-indigo-700'
                : 'text-slate-600 hover:text-slate-800'
            }`}
            aria-selected={activeTab === tab.id}
          >
            <span className={`mr-2 text-lg ${activeTab === tab.id ? tabIconAnimations[tab.id] : ''}`}>{tab.icon}</span>
            {t(tab.id, lang)}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default Nav;