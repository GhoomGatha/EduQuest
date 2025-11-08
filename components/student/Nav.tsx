

import React, { useRef, useState, useEffect } from 'react';
import { StudentTab } from '../../types';
import { STUDENT_TABS } from '../../constants';
import { t } from '../../utils/localization';

interface NavProps {
  activeTab: StudentTab;
  onTabChange: (tab: StudentTab) => void;
  lang: 'en' | 'bn' | 'hi' | 'ka';
}

const tabIconAnimations: Record<StudentTab, string> = {
  dashboard: 'animate-glow',
  results: 'animate-sway',
  practice: 'animate-bobbing',
  ai_tutor: 'animate-glow',
  settings: 'animate-slow-spin',
  test_papers: 'animate-sway',
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
    // The nav itself no longer needs padding. The framing is handled by the parent Header.
    <nav ref={navRef} className="relative flex items-center bg-green-50 backdrop-blur-md p-1 rounded-full overflow-x-auto no-scrollbar">
      <div
        className="absolute bg-white rounded-full h-10 shadow-md premium-tab-slider"
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
              ? 'text-green-700'
              : 'text-slate-600 hover:text-slate-800'
          }`}
          aria-selected={activeTab === tab.id}
        >
          <span className={`mr-2 text-lg ${activeTab === tab.id ? tabIconAnimations[tab.id] : ''}`}>{tab.icon}</span>
          {t(tab.id, lang)}
        </button>
      ))}
    </nav>
  );
};

export default Nav;