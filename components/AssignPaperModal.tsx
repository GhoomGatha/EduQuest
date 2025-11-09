
import React, { useState } from 'react';
import Modal from './Modal';
import { Classroom, Paper } from '../types';

interface AssignPaperModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (details: { classroomId: string; dueDate: string; timeLimit: number }) => void;
    classrooms: Classroom[];
    paper: Paper | null;
}

const AssignPaperModal: React.FC<AssignPaperModalProps> = ({ isOpen, onClose, onSubmit, classrooms, paper }) => {
    const [classroomId, setClassroomId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [timeLimit, setTimeLimit] = useState(0);

    const handleSubmit = () => {
        if (!classroomId) return;
        onSubmit({
            classroomId,
            dueDate,
            timeLimit: Number(timeLimit) || 0,
        });
    };

    const inputStyles = "mt-1 block w-full rounded-lg border-slate-300 bg-slate-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm transition";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Assign Paper: ${paper?.title || ''}`}>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-600">Classroom</label>
                    <select value={classroomId} onChange={e => setClassroomId(e.target.value)} className={inputStyles}>
                        <option value="">Select a classroom...</option>
                        {classrooms.map(c => (
                            <option key={c.id} value={c.id}>{c.name} (Class {c.class_details.class})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600">Due Date (Optional)</label>
                    <input type="datetime-local" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputStyles} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-600">Time Limit in Minutes (0 for no limit)</label>
                    <input type="number" value={timeLimit} onChange={e => setTimeLimit(parseInt(e.target.value))} min="0" className={inputStyles} />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium transition-colors">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={!classroomId}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm disabled:bg-indigo-300"
                    >
                        Assign Paper
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default AssignPaperModal;
