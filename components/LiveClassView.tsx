import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Classroom } from '../types';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface LiveClassViewProps {
    classroom: Classroom;
    onEndSession: () => void;
}

const LiveClassView: React.FC<LiveClassViewProps> = ({ classroom, onEndSession }) => {
    const { profile, user } = useAuth();
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
    const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
    const localVideoRef = useRef<HTMLVideoElement>(null);

    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
    const isTeacher = profile?.role === 'teacher';

    const setupStream = useCallback(async (): Promise<MediaStream | null> => {
        setConnectionStatus('connecting');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for UX
            
            setLocalStream(stream);
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            setConnectionStatus('connected');
            return stream;
        } catch (error) {
            console.error("Error accessing media devices.", error);
            alert("Could not access camera and microphone. Please check permissions.");
            setConnectionStatus('error');
            return null;
        }
    }, []);

    useEffect(() => {
        let stream: MediaStream | null = null;
        const channel = supabase.channel(`live-class-${classroom.id}`, {
            config: {
                presence: {
                    key: user?.id,
                },
            },
        });

        const initialize = async () => {
            stream = await setupStream();

            // TODO: Implement full WebRTC signaling logic here
            // This includes creating peer connections, exchanging offers, answers, and ICE candidates.
            // For now, this is a placeholder to show the UI and basic flow.

            channel.on('presence', { event: 'join' }, ({ newPresences }) => {
                console.log('New users joined:', newPresences);
                // In a full implementation, you would initiate a peer connection here
            });

            channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
                console.log('Users left:', leftPresences);
                // In a full implementation, you would clean up peer connections here
            });

            channel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ user_id: user?.id, name: profile?.full_name });
                }
            });
        };

        initialize();

        return () => {
            stream?.getTracks().forEach(track => track.stop());
            // FIX: Cast peer connection to RTCPeerConnection before calling 'close' to resolve type inference issue where 'pc' was treated as 'unknown'.
            Object.values(peerConnections.current).forEach(pc => (pc as RTCPeerConnection).close());
            supabase.removeChannel(channel);
        };
    }, [classroom.id, user?.id, profile?.full_name, setupStream]);

    const handleToggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(prev => !prev);
        }
    };

    const handleToggleVideo = () => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsVideoOff(prev => !prev);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-slate-800 text-white flex flex-col p-4 z-50">
            <header className="flex justify-between items-center flex-shrink-0">
                <h2 className="text-xl font-bold">{classroom.name} - Live Session</h2>
                <div>
                    {connectionStatus === 'connecting' && (
                        <span className="px-3 py-1 text-sm font-semibold text-red-800 bg-red-200 rounded-full flex items-center">
                            <span className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></span>
                            Connecting...
                        </span>
                    )}
                    {connectionStatus === 'connected' && (
                        <span className="px-3 py-1 text-sm font-semibold text-green-800 bg-green-200 rounded-full flex items-center">
                            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
                            Live
                        </span>
                    )}
                    {connectionStatus === 'error' && (
                        <span className="px-3 py-1 text-sm font-semibold text-red-800 bg-red-200 rounded-full">Error</span>
                    )}
                </div>
            </header>

            <main className="flex-grow my-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
                {/* Local Video */}
                <div className="relative bg-black rounded-lg overflow-hidden aspect-video border-2 border-indigo-500">
                    <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]"></video>
                    <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded-md text-sm font-semibold">
                        {profile?.full_name} (You)
                    </div>
                </div>

                {/* Placeholder for Remote Videos */}
                {Object.entries(remoteStreams).map(([userId, stream]) => (
                    <div key={userId} className="relative bg-black rounded-lg overflow-hidden aspect-video">
                         <video 
                             autoPlay 
                             playsInline 
                             className="w-full h-full object-cover"
                             ref={video => { if (video) video.srcObject = stream; }}
                         ></video>
                         <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 rounded-md text-sm">
                             Remote User
                         </div>
                    </div>
                ))}
            </main>

            <footer className="flex-shrink-0 flex justify-center items-center gap-4 bg-slate-900/50 p-3 rounded-xl">
                <button onClick={handleToggleMute} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500' : 'bg-slate-600 hover:bg-slate-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMuted ? "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" : "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"} /></svg>
                </button>
                <button onClick={handleToggleVideo} className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500' : 'bg-slate-600 hover:bg-slate-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isVideoOff ? "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" : "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"} /></svg>
                </button>
                 <button onClick={onEndSession} className="px-8 py-4 bg-red-600 rounded-full font-semibold text-lg hover:bg-red-700 transition-colors">
                    {isTeacher ? 'End Call' : 'Leave'}
                </button>
            </footer>
        </div>
    );
};

export default LiveClassView;