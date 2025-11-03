import React, { useRef, useEffect, useImperativeHandle, useState } from 'react';

interface DrawingCanvasProps {
  width?: number;
  height?: number;
}

export interface DrawingCanvasRef {
  clearCanvas: () => void;
  getCanvasDataURL: () => string;
}

const DrawingCanvas = React.forwardRef<DrawingCanvasRef, DrawingCanvasProps>(({ width = 500, height = 500 }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [lineWidth, setLineWidth] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Adjust for device pixel ratio for sharper drawing
    const scale = window.devicePixelRatio;
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);

    const context = canvas.getContext('2d');
    if (!context) return;
    
    context.scale(scale, scale);
    context.lineCap = 'round';
    context.strokeStyle = 'black';
    context.lineWidth = lineWidth;
    contextRef.current = context;
  }, [width, height, lineWidth]);

  useEffect(() => {
    if (contextRef.current) {
        contextRef.current.lineWidth = lineWidth;
    }
  }, [lineWidth]);

  const startDrawing = (event: React.MouseEvent | React.TouchEvent) => {
    const { offsetX, offsetY } = getCoords(event);
    if (!contextRef.current) return;
    contextRef.current.beginPath();
    contextRef.current.moveTo(offsetX, offsetY);
    setIsDrawing(true);
  };

  const finishDrawing = () => {
    if (!contextRef.current) return;
    contextRef.current.closePath();
    setIsDrawing(false);
  };

  const draw = (event: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !contextRef.current) return;
    event.preventDefault(); // Prevents scrolling on touch devices while drawing
    const { offsetX, offsetY } = getCoords(event);
    contextRef.current.lineTo(offsetX, offsetY);
    
    if(tool === 'pen') {
        contextRef.current.globalCompositeOperation = 'source-over';
        contextRef.current.strokeStyle = 'black';
    } else { // eraser
        contextRef.current.globalCompositeOperation = 'destination-out';
    }

    contextRef.current.stroke();
  };
  
  const getCoords = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if(!canvas) return { offsetX: 0, offsetY: 0 };
    
    let clientX, clientY;
    if ('touches' in event.nativeEvent) {
      clientX = event.nativeEvent.touches[0].clientX;
      clientY = event.nativeEvent.touches[0].clientY;
    } else {
      clientX = (event.nativeEvent as MouseEvent).clientX;
      clientY = (event.nativeEvent as MouseEvent).clientY;
    }

    const rect = canvas.getBoundingClientRect();
    return {
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top
    };
  }

  useImperativeHandle(ref, () => ({
    clearCanvas: () => {
      const canvas = canvasRef.current;
      const context = contextRef.current;
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
    getCanvasDataURL: () => {
      const canvas = canvasRef.current;
      return canvas ? canvas.toDataURL('image/png') : '';
    },
  }));

  return (
    <div className="touch-none flex flex-col items-center">
      <div className="flex flex-wrap justify-center items-center gap-4 mb-4">
        <button onClick={() => setTool('pen')} className={`px-3 py-2 text-sm font-semibold rounded-lg border-2 flex items-center gap-2 ${tool === 'pen' ? 'border-indigo-500 bg-indigo-100 text-indigo-700' : 'border-slate-300 bg-white'}`}>✏️ Pen</button>
        <button onClick={() => setTool('eraser')} className={`px-3 py-2 text-sm font-semibold rounded-lg border-2 flex items-center gap-2 ${tool === 'eraser' ? 'border-indigo-500 bg-indigo-100 text-indigo-700' : 'border-slate-300 bg-white'}`}>🧼 Eraser</button>
        <div className="flex items-center gap-2">
            <label htmlFor="lineWidth" className="text-sm font-medium text-slate-600">Size:</label>
            <input 
                id="lineWidth"
                type="range" 
                min="1" 
                max="20" 
                value={lineWidth} 
                onChange={e => setLineWidth(Number(e.target.value))} 
                className="w-24"
            />
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onMouseDown={startDrawing}
        onMouseUp={finishDrawing}
        onMouseMove={draw}
        onMouseLeave={finishDrawing}
        onTouchStart={startDrawing}
        onTouchEnd={finishDrawing}
        onTouchMove={draw}
        className="bg-white border-2 border-slate-300 rounded-lg shadow-inner w-full h-auto"
        style={{ width: `${width}px`, height: `${height}px` }}
      />
    </div>
  );
});

export default DrawingCanvas;
