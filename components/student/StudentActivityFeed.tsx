import React from 'react';
import { ActivityItem, Language, TestAttempt, StudyMaterial, TutorSession } from '../../types';
import { formatRelativeTime } from '../../utils/localization';

interface StudentActivityFeedProps {
    activities: ActivityItem[];
    onItemClick: (item: ActivityItem) => void;
    lang: Language;
}

const ActivityIcon: React.FC<{ type: ActivityItem['type'] }> = ({ type }) => {
    const iconMap: Record<ActivityItem['type'], string> = {
        test_attempt: '✍️',
        study_material: '📚',
        tutor_session: '🧑‍🏫',
        question: '', // Not used for students
        paper: '', // Not used for students
    };
    const colorMap: Record<ActivityItem['type'], string> = {
        test_attempt: 'bg-yellow-100 text-yellow-600',
        study_material: 'bg-indigo-100 text-indigo-600',
        tutor_session: 'bg-purple-100 text-purple-600',
        question: '',
        paper: '',
    };
    return (
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${colorMap[type]}`}>
            <span className="text-xl">{iconMap[type]}</span>
        </div>
    );
};

const StudentActivityFeed: React.FC<StudentActivityFeedProps> = ({ activities, onItemClick, lang }) => {
    
    const getTitle = (item: ActivityItem): string => {
        switch(item.type) {
            case 'test_attempt': return `Test Completed: "${item.title}"`;
            case 'study_material': return `New Study Material: "${item.title}"`;
            case 'tutor_session': return `New AI Tutor Session`;
            default: return 'Recent Activity';
        }
    }

    const getSnippet = (item: ActivityItem): string => {
        const data = item.data;
        switch(item.type) {
            case 'test_attempt': 
                const attempt = data as TestAttempt;
                return attempt.totalMarks === -1 ? `Practice Session` : `Score: ${attempt.score}/${attempt.totalMarks}`;
            case 'study_material': return `Type: ${(data as StudyMaterial).type.replace('_', ' ')}`;
            case 'tutor_session': return (data as TutorSession).query_text || 'Image Query';
            default: return '';
        }
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">
                <span className="inline-block mr-2 text-2xl">🎉</span>
                What's New
            </h2>
            {activities.length > 0 ? (
                <div className="space-y-3">
                    {activities.map(item => (
                        <button 
                            key={item.id} 
                            onClick={() => onItemClick(item)}
                            className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-colors flex items-start gap-4"
                        >
                            <ActivityIcon type={item.type} />
                            <div className="flex-grow min-w-0">
                                <p className="font-semibold text-slate-800">{getTitle(item)}</p>
                                <p className="text-sm text-slate-600 truncate">{getSnippet(item)}</p>
                                <p className="text-xs text-slate-400 mt-1">{formatRelativeTime(item.timestamp, lang)}</p>
                            </div>
                        </button>
                    ))}
                </div>
            ) : (
                <p className="text-center text-sm text-slate-500 p-4">Your recent activities will appear here.</p>
            )}
        </div>
    );
};

export default StudentActivityFeed;