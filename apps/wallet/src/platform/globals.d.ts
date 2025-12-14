/**
 * Global type declarations for cross-platform compatibility
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  const chrome: typeof import('./chrome-types').chrome | undefined;
  const browser: typeof import('./chrome-types').browser | undefined;
  
  interface Window {
    __TAURI__?: unknown;
    Capacitor?: { getPlatform?: () => string };
    jeju?: unknown;
    __POPUP_PARAMS__?: {
      path?: string;
      data?: Record<string, unknown>;
      requestId?: string;
    };
    __SEND_POPUP_RESPONSE__?: (requestId: string, approved: boolean, data?: Record<string, unknown>) => void;
  }
}

export {};

