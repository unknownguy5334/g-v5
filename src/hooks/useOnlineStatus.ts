import { useState, useEffect, useCallback } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  ocrServiceAvailable: boolean;
  refreshConnectivity: () => Promise<boolean>;
}

/**
 * Hook to track browser online/offline status cleanly using standard network events.
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      return typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    }
    return true;
  });
  const [ocrServiceAvailable, setOcrServiceAvailable] = useState(true);

  const refreshConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined') {
      const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
      setIsOnline(online);
      setOcrServiceAvailable(online);
      return online;
    }
    return true;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setIsOnline(true);
      setOcrServiceAvailable(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOcrServiceAvailable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, ocrServiceAvailable, refreshConnectivity };
}

