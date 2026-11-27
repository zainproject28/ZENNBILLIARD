import { useCallback, useEffect, useState } from 'react';

export function isFullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.fullscreenEnabled ||
      (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled,
  );
}

export async function toggleDocumentFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const docAny = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  const elAny = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  const currentlyFullscreen = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
  try {
    if (currentlyFullscreen) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (docAny.webkitExitFullscreen) {
        await docAny.webkitExitFullscreen();
      }
      return false;
    }
    if (elAny.requestFullscreen) {
      await elAny.requestFullscreen();
      return true;
    }
    if (elAny.webkitRequestFullscreen) {
      await elAny.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Graceful no-op if browser or iframe denies fullscreen permission
  }
  return currentlyFullscreen;
}

export function useFullscreenState() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false;
    const docAny = document as Document & { webkitFullscreenElement?: Element | null };
    return Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
  });

  useEffect(() => {
    const sync = () => {
      const docAny = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement || docAny.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const next = await toggleDocumentFullscreen();
    setIsFullscreen(next);
  }, []);

  return { isFullscreen, toggleFullscreen };
}
