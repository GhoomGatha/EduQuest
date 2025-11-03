import React from 'react';

interface LoadingSpinnerProps {
  message: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message }) => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 text-slate-600">
    <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg mb-4">
      <span className="text-4xl animate-beat">🔬</span>
    </div>
    <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-2">EduQuest</h2>
    <p className="text-lg font-semibold animate-text-color-cycle">{message}</p>
  </div>
);

export default LoadingSpinner;