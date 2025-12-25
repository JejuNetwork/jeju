/**
 * Chrome extension API type stubs
 */

import type { Address, Hex } from 'viem'

// Re-export EIP-1193 types from extension/types
export type { EIP1193Param, EIP1193ParamObject } from '../../extension/types'

import type { EIP1193Param } from '../../extension/types'

export interface ChromeMessageSender {
  id?: string
  url?: string
  origin?: string
  tab?: { id?: number; url?: string }
  frameId?: number
}

export interface ChromeMessage {
  type: string
  data?: Record<string, EIP1193Param>
  id?: string
}

/** Possible responses from extension message handlers */
export type ChromeMessageResponse =
  | string
  | string[]
  | Address[]
  | Hex
  | boolean
  | null
  | { error: string }
  | { chainId: Hex }
  | { accounts: Address[] }

export type ChromeMessageCallback = (
  message: ChromeMessage,
  sender: ChromeMessageSender,
  sendResponse: (response: ChromeMessageResponse) => void,
) => boolean | undefined

export interface ChromeStorageResult {
  [key: string]: EIP1193Param
}

export interface ChromeTabsQueryInfo {
  active?: boolean
  currentWindow?: boolean
  url?: string | string[]
}

export interface ChromeTab {
  id?: number
  url?: string
  title?: string
}

export interface ChromeWindowOptions {
  url?: string
  type?: 'normal' | 'popup' | 'panel'
  width?: number
  height?: number
  focused?: boolean
}

export interface ChromeWindow {
  id?: number
  focused: boolean
}

export interface ChromeAlarmOptions {
  when?: number
  delayInMinutes?: number
  periodInMinutes?: number
}

/** Stub implementation for non-extension environments */
function noop(): void {
  // Stub implementation - no-op
}

export const chrome = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: ChromeMessageCallback): void => noop(),
      removeListener: (_callback: ChromeMessageCallback): void => noop(),
    },
    sendMessage: async (
      _message: ChromeMessage,
    ): Promise<ChromeMessageResponse> => null,
    getURL: (_path: string): string => '',
  },
  storage: {
    local: {
      get: (
        _key: string | string[] | null,
        _callback: (result: ChromeStorageResult) => void,
      ): void => noop(),
      set: (
        _items: Record<string, EIP1193Param>,
        _callback?: () => void,
      ): void => noop(),
      remove: (_key: string | string[], _callback?: () => void): void => noop(),
      clear: (_callback?: () => void): void => noop(),
    },
  },
  tabs: {
    query: (
      _queryInfo: ChromeTabsQueryInfo,
      _callback: (tabs: ChromeTab[]) => void,
    ): void => noop(),
    sendMessage: async (
      _tabId: number,
      _message: ChromeMessage,
    ): Promise<ChromeMessageResponse> => null,
  },
  windows: {
    create: async (_options: ChromeWindowOptions): Promise<ChromeWindow> => ({
      focused: false,
    }),
  },
  alarms: {
    create: (_name: string, _options: ChromeAlarmOptions): void => noop(),
    onAlarm: {
      addListener: (_callback: () => void): void => noop(),
    },
  },
}

export const browser = {
  runtime: {
    id: '' as string | undefined,
    onMessage: {
      addListener: (_callback: (message: ChromeMessage) => void): void =>
        noop(),
    },
  },
}
