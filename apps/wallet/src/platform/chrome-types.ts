/**
 * Chrome extension API type stubs
 */

// Chrome API Types
export interface ChromeMessageSender {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number; url?: string };
  frameId?: number;
}

export interface ChromeMessage {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
}

export type ChromeMessageCallback = (
  message: ChromeMessage,
  sender: ChromeMessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void;

export interface ChromeStorageResult {
  [key: string]: unknown;
}

export interface ChromeTabsQueryInfo {
  active?: boolean;
  currentWindow?: boolean;
  url?: string | string[];
}

export interface ChromeTab {
  id?: number;
  url?: string;
  title?: string;
}

export interface ChromeWindowOptions {
  url?: string;
  type?: 'normal' | 'popup' | 'panel';
  width?: number;
  height?: number;
  focused?: boolean;
}

export interface ChromeWindow {
  id?: number;
  focused: boolean;
}

export interface ChromeAlarmOptions {
  when?: number;
  delayInMinutes?: number;
  periodInMinutes?: number;
}

export const chrome = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: ChromeMessageCallback) => {},
      removeListener: (_callback: ChromeMessageCallback) => {},
    },
    sendMessage: async (_message: ChromeMessage): Promise<unknown> => { return undefined; },
    getURL: (_path: string): string => '',
  },
  storage: {
    local: {
      get: (_key: string | string[] | null, _callback: (result: ChromeStorageResult) => void) => {},
      set: (_items: Record<string, unknown>, _callback?: () => void) => {},
      remove: (_key: string | string[], _callback?: () => void) => {},
      clear: (_callback?: () => void) => {},
    },
  },
  tabs: {
    query: (_queryInfo: ChromeTabsQueryInfo, _callback: (tabs: ChromeTab[]) => void) => {},
    sendMessage: async (_tabId: number, _message: ChromeMessage): Promise<unknown> => { return undefined; },
  },
  windows: {
    create: async (_options: ChromeWindowOptions): Promise<ChromeWindow> => ({ focused: false }),
  },
  alarms: {
    create: (_name: string, _options: ChromeAlarmOptions) => {},
    onAlarm: {
      addListener: (_callback: () => void) => {},
    },
  },
};

export const browser = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: (message: ChromeMessage) => void) => {},
    },
  },
};

