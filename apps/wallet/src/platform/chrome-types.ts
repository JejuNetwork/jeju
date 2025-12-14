/**
 * Chrome extension API type stubs
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const chrome = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: (message: any, sender: any, sendResponse: any) => void) => {},
      removeListener: (_callback: (message: any, sender: any, sendResponse: any) => void) => {},
    },
    sendMessage: async (_message: any): Promise<any> => {},
    getURL: (_path: string): string => '',
  },
  storage: {
    local: {
      get: (_key: string | string[] | null, _callback: (result: any) => void) => {},
      set: (_items: any, _callback?: () => void) => {},
      remove: (_key: string | string[], _callback?: () => void) => {},
      clear: (_callback?: () => void) => {},
    },
  },
  tabs: {
    query: (_queryInfo: any, _callback: (tabs: Array<{ id?: number }>) => void) => {},
    sendMessage: async (_tabId: number, _message: any): Promise<any> => {},
  },
  windows: {
    create: async (_options: any): Promise<any> => {},
  },
  alarms: {
    create: (_name: string, _options: any) => {},
    onAlarm: {
      addListener: (_callback: () => void) => {},
    },
  },
};

export const browser = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: (message: any) => void) => {},
    },
  },
};

