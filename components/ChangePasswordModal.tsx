import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import Modal from './Modal';

interface ChangePasswordModalProps {
    isOpen: boolean;
    onClose: () => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose, showToast }) => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Effect to reset state whenever the modal closes.
    // This ensures that if the user re-opens the modal, it's in a clean state.
    useEffect(() => {
        if (!isOpen) {
            setNewPassword('');
            setConfirmPassword('');
            setError(null);
            setLoading(false);
            setShowPassword(false);
        }
    }, [isOpen]);

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (newPassword.length < 6) {
            setError("Password must be at least 6 characters long.");
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        try {
            const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

            if (updateError) {
                throw updateError;
            }

            // On success, show toast and close the modal.
            // The useEffect will handle cleaning up the state.
            showToast("Password changed successfully!", "success");
            onClose();

        } catch (err: any) {
            // On error, show the message and stop the loading indicator.
            setError(err?.message || 'An unknown error occurred.');
            setLoading(false);
        }
    };

    const inputStyles = "block w-full rounded-lg border-slate-300 bg-slate-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Change Password">
            <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-600">New Password</label>
                    <div className="relative mt-1">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={6}
                            className={inputStyles}
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600">
                            {showPassword ? (
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            ) : (
                                <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7 1.274-4.057 5.064 7-9.542-7 1.845 0 3.576.506 5.034 1.353m-2.47 1.825A4 4 0 0012 13a4 4 0 00-1.404 3.001m2.808-5.002l4.636 4.636M3 3l18 18" /></svg>
                            )}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600">Confirm New Password</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className={`${inputStyles} mt-1`}
                    />
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
                
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium">Cancel</button>
                    <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm disabled:bg-indigo-400">
                        {loading ? 'Saving...' : 'Save New Password'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default ChangePasswordModal;
