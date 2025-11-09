import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { StudentQuery } from '../types';

interface AnswerQueryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (queryId: string, answerText: string) => void;
    query: StudentQuery | null;
}

const AnswerQueryModal: React.FC<AnswerQueryModalProps> = ({ isOpen, onClose, onSubmit, query }) => {
    const [answerText, setAnswerText] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (query) {
            setAnswerText(query.answer_text || '');
        }
    }, [query]);

    const handleSubmit = async () => {
        if (!query || !answerText.trim()) return;
        setIsSubmitting(true);
        await onSubmit(query.id, answerText);
        setIsSubmitting(false);
    };

    if (!query) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Respond to ${query.student_profile?.full_name || 'Student'}`}>
            <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-lg border">
                    <p className="font-semibold text-slate-800">{query.query_text}</p>
                    {query.query_image_url && (
                        <img src={query.query_image_url} alt="Student's query" className="mt-3 rounded-md border max-w-full h-auto" />
                    )}
                    <p className="text-xs text-slate-500 mt-2">{new Date(query.created_at).toLocaleString()}</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600">Your Answer</label>
                    <textarea
                        value={answerText}
                        onChange={e => setAnswerText(e.target.value)}
                        rows={6}
                        className="mt-1 block w-full rounded-lg border-slate-300 bg-white shadow-sm"
                        placeholder="Type your response here..."
                    />
                </div>
                <div className="flex justify-end space-x-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !answerText.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm disabled:bg-indigo-300"
                    >
                        {isSubmitting ? "Submitting..." : "Submit Answer"}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default AnswerQueryModal;
