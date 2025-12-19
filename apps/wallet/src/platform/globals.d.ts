/**
 * Global type declarations for cross-platform compatibility
 */

declare global {
  const chrome: typeof import('./chrome-types').chrome | undefined;
  const browser: typeof import('./chrome-types').browser | undefined;
  
  // Safari Web Extension API
  const safari: {
    extension?: {
      dispatchMessage?: (name: string, userInfo?: Record<string, unknown>) => void;
      getBaseURI?: () => string;
    };
    application?: {
      activeBrowserWindow?: {
        activeTab?: {
          page?: {
            dispatchMessage?: (name: string, userInfo?: Record<string, unknown>) => void;
          };
        };
      };
    };
  } | undefined;
  
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
  
  // Brave browser detection
  interface Navigator {
    brave?: {
      isBrave: () => Promise<boolean>;
    };
  }
}

export {};

