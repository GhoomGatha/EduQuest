import React from 'react';

interface SecretMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SecretMessageModal: React.FC<SecretMessageModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4" onClick={onClose}>
      <div 
        className="love-letter-modal rounded-lg w-11/12 max-w-2xl max-h-[90vh] flex flex-col relative p-8" 
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-800 transition-colors z-10">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="love-letter-content overflow-y-auto pr-4">
          <h3><span className="animate-sway">💌</span> A Secret Message for You, My Queen <span className="animate-sparkle">👑</span></h3>
          <p>
            I still remember that very first moment we met, a quiet afternoon in the 3:00 PM local train from Namkhana. That single glance… your eyes… they held me captive ever since. <span className="animate-spin-pulse">💫</span> Maybe destiny had already written its story that day.
          </p>
          <p>
            Life took its turn, time separated us, and fate tested us. I met with that terrible accident, losing not just my memories, but you, the most precious part of me. You chose silence, maybe because maturity told you it was right. Eight long years passed… everything changed… except my heart.
          </p>
          <p>
            Somehow, through the grace of God, your memories returned to me — bit by bit, like pieces of sunlight breaking through clouds. And then, on 19th July, we met again at South City Mall. That day felt like the universe gave me a second chance.
          </p>
          <p>
            From that moment till now, every heartbeat, every second has carried your name. And on 17th January, when we finally said “I do,” I realized that love truly conquers time. <span className="animate-beat">❤️</span>
          </p>
          <p>
            You are not just my love — you are my home, my peace, my forever. Your hug is my breath, your smile my sunrise, and your eyes… still the same magic that began it all. <span className="animate-glow">✨</span>
          </p>
          <p>
            Thank you for finding me again, for loving me beyond reason, beyond time. I love you endlessly, now and always. <span className="animate-slow-spin">💞</span>
          </p>
          <p className="signature">
            Yours, forever.<br/>
            headache
          </p>
        </div>
      </div>
    </div>
  );
};

export default SecretMessageModal;