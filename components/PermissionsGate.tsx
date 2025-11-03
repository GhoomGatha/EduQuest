import React from 'react';

interface PermissionsGateProps {
  onAgree: () => void;
}

const PermissionsGate: React.FC<PermissionsGateProps> = ({ onAgree }) => {

  const handleAgree = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => { onAgree(); },
        () => { onAgree(); }
      );
    } else {
      onAgree();
    }
  };


  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-lg p-8 space-y-6 bg-white rounded-xl shadow-lg text-center">
        <h1 className="text-3xl font-bold font-serif-display text-slate-800">Permissions Required</h1>
        <p className="text-slate-600">
          To provide the best experience, EduQuest needs your permission to access certain features on your device, including:
        </p>
        <ul className="text-left list-disc list-inside space-y-2 text-slate-600 bg-slate-50 p-4 rounded-lg">
          <li><strong>Location:</strong> To tailor content and features to your region.</li>
          <li><strong>Storage:</strong> To save and import question paper backups directly from your device.</li>
          <li><strong>Contacts:</strong> To potentially share papers with colleagues in the future.</li>
        </ul>
        <p className="text-xs text-slate-500">
          We respect your privacy. Your data will only be used to enhance your app experience.
        </p>
        <button
          onClick={handleAgree}
          className="w-full px-4 py-3 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 font-semibold transition-transform hover:scale-105"
        >
          I Understand and Agree
        </button>
      </div>
    </div>
  );
};

export default PermissionsGate;