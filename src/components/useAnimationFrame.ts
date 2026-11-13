import { useEffect, useRef } from 'react';

/**
 * Runs `callback` every animation frame, and fully cancels the loop while the tab is
 * hidden so a backgrounded simulation costs no CPU or battery. `dt` excludes hidden time.
 */
export function useAnimationFrame(callback: (now: number, dt: number) => void): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      cbRef.current(now, dt);
    };
    const start = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
