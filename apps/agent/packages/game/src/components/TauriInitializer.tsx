import { useEffect, useState } from 'react';
import { TauriService } from '../services/TauriService';

interface TauriInitializerProps {
  children: React.ReactNode;
}

/**
 * Component that ensures Tauri API is initialized before rendering children
 * This solves the timing issue where TauriService tries to detect Tauri before it's available
 */
export function TauriInitializer({ children }: TauriInitializerProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [shutdownMessage, setShutdownMessage] = useState('Stopping containers...');

  useEffect(() => {
    const initializeTauri = async () => {
      try {
        console.log('[TauriInitializer] Starting Tauri initialization...');

        // Wait a bit to ensure window is fully loaded
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Initialize TauriService
        await TauriService.initialize();

        const isTauri = TauriService.isRunningInTauri();
        console.log('[TauriInitializer] Tauri initialized, running in Tauri:', isTauri);

        // Set up shutdown event listener
        if (isTauri && (window as any).__TAURI__) {
          const { event } = (window as any).__TAURI__;

          // Listen for shutdown request
          const unlistenShutdown = await event.listen('request-shutdown', async () => {
            console.log('[TauriInitializer] Shutdown requested, initiating graceful shutdown...');
            setIsShuttingDown(true);
            try {
              await TauriService.shutdownApplication();
            } catch (err) {
              console.error('[TauriInitializer] Failed to shutdown application:', err);
              // Force quit if graceful shutdown fails
              if ((window as any).__TAURI__?.window?.appWindow) {
                await (window as any).__TAURI__.window.appWindow.close();
              }
            }
          });

          // Listen for shutdown progress
          const unlistenProgress = await event.listen('shutdown-progress', (evt: any) => {
            console.log('[TauriInitializer] Shutdown progress:', evt.payload);
            setShutdownMessage(evt.payload);
          });

          // Store unlisten functions for cleanup
          (window as any).__shutdownUnlisten = unlistenShutdown;
          (window as any).__progressUnlisten = unlistenProgress;
        }

        setIsInitialized(true);
      } catch (err) {
        console.error('[TauriInitializer] Failed to initialize Tauri:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize Tauri');
        // Still mark as initialized to allow the app to continue
        setIsInitialized(true);
      }
    };

    // Use a timeout to ensure we're not blocking on window load
    const timeoutId = setTimeout(initializeTauri, 0);

    return () => {
      clearTimeout(timeoutId);
      // Clean up shutdown listener if it exists
      if ((window as any).__shutdownUnlisten) {
        (window as any).__shutdownUnlisten();
      }
      if ((window as any).__progressUnlisten) {
        (window as any).__progressUnlisten();
      }
    };
  }, []);

  if (!isInitialized) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#0a0a0a',
          color: '#00ff00',
          fontFamily: 'monospace',
        }}
      >
        <div>Initializing Tauri environment...</div>
      </div>
    );
  }

  if (error) {
    console.warn('[TauriInitializer] Continuing with error:', error);
  }

  // Show shutdown UI when shutting down
  if (isShuttingDown) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#1a1a1a',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Shutting Down ElizaOS</h2>
          <p style={{ fontSize: '16px', color: '#cccccc', marginBottom: '20px' }}>
            {shutdownMessage}
          </p>
          <div
            style={{
              border: '3px solid #333333',
              borderTop: '3px solid #ffffff',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              animation: 'spin 1s linear infinite',
              margin: '0 auto',
            }}
          />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
