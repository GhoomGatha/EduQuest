

import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { Classroom, Paper } from '../types';

interface AssignPaperModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (details: { classroomId: string; paperId: string; dueDate: string; timeLimit: number }) => void;
    classrooms: Classroom[];
    papers: Paper[];
    initialState: { paper?: Paper; classroom?: Classroom } | null;
}

const AssignPaperModal: React.FC<AssignPaperModalProps> = ({ isOpen, onClose, onSubmit, classrooms, paper: initialPaperProp, ...props }) => {
    const { initialState, papers } = props;
    const [selectedClassroomId, setSelectedClassroomId] = useState('');
    const [selectedPaperId, setSelectedPaperId] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [timeLimit, setTimeLimit] = useState(0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSelectedClassroomId(initialState?.classroom?.id || (classrooms.length > 0 ? classrooms[0].id : ''));
            setSelectedPaperId(initialState?.paper?.id || '');
            setDueDate('');
            setTimeLimit(initialState?.paper?.time_limit_minutes || 0);
        }
    }, [isOpen, initialState, classrooms]);

    const handleSubmit = async () => {
        if (!selectedClassroomId || !selectedPaperId) return;
        setIsSubmitting(true);
        await onSubmit({
            classroomId: selectedClassroomId,
            paperId: selectedPaperId,
            dueDate,
            timeLimit: Number(timeLimit) || 0,
        });
        setIsSubmitting(false);
    };

    const inputStyles = "mt-1 block w-full rounded-lg border-slate-300 bg-slate-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm transition";

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Assign Paper`}>
            <div className="space-y-4">
                
                {initialState?.paper ? (
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Paper</label>
                        <p className={`${inputStyles} bg-slate-200`}>{initialState.paper.title}</p>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Select Paper</label>
                        <select value={selectedPaperId} onChange={e => setSelectedPaperId(e.target.value)} className={inputStyles}>
                            <option value="">Select a paper...</option>
                            {papers.map(p => (
                                <option key={p.id} value={p.id}>{p.title}</option>
                            ))}
                        </select>
                    </div>
                )}
                
                {initialState?.classroom ? (
                     <div>
                        <label className="block text-sm font-medium text-slate-600">Classroom</label>
                        <p className={`${inputStyles} bg-slate-200`}>{initialState.classroom.name}</p>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Select Classroom</label>
                        <select value={selectedClassroomId} onChange={e => setSelectedClassroomId(e.target.value)} className={inputStyles}>
                            <option value="">Select a classroom...</option>
                            {classrooms.map(c => (
                                <option key={c.id} value={c.id}>{c.name} (Class {c.class_details.class})</option>
                            ))}
                        </select>
                    </div>
                )}

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
                        disabled={!selectedClassroomId || !selectedPaperId || isSubmitting}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm disabled:bg-indigo-300"
                    >
                        {isSubmitting ? "Assigning..." : "Assign Paper"}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default AssignPaperModal;
