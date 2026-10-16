import { useCallback, useState } from 'react';

const LIMIT = 100;

// Estado con deshacer/rehacer. set(updater, record): record=false actualiza sin crear un paso nuevo
// (se usa mientras se arrastra, para que todo el arrastre sea un solo paso de deshacer).
export function useHistory(initial) {
  const [history, setHistory] = useState({ past: [], present: initial, future: [] });

  const set = useCallback((updater, record = true) => {
    setHistory((h) => {
      const next = typeof updater === 'function' ? updater(h.present) : updater;
      if (next === h.present) return h;
      if (!record) return { ...h, present: next };
      return { past: [...h.past.slice(-LIMIT + 1), h.present], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    });
  }, []);

  const reset = useCallback((state) => setHistory({ past: [], present: state, future: [] }), []);

  return {
    state: history.present,
    set,
    undo,
    redo,
    reset,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
