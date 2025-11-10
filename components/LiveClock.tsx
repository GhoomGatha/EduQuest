import React, { useState, useEffect } from 'react';

const LiveClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timerId = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, []);

  return (
    <div className="bg-slate-100/50 border border-slate-200/80 rounded-lg px-2 sm:px-3 py-2 shadow-inner">
      <p className="font-mono text-sm font-semibold tracking-normal sm:tracking-wider animate-text-color-cycle whitespace-nowrap">
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
    </div>
  );
};

export default LiveClock;
