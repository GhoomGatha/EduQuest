import React from 'react';
import { ActivityItem, Language, Paper, Question, TutorSession } from '../types';
import { formatRelativeTime } from '../utils/localization';

interface RecentActivityFeedProps {
    activities: ActivityItem[];
    onItemClick: (item: ActivityItem) => void;
    lang: Language;
}

const ActivityIcon: React.FC<{ type: ActivityItem['type'] }> = ({ type }) => {
    const iconMap: Record<ActivityItem['type'], string> = {
        question: '🧠',
        paper: '🧾',
        tutor_session: '🧑‍🏫',
        test_attempt: '✍️',
        study_material: '📚',
    };
    const colorMap: Record<ActivityItem['type'], string> = {
        question: 'bg-blue-100 text-blue-600',
        paper: 'bg-green-100 text-green-600',
        tutor_session: 'bg-purple-100 text-purple-600',
        test_attempt: 'bg-yellow-100 text-yellow-600',
        study_material: 'bg-indigo-100 text-indigo-600',
    };
    return (
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${colorMap[type]}`}>
            <span className="text-xl">{iconMap[type]}</span>
        </div>
    );
};

const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({ activities, onItemClick, lang }) => {
    
    const getTitle = (item: ActivityItem): string => {
        switch(item.type) {
            case 'question': return `New Question Added`;
            case 'paper': return `Paper Generated: "${item.title}"`;
            case 'tutor_session': return `New AI Tutor Session`;
            default: return 'Recent Activity';
        }
    }

    const getSnippet = (item: ActivityItem): string => {
        const data = item.data;
        switch(item.type) {
            case 'question': return (data as Question).text;
            case 'paper': return `${(data as Paper).questions.length} questions`;
            case 'tutor_session': return (data as TutorSession).query_text || 'Image Query';
            default: return '';
        }
    }

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-bold font-serif-display text-slate-800 mb-4">
                <span className="inline-block mr-2 text-2xl">⚡</span>
                Recent Activity
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
                <p className="text-center text-sm text-slate-500 p-4">No recent activities to show.</p>
            )}
        </div>
    );
};

export default RecentActivityFeed;