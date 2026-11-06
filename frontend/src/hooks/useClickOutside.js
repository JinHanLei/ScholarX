import { useEffect } from 'react';

function useClickOutside(ref, enabled, onOutside) {
  useEffect(() => {
    if (!enabled) return undefined;
    function handlePointerDown(event) {
      const refs = Array.isArray(ref) ? ref : [ref];
      if (refs.some((item) => item.current?.contains(event.target))) return;
      onOutside();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [enabled, onOutside, ref]);
}

export default useClickOutside;
