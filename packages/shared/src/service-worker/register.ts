/**
 * Service Worker Registration Helper
 * Use this in your app's main entry point to register the service worker
 */

export interface SWRegistrationOptions {
  scope?: string;
  updateViaCache?: ServiceWorkerUpdateViaCache;
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  onOfflineReady?: () => void;
}

export async function registerServiceWorker(
  swUrl: string,
  options: SWRegistrationOptions = {}
): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported');
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: options.scope ?? '/',
      updateViaCache: options.updateViaCache ?? 'none',
    });

    registration.onupdatefound = () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.onstatechange = () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // New content available
            console.log('[SW] New content available');
            options.onUpdate?.(registration);
          } else {
            // Content cached for offline
            console.log('[SW] Content cached for offline use');
            options.onSuccess?.(registration);
            options.onOfflineReady?.();
          }
        }
      };
    };

    console.log('[SW] Service worker registered');
    return registration;
  } catch (error) {
    console.error('[SW] Registration failed:', error);
    return undefined;
  }
}

export async function unregisterServiceWorker(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    return registration.unregister();
  } catch {
    return false;
  }
}

export async function checkForUpdates(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  } catch (error) {
    console.error('[SW] Update check failed:', error);
  }
}

export function sendMessageToSW(message: Record<string, unknown>): void {
  if (!navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage(message);
}

export function skipWaiting(): void {
  sendMessageToSW({ type: 'SKIP_WAITING' });
}

export function cacheUrls(urls: string[]): void {
  sendMessageToSW({ type: 'CACHE_URLS', urls });
}

export function clearCache(): void {
  sendMessageToSW({ type: 'CLEAR_CACHE' });
}

