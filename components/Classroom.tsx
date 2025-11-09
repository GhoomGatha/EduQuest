
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Classroom, Language, Profile, ClassroomStudent, StudentQuery, Assignment, Paper } from '../types';
import { t } from '../utils/localization';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabaseClient';
import Modal from './Modal';
import { CLASSES } from '../constants';
import AnswerQueryModal from './AnswerQueryModal';

interface ClassroomProps {
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    studentQueries: StudentQuery[];
    onRefreshQueries: () => void;
    papers: Paper[];
    onAssignPaper: (classroom: Classroom) => void;
}

const generateInviteCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const ClassroomComponent: React.FC<ClassroomProps> = ({ lang, showToast, studentQueries, onRefreshQueries, papers, onAssignPaper }) => {
    const { user } = useAuth();
    const [classrooms, setClassrooms] = useState<Classroom[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loadingAssignments, setLoadingAssignments] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
    const [students, setStudents] = useState<ClassroomStudent[]>([]);
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [answeringQuery, setAnsweringQuery] = useState<StudentQuery | null>(null);

    const fetchClassrooms = useCallback(async () => {
        if (!user) return;
        setIsLoading(true);
        const { data, error } = await supabase
            .from('classrooms')
            .select('*, classroom_students(count)')
            .eq('teacher_id', user.id)
            .order('created_at', { ascending: false });

        if (error) {
            showToast(`Error fetching classrooms: ${error.message}`, 'error');
        } else {
            const classroomsWithCount = data.map(c => ({ ...c, student_count: (c.classroom_students as any)[0]?.count || 0 }));
            setClassrooms(classroomsWithCount);
        }
        setIsLoading(false);
    }, [user, showToast]);

    const fetchAssignments = useCallback(async () => {
        if (!user) return;
        setLoadingAssignments(true);
        const { data, error } = await supabase
            .from('assignments')
            .select('*')
            .eq('teacher_id', user.id);
        if (error) {
            showToast(`Error fetching assignments: ${error.message}`, 'error');
        } else {
            setAssignments(data || []);
        }
        setLoadingAssignments(false);
    }, [user, showToast]);

    useEffect(() => {
        fetchClassrooms();
        fetchAssignments();
    }, [fetchClassrooms, fetchAssignments]);

    useEffect(() => {
        if (!user) return;
        const channel = supabase.channel('public:assignments')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments', filter: `teacher_id=eq.${user.id}` }, 
            (payload) => {
                console.log('Assignment change detected, refetching.');
                fetchAssignments();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, fetchAssignments]);


    const handleViewClassroom = async (classroom: Classroom) => {
        setSelectedClassroom(classroom);
        setLoadingStudents(true);
        const { data: studentRelations, error: relationsError } = await supabase
            .from('classroom_students')
            .select('student_id, joined_at')
            .eq('classroom_id', classroom.id);
        
        if (relationsError) {
            showToast(`Error fetching students: ${relationsError.message}`, 'error');
            setLoadingStudents(false);
            return;
        }

        if (studentRelations.length === 0) {
            setStudents([]);
            setLoadingStudents(false);
            return;
        }

        const studentIds = studentRelations.map(r => r.student_id);
        const { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('*')
            .in('id', studentIds);
        
        if (profilesError) {
            showToast(`Error fetching student profiles: ${profilesError.message}`, 'error');
        } else {
            const studentData = studentRelations.map(rel => ({
                ...rel,
                profile: profiles.find(p => p.id === rel.student_id) as Profile,
            })).filter(s => s.profile); // Filter out any potential mismatches
            setStudents(studentData);
        }
        setLoadingStudents(false);
    };

    const handleCreateClassroom = async (name: string, classNum: number, subject: string) => {
        if (!user) return;
        
        let inviteCode = generateInviteCode();
        let codeExists = true;
        let attempts = 0;

        // Attempt to find a unique invite code
        while(codeExists && attempts < 5) {
            const { data } = await supabase.from('classrooms').select('id').eq('invite_code', inviteCode).single();
            if(!data) {
                codeExists = false;
            } else {
                inviteCode = generateInviteCode();
                attempts++;
            }
        }
        if (codeExists) {
            showToast("Could not generate a unique invite code. Please try again.", "error");
            return;
        }

        const { error } = await supabase.from('classrooms').insert({
            name,
            teacher_id: user.id,
            invite_code: inviteCode,
            class_details: { class: classNum, subject },
        });

        if (error) {
            showToast(`Error creating classroom: ${error.message}`, 'error');
        } else {
            showToast('Classroom created successfully!', 'success');
            fetchClassrooms();
            setCreateModalOpen(false);
        }
    };
    
    const handleDeleteClassroom = async (classroomId: string) => {
        if (window.confirm("Are you sure you want to delete this classroom? All student enrollments will be lost.")) {
            const { error } = await supabase.from('classrooms').delete().eq('id', classroomId);
            if(error) {
                showToast(`Error deleting classroom: ${error.message}`, 'error');
            } else {
                showToast('Classroom deleted.', 'success');
                fetchClassrooms();
            }
        }
    };

    const handleCopyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        showToast("Invite code copied to clipboard!", "success");
    };

    const handleAnswerSubmit = async (queryId: string, answerText: string) => {
        const { error } = await supabase
            .from('student_queries')
            .update({
                answer_text: answerText,
                status: 'answered',
                answered_at: new Date().toISOString()
            })
            .eq('id', queryId);
        
        if (error) {
            showToast(`Error submitting answer: ${error.message}`, 'error');
        } else {
            showToast("Answer submitted successfully!", 'success');
            onRefreshQueries();
            setAnsweringQuery(null);
        }
    };

    if (selectedClassroom) {
        const assignmentsForClassroom = assignments.filter(a => a.classroom_id === selectedClassroom.id);
        return <ClassroomDetailView 
                    classroom={selectedClassroom} 
                    students={students} 
                    isLoading={loadingStudents} 
                    onBack={() => setSelectedClassroom(null)} 
                    lang={lang} 
                    showToast={showToast} 
                    onAssignPaper={onAssignPaper} 
                    assignments={assignmentsForClassroom}
                    loadingAssignments={loadingAssignments}
                    onRefreshAssignments={fetchAssignments}
                />;
    }

    return (
        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between mb-4">
                    <h2 className="text-2xl font-bold font-serif-display text-slate-800">My Classrooms</h2>
                    <button
                        onClick={() => setCreateModalOpen(true)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-all"
                    >
                        <span className="text-lg">➕</span>
                        <span>Create</span>
                    </button>
                </div>

                {isLoading ? <p>Loading classrooms...</p> : classrooms.length > 0 ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {classrooms.map(c => (
                            <div key={c.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex flex-col">
                                <h3 className="font-bold text-lg text-slate-800">{c.name}</h3>
                                <p className="text-sm text-slate-500">Class {c.class_details?.class} - {c.class_details?.subject}</p>
                                <p className="text-sm text-slate-500">{c.student_count} student(s)</p>
                                
                                <div className="my-4 p-2 bg-slate-100 rounded-lg flex items-center justify-between">
                                    <span className="font-mono text-indigo-700 font-bold text-lg tracking-widest">{c.invite_code}</span>
                                    <button onClick={() => handleCopyCode(c.invite_code)} className="px-3 py-1 bg-slate-200 text-slate-700 text-xs font-semibold rounded-md hover:bg-slate-300">Copy</button>
                                </div>

                                <div className="mt-auto flex justify-end gap-3">
                                    <button onClick={() => handleDeleteClassroom(c.id)} className="text-sm font-semibold text-red-600 hover:text-red-800">Delete</button>
                                    <button onClick={() => handleViewClassroom(c)} className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">View Roster</button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-10 px-4 bg-white rounded-xl border border-dashed border-slate-300 text-slate-500">
                        <p>You haven't created any classrooms yet. Create one to get started!</p>
                    </div>
                )}
            </div>
            
            <StudentQueriesList
                queries={studentQueries}
                onAnswerQuery={setAnsweringQuery}
            />
            
            <Modal isOpen={isCreateModalOpen} onClose={() => setCreateModalOpen(false)} title="Create New Classroom">
                <CreateClassroomForm onSubmit={handleCreateClassroom} onCancel={() => setCreateModalOpen(false)} />
            </Modal>
            
            <AnswerQueryModal
                isOpen={!!answeringQuery}
                onClose={() => setAnsweringQuery(null)}
                onSubmit={handleAnswerSubmit}
                query={answeringQuery}
            />
        </div>
    );
};

const StudentQueriesList: React.FC<{ queries: StudentQuery[], onAnswerQuery: (query: StudentQuery) => void }> = ({ queries, onAnswerQuery }) => {
    const [activeTab, setActiveTab] = useState<'new' | 'answered'>('new');

    const { unanswered, answered } = useMemo(() => {
        const unanswered = queries.filter(q => q.status === 'asked');
        const answered = queries.filter(q => q.status === 'answered');
        return { unanswered, answered };
    }, [queries]);

    const queriesToShow = activeTab === 'new' ? unanswered : answered;

    return (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             <h2 className="text-2xl font-bold font-serif-display text-slate-800">Student Queries</h2>
            <div className="border-b border-slate-200 mb-4">
                <nav className="flex space-x-4">
                    <button onClick={() => setActiveTab('new')} className={`py-2 px-1 border-b-2 font-semibold flex items-center gap-2 ${activeTab === 'new' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                        New <span className="bg-indigo-100 text-indigo-600 text-xs font-bold px-2 py-0.5 rounded-full">{unanswered.length}</span>
                    </button>
                    <button onClick={() => setActiveTab('answered')} className={`py-2 px-1 border-b-2 font-semibold ${activeTab === 'answered' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                        Answered
                    </button>
                </nav>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {queriesToShow.length > 0 ? queriesToShow.map(q => (
                    <div key={q.id} className="p-3 bg-slate-50 rounded-lg border">
                        <div className="flex justify-between items-start">
                             <div className="flex items-start gap-3">
                                <img src={q.student_profile?.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${q.student_profile?.full_name}`} alt="avatar" className="h-10 w-10 rounded-full bg-slate-200" />
                                <div>
                                    <p className="font-semibold text-slate-800">{q.student_profile?.full_name}</p>
                                    <p className="text-xs text-slate-500">{q.classroom?.name} &middot; {new Date(q.created_at).toLocaleString()}</p>
                                </div>
                            </div>
                           {activeTab === 'new' && (
                                <button onClick={() => onAnswerQuery(q)} className="px-3 py-1 bg-indigo-600 text-white text-sm font-semibold rounded-md hover:bg-indigo-700">Answer</button>
                           )}
                        </div>
                        <p className="mt-2 text-slate-700 ml-13 pl-1">{q.query_text}</p>
                        {q.query_image_url && <img src={q.query_image_url} alt="Query" className="mt-2 ml-13 pl-1 max-w-xs rounded-md border" />}
                        {activeTab === 'answered' && q.answer_text && (
                            <div className="mt-2 ml-13 pl-1 pt-2 border-t border-slate-200">
                                <p className="text-sm font-semibold text-green-700">Your Answer:</p>
                                <p className="text-sm text-slate-600 whitespace-pre-wrap">{q.answer_text}</p>
                            </div>
                        )}
                    </div>
                )) : (
                     <p className="text-center text-slate-500 p-8">{activeTab === 'new' ? "No new questions from students." : "You haven't answered any questions yet."}</p>
                )}
            </div>
        </div>
    );
};

interface ClassroomDetailViewProps {
    classroom: Classroom;
    students: ClassroomStudent[];
    isLoading: boolean;
    onBack: () => void;
    lang: Language;
    showToast: (message: string, type?: 'success' | 'error') => void;
    onAssignPaper: (classroom: Classroom) => void;
    assignments: Assignment[];
    loadingAssignments: boolean;
    onRefreshAssignments: () => void;
}

const ClassroomDetailView: React.FC<ClassroomDetailViewProps> = ({ classroom, students, isLoading, onBack, lang, showToast, onAssignPaper, assignments, loadingAssignments, onRefreshAssignments }) => {

    const handleDeleteAssignment = async (assignmentId: string) => {
        if (window.confirm("Are you sure you want to cancel this assignment? This will remove it for all students.")) {
            const { error } = await supabase
                .from('assignments')
                .delete()
                .eq('id', assignmentId);

            if (error) {
                showToast(`Error canceling assignment: ${error.message}`, 'error');
            } else {
                showToast("Assignment canceled successfully.", 'success');
                // The subscription will handle the refresh
            }
        }
    };
    
    return (
        <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <button onClick={onBack} className="text-indigo-600 font-semibold mb-4 flex items-center">
                    &larr; Back to All Classrooms
                </button>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-2xl font-bold font-serif-display text-slate-800">{classroom.name}</h2>
                    <p className="text-slate-500">Student Roster</p>

                    <div className="mt-4">
                        {isLoading ? <p>Loading students...</p> : students.length > 0 ? (
                            <ul className="divide-y divide-slate-200 max-h-96 overflow-y-auto">
                                {students.map(s => (
                                    <li key={s.student_id} className="py-3 flex items-center">
                                        <img src={s.profile.avatar_url || `https://api.dicebear.com/8.x/initials/svg?seed=${s.profile.full_name}`} alt={s.profile.full_name} className="h-10 w-10 rounded-full object-cover mr-4" />
                                        <div>
                                            <p className="font-semibold text-slate-800">{s.profile.full_name}</p>
                                            <p className="text-xs text-slate-500">Joined on: {new Date(s.joined_at).toLocaleDateString()}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-center text-slate-500 p-8">No students have joined this classroom yet.</p>
                        )}
                    </div>
                </div>
            </div>
            <div>
                 <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mt-11">
                    <div className="flex justify-between items-center mb-1">
                        <h2 className="text-2xl font-bold font-serif-display text-slate-800">Assignments</h2>
                        <button 
                            onClick={() => onAssignPaper(classroom)}
                            className="flex items-center gap-2 px-3 py-2 bg-indigo-100 text-indigo-700 font-semibold rounded-lg hover:bg-indigo-200 transition-colors text-sm"
                        >
                           <span className="text-lg">➕</span> Assign New
                        </button>
                    </div>
                    <p className="text-slate-500">Papers assigned to this class.</p>
                    <div className="mt-4">
                        {loadingAssignments ? <p>Loading assignments...</p> : assignments.length > 0 ? (
                            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-2">
                                {assignments.map(assignment => (
                                    <div key={assignment.id} className="p-3 bg-slate-50 rounded-lg border">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-bold text-slate-800">{assignment.paper_snapshot.title}</h4>
                                                <p className="text-xs text-slate-500">Assigned on: {new Date(assignment.created_at).toLocaleDateString()}</p>
                                                {assignment.due_date && <p className="text-xs text-red-500 font-medium">Due: {new Date(assignment.due_date).toLocaleString()}</p>}
                                            </div>
                                            <div className="flex-shrink-0 ml-4">
                                                <button
                                                    onClick={() => handleDeleteAssignment(assignment.id)}
                                                    className="text-sm font-semibold text-red-600 hover:text-red-800"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                             <p className="text-center text-slate-500 p-8">No assignments for this classroom yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const CreateClassroomForm: React.FC<{ onSubmit: (name: string, classNum: number, subject: string) => void, onCancel: () => void }> = ({ onSubmit, onCancel }) => {
    const [name, setName] = useState('');
    const [classNum, setClassNum] = useState(10);
    const [subject, setSubject] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name && subject) {
            onSubmit(name, classNum, subject);
        }
    };
    const inputStyles = "mt-1 block w-full rounded-lg border-slate-300 bg-slate-50 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm transition";

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-slate-600">Classroom Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required className={inputStyles} placeholder="e.g., Class 10 Biology" />
            </div>
            <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium text-slate-600">Class</label>
                    <select value={classNum} onChange={e => setClassNum(parseInt(e.target.value))} className={inputStyles}>
                        {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                 <div>
                    <label className="block text-sm font-medium text-slate-600">Subject</label>
                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required className={inputStyles} placeholder="e.g., Life Science" />
                </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-200 text-slate-800 rounded-lg hover:bg-slate-300 font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold shadow-sm transition-all">Create</button>
            </div>
        </form>
    );
};


export default ClassroomComponent;
