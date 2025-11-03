
import React from 'react';
import { ToastMessage } from '../types';

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 3000);

    return () => {
      clearTimeout(timer);
    };
  }, [toast, onDismiss]);

  const bgColor = toast.type === 'success' ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className={`flex items-center justify-between p-4 rounded-lg shadow-lg text-white ${bgColor}`}>
      <span>{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="ml-4 font-bold">
        &times;
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-11/12 max-w-sm">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
