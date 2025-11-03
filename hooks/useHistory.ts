import { useState, useCallback } from 'react';

// A custom hook to manage state history for undo/redo functionality.
export const useHistory = <T,>(initialState: T) => {
  const [history, setHistory] = useState<{ past: T[], present: T, future: T[] }>({
    past: [],
    present: initialState,
    future: [],
  });

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // Set a new state, pushing the current state to the past.
  const set = useCallback((newState: T) => {
    setHistory(currentHistory => {
      // Avoid adding duplicate states to the history.
      if (JSON.stringify(newState) === JSON.stringify(currentHistory.present)) {
        return currentHistory;
      }
      return {
        past: [...currentHistory.past, currentHistory.present],
        present: newState,
        future: [], // Clear future on new state change.
      };
    });
  }, []);

  // Revert to the previous state.
  const undo = useCallback(() => {
    if (!canUndo) return;
    setHistory(currentHistory => {
      const previous = currentHistory.past[currentHistory.past.length - 1];
      const newPast = currentHistory.past.slice(0, currentHistory.past.length - 1);
      return {
        past: newPast,
        present: previous,
        future: [currentHistory.present, ...currentHistory.future],
      };
    });
  }, [canUndo]);

  // Re-apply a state that was undone.
  const redo = useCallback(() => {
    if (!canRedo) return;
    setHistory(currentHistory => {
      const next = currentHistory.future[0];
      const newFuture = currentHistory.future.slice(1);
      return {
        past: [...currentHistory.past, currentHistory.present],
        present: next,
        future: newFuture,
      };
    });
  }, [canRedo]);
  
  // Reset the history with a new initial state.
  const reset = useCallback((newState: T) => {
    setHistory({
        past: [],
        present: newState,
        future: [],
    });
  }, []);

  return { state: history.present, set, undo, redo, canUndo, canRedo, reset };
};
