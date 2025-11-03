
import React, { useRef, useEffect, useState, useCallback } from 'react';
import Modal from './Modal';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

const SwitchCameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9a9 9 0 0114.13-6.364M20 15a9 9 0 01-14.13 6.364" />
    </svg>
);

const CameraModal: React.FC<CameraModalProps> = ({ isOpen, onClose, onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  useEffect(() => {
    const checkCameras = async () => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      }
    };
    checkCameras();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      return;
    }

    let isCancelled = false;

    const startCamera = async () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      try {
        setError(null);
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facingMode }
        });
        
        if (isCancelled) {
          mediaStream.getTracks().forEach(track => track.stop());
        } else {
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        }
      } catch (err) {
        if (!isCancelled) {
          console.error(`Error accessing ${facingMode} camera:`, err);
          setError("Could not access the camera. Please check your browser permissions.");
        }
      }
    };

    startCamera();

    return () => {
      isCancelled = true;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    };
  }, [isOpen, facingMode]);


  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          if (blob) {
            const file = new File([blob], "capture.png", { type: "image/png" });
            onCapture(file);
          }
        }, 'image/png');
      }
    }
  };
  
  const handleSwitchCamera = () => {
    setFacingMode(prev => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Take a Photo">
      <div className="flex flex-col items-center">
        {error ? (
          <p className="text-red-500 bg-red-100 p-4 rounded-lg">{error}</p>
        ) : (
          <>
            <div className="relative w-full max-w-md bg-black rounded-lg overflow-hidden">
                <video ref={videoRef} autoPlay playsInline className="w-full h-auto" />
                <div className="absolute inset-0 border-4 border-white/30 rounded-lg pointer-events-none"></div>
                {hasMultipleCameras && (
                    <button onClick={handleSwitchCamera} className="absolute bottom-4 right-4 bg-black/50 text-white p-2 rounded-full hover:bg-black/75 transition-colors" aria-label="Switch camera">
                       <SwitchCameraIcon />
                    </button>
                )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <button
              onClick={handleCapture}
              disabled={!stream}
              className="mt-4 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-full shadow-lg hover:bg-indigo-700 disabled:bg-indigo-400 transition-all transform hover:scale-105"
            >
              Capture
            </button>
          </>
        )}
      </div>
    </Modal>
  );
};

export default CameraModal;
