import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/** Minimaler Wrapper um die YouTube IFrame Player API */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;
function loadApi(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
  }
  return apiPromise;
}

export interface PlayerHandle {
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(sec: number, play?: boolean): void;
  pause(): void;
}

export const YouTubePlayer = forwardRef<PlayerHandle, { videoId: string; onReady?: (duration: number) => void; onTime?: (sec: number) => void }>(
  function YouTubePlayer({ videoId, onReady, onTime }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const player = useRef<any>(null);
    const callbacks = useRef({ onReady, onTime });
    callbacks.current = { onReady, onTime };

    useImperativeHandle(ref, () => ({
      getCurrentTime: () => player.current?.getCurrentTime?.() ?? 0,
      getDuration: () => player.current?.getDuration?.() ?? 0,
      seekTo: (sec, play) => {
        player.current?.seekTo?.(sec, true);
        if (play) player.current?.playVideo?.();
      },
      pause: () => player.current?.pauseVideo?.(),
    }));

    useEffect(() => {
      let cancelled = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      void loadApi().then((YT) => {
        if (cancelled || !host.current) return;
        const el = document.createElement('div');
        host.current.innerHTML = '';
        host.current.appendChild(el);
        player.current = new YT.Player(el, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1 },
          events: {
            onReady: (e: any) => callbacks.current.onReady?.(e.target.getDuration()),
          },
        });
        timer = setInterval(() => {
          const t = player.current?.getCurrentTime?.();
          if (typeof t === 'number') callbacks.current.onTime?.(t);
        }, 250);
      });
      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
        player.current?.destroy?.();
        player.current = null;
      };
    }, [videoId]);

    return <div className="video-wrap" ref={host} />;
  },
);
