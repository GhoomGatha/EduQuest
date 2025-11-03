import React, { useRef, useState, useEffect } from 'react';
import Modal from '../Modal';
import DrawingCanvas, { DrawingCanvasRef } from './DrawingCanvas';

interface DrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (dataUrl: string) => void;
  diagramName: string;
}

const DrawingModal: React.FC<DrawingModalProps> = ({ isOpen, onClose, onSubmit, diagramName }) => {
  const canvasRef = useRef<DrawingCanvasRef>(null);
  const [containerSize, setContainerSize] = useState({ width: 500, height: 500 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        // -48 for modal padding (p-6 = 24px left/right)
        const maxWidth = containerRef.current.clientWidth - 48; 
        const maxHeight = window.innerHeight * 0.6;
        const size = Math.min(maxWidth, maxHeight, 500); // Capped at 500px
        setContainerSize({ width: size, height: size });
      }
    };

    if (isOpen) {
      // Set size after modal is rendered to get container dimensions
      setTimeout(updateSize, 100);
      window.addEventListener('resize', updateSize);
    }
    
    return () => window.removeEventListener('resize', updateSize);
  }, [isOpen]);

  const handleSubmit = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.getCanvasDataURL();
      onSubmit(dataUrl);
    }
  };

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clearCanvas();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Draw: ${diagramName}`}>
      <div ref={containerRef}>
        <p className="text-sm text-center text-slate-600 mb-4">Draw the diagram in the space below. Use the tools to help you.</p>
        <div className="flex justify-center">
            <DrawingCanvas ref={canvasRef} width={containerSize.width} height={containerSize.height} />
        </div>
        <div className="flex justify-between items-center mt-6">
            <button onClick={handleClear} className="px-5 py-2.5 font-semibold text-slate-700 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors">
                Clear
            </button>
            <button onClick={handleSubmit} className="px-5 py-2.5 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-all">
                Submit for Grading
            </button>
        </div>
      </div>
    </Modal>
  );
};

export default DrawingModal;
