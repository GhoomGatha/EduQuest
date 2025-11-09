import React, { useState, useEffect, useRef } from 'react';
import { Assignment, Classroom, Language, Paper, StudentQuery } from '../../types';
import { t } from '../../utils/localization';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../services/supabaseClient';

const AnimatedHeader: React.FC<{ emoji: string; animation: string; title: string; }> = ({ emoji, animation, title }) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const [isIntersecting, setIntersecting] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                setIntersecting(entry.isIntersecting);
            },
            {
                rootMargin: '-50% 0px -50% 0px',
                threshold: 0
            }
        );

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => {
            if (ref.current) {
                observer.unobserve(ref.current);
            }
        };
    }, []);

    return (
        <h2 ref={ref} className="text-xl font-bold font-serif-display text-slate-700 mb-4">
            <span className={`inline-block mr-2 text-2xl ${isIntersecting ? animation : ''}`}>{emoji}</span>
            {title}
        </h2>
    );
};

const MyClassrooms: React.FC<{
    classrooms: Classroom[];
    onRefresh: () => void;
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
}> = ({ classrooms, onRefresh, lang, showToast }) => {
    const { user } = useAuth();
    const [inviteCode, setInviteCode] = useState('');
    const [isJoining, setIsJoining] = useState(false);

    const handleJoin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inviteCode.trim() || !user) return;
        setIsJoining(true);

        try {
            const { data, error } = await supabase.rpc('join_classroom_with_code', {
                p_invite_code: inviteCode.trim().toUpperCase()
            });

            if (error) {
                throw error;
            }
    
            if (data.error) {
                throw new Error(data.error);
            }
    
            if (data.success) {
                showToast(data.message || "Successfully joined classroom!", 'success');
                setInviteCode('');
                onRefresh();
            } else {
                throw new Error("An unexpected response was received from the server.");
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setIsJoining(false);
        }
    };

    return (
        <section>
            <AnimatedHeader emoji="🧑‍🏫" animation="animate-bobbing" title="My Classrooms" />
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                {classrooms.length > 0 && (
                    <div className="space-y-3 mb-4">
                        {classrooms.map(c => (
                            <div key={c.id} className="p-3 bg-slate-50 rounded-lg border">
                                <h4 className="font-bold text-slate-800">{c.name}</h4>
                                <p className="text-sm text-slate-500">
                                    {c.teacher_profile?.full_name} &middot; Class {c.class_details.class} - {c.class_details.subject}
                                </p>
                            </div>
                        ))}
                    </div>
                )}

                <form onSubmit={handleJoin} className="flex gap-2">
                    <input 
                        type="text" 
                        value={inviteCode}
                        onChange={e => setInviteCode(e.target.value)}
                        placeholder="Enter Invite Code"
                        className="flex-grow p-2.5 border border-slate-300 bg-white rounded-lg shadow-sm"
                        maxLength={6}
                    />
                    <button type="submit" disabled={isJoining} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300">
                        {isJoining ? 'Joining...' : 'Join'}
                    </button>
                </form>
            </div>
        </section>
    );
};

interface StudentClassroomProps {
    assignments: Assignment[];
    joinedClassrooms: Classroom[];
    onRefreshClassrooms: () => void;
    onStartTest: (paper: Paper) => void;
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    queries: StudentQuery[];
    onRefreshQueries: () => void;
}

const StudentClassroom: React.FC<StudentClassroomProps> = ({
    assignments,
    joinedClassrooms,
    onRefreshClassrooms,
    onStartTest,
    lang,
    showToast,
    queries,
    onRefreshQueries,
}) => {
    const { user } = useAuth();
    const [selectedClassroom, setSelectedClassroom] = useState('');
    const [queryText, setQueryText] = useState('');
    const [queryImage, setQueryImage] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (joinedClassrooms.length > 0 && !selectedClassroom) {
            setSelectedClassroom(joinedClassrooms[0].id);
        }
    }, [joinedClassrooms, selectedClassroom]);

    const handleAskQuestion = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!queryText.trim() || !selectedClassroom || !user) return;
        
        setIsSubmitting(true);
        const classroom = joinedClassrooms.find(c => c.id === selectedClassroom);
        if (!classroom) {
            showToast("Selected classroom not found.", "error");
            setIsSubmitting(false);
            return;
        }

        try {
            let imageUrl: string | undefined = undefined;
            if (queryImage) {
                const fileExt = queryImage.name.split('.').pop();
                const filePath = `${user.id}/${Date.now()}.${fileExt}`;
                const { error: uploadError } = await supabase.storage.from('query_images').upload(filePath, queryImage);
                if (uploadError) throw uploadError;
                imageUrl = supabase.storage.from('query_images').getPublicUrl(filePath).data.publicUrl;
            }

            const { error: insertError } = await supabase.from('student_queries').insert({
                student_id: user.id,
                classroom_id: selectedClassroom,
                teacher_id: classroom.teacher_id,
                query_text: queryText,
                query_image_url: imageUrl,
                status: 'asked',
            });

            if (insertError) throw insertError;

            showToast("Question sent to your teacher!", "success");
            setQueryText('');
            setQueryImage(null);
            onRefreshQueries();

        } catch (err: any) {
            showToast(`Error sending question: ${err.message}`, 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 space-y-8">
            <header className="space-y-1">
                <h1 className="text-3xl font-bold font-serif-display text-slate-800">
                    My Classroom
                </h1>
                <p className="text-slate-500">View your assignments and join new classrooms.</p>
            </header>

            <MyClassrooms classrooms={joinedClassrooms} onRefresh={onRefreshClassrooms} lang={lang} showToast={showToast} />

            <section>
                <AnimatedHeader emoji="🔔" animation="animate-flash" title="Assigned by your Teacher" />
                {assignments.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {assignments.map(assignment => {
                            const paper = assignment.paper_snapshot;
                            return (
                                <div key={assignment.id} className="bg-white p-5 rounded-xl shadow-sm border-2 border-indigo-200 flex flex-col">
                                    <h3 className="font-bold text-slate-800 flex-grow">{paper.title}</h3>
                                    <p className="text-sm text-slate-500 mt-1">{paper.questions.length} Questions</p>
                                    {assignment.due_date && <p className="text-xs text-red-500 font-medium mt-1">Due: {new Date(assignment.due_date).toLocaleString()}</p>}
                                    {paper.time_limit_minutes && paper.time_limit_minutes > 0 && (
                                        <p className="text-xs text-slate-500 font-medium mt-1">Time Limit: {paper.time_limit_minutes} minutes</p>
                                    )}
                                    <button
                                        onClick={() => onStartTest(paper)}
                                        className="mt-4 w-full px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm"
                                    >
                                        {t('startTest', lang)}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <p>You have no assignments from your teacher right now. Check back later!</p>
                    </div>
                )}
            </section>
            
            <section>
                <AnimatedHeader emoji="🤔" animation="animate-pulse" title="Ask a Question" />
                <form onSubmit={handleAskQuestion} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Select Classroom</label>
                        <select value={selectedClassroom} onChange={e => setSelectedClassroom(e.target.value)} className="mt-1 block w-full rounded-lg border-slate-300 bg-white shadow-sm" disabled={joinedClassrooms.length === 0}>
                            {joinedClassrooms.length > 0 ? (
                                joinedClassrooms.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                            ) : (
                                <option>Join a classroom first</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600">Your Question</label>
                        <textarea value={queryText} onChange={e => setQueryText(e.target.value)} required rows={4} className="mt-1 block w-full rounded-lg border-slate-300 bg-white shadow-sm" placeholder="Type your doubt here..."></textarea>
                    </div>
                    <div className="flex justify-between items-center pt-2">
                        <div className="flex-1 min-w-0">
                             <label htmlFor="query-image-upload" className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors text-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                                </svg>
                                <span className="truncate">{queryImage ? queryImage.name : 'Attach Image'}</span>
                            </label>
                            <input id="query-image-upload" type="file" onChange={e => setQueryImage(e.target.files ? e.target.files[0] : null)} accept="image/*" className="hidden"/>
                        </div>
                        <button type="submit" disabled={isSubmitting || !selectedClassroom} className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:bg-indigo-300 ml-4 flex-shrink-0">
                            {isSubmitting ? "Sending..." : "Send to Teacher"}
                        </button>
                    </div>
                </form>
            </section>

            <section>
                 <AnimatedHeader emoji="📬" animation="animate-sway" title="My Questions" />
                 <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-3">
                    {queries.length > 0 ? (
                        queries.map(q => (
                             <details key={q.id} className="p-3 rounded-lg border bg-slate-50 group">
                                <summary className="flex justify-between items-center cursor-pointer">
                                    <div className="flex-grow">
                                        <p className="font-semibold text-slate-800">{q.query_text}</p>
                                        <p className="text-xs text-slate-500">{new Date(q.created_at).toLocaleString()}</p>
                                    </div>
                                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${q.status === 'answered' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                        {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                                    </span>
                                </summary>
                                <div className="mt-4 pt-3 border-t">
                                    {q.query_image_url && <img src={q.query_image_url} alt="Question" className="max-w-xs rounded-md border mb-3" />}
                                    {q.status === 'answered' ? (
                                        <div>
                                            <h5 className="font-semibold text-sm text-indigo-700">Teacher's Response:</h5>
                                            <p className="text-slate-700 whitespace-pre-wrap">{q.answer_text}</p>
                                        </div>
                                    ) : (
                                        <p className="text-sm italic text-slate-500">Waiting for your teacher to respond...</p>
                                    )}
                                </div>
                             </details>
                        ))
                    ) : (
                        <p className="text-center text-slate-500 p-8">You haven't asked any questions yet.</p>
                    )}
                 </div>
            </section>
        </div>
    );
};

export default StudentClassroom;
