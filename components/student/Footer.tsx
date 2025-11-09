

import React, { useRef, useState, useEffect } from 'react';
import { t } from '../../utils/localization';
import SecretMessageModal from '../SecretMessageModal';
import { useAuth } from '../../hooks/useAuth';

interface FooterProps {
  lang: 'en' | 'bn' | 'hi';
}

const Footer: React.FC<FooterProps> = ({ lang }) => {
  const [isSecretMessageOpen, setSecretMessageOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{ lastLogin: string; currentSessionStart: string }>({ lastLogin: 'N/A', currentSessionStart: 'N/A' });
  const { session } = useAuth();

    useEffect(() => {
        const updateSessionInfo = () => {
            if (session?.user?.id) {
                const lastLoginKey = `eduquest_last_login_${session.user.id}`;
                const currentSessionKey = `eduquest_current_session_start_${session.user.id}`;

                const last = localStorage.getItem(lastLoginKey);
                const current = sessionStorage.getItem(currentSessionKey);
                setSessionInfo({
                    lastLogin: last ? new Date(last).toLocaleString() : 'N/A',
                    currentSessionStart: current ? new Date(current).toLocaleString() : 'N/A'
                });
            }
        };

        updateSessionInfo();
        window.addEventListener('storage', updateSessionInfo);
        return () => window.removeEventListener('storage', updateSessionInfo);
    }, [session]);

  const handleHeartPressStart = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = window.setTimeout(() => {
      setSecretMessageOpen(true);
    }, 11000); // 11 seconds
  };

  const handleHeartPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  return (
    <>
      <footer className="text-center py-4 text-sm text-slate-500 border-t border-white/20 bg-green-200/50 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-xs text-slate-400 mb-2 space-x-4">
                <span><strong>Current Session:</strong> {sessionInfo.currentSessionStart}</span>
                <span><strong>Last Login:</strong> {sessionInfo.lastLogin}</span>
            </div>
            <p>© {new Date().getFullYear()} {t('appTitle', lang)}. All Rights Reserved.</p>
            <p className="mt-1 text-xs text-slate-400">
            Crafted with{' '}
            <span
                className="animate-beat animate-text-color-cycle cursor-pointer"
                onMouseDown={handleHeartPressStart}
                onMouseUp={handleHeartPressEnd}
                onMouseLeave={handleHeartPressEnd}
                onTouchStart={handleHeartPressStart}
                onTouchEnd={handleHeartPressEnd}
            >
                ❤️
            </span>
            {' '}for Hiyan by <span className="animate-beat animate-text-color-cycle">Vedant</span> v1.0
            </p>
        </div>
      </footer>
      <SecretMessageModal isOpen={isSecretMessageOpen} onClose={() => setSecretMessageOpen(false)} />
    </>
  );
};

export default Footer;