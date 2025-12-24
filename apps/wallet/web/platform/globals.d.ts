/**
 * Global type declarations for cross-platform compatibility
 */

import type { EIP1193Param } from './chrome-types'
import type { Address, Hex } from 'viem'

/** Safari extension message user info */
interface SafariMessageUserInfo {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | SafariMessageUserInfo
    | SafariMessageUserInfo[]
}

/** Tauri API interface (minimal type for detection) */
interface TauriAPI {
  invoke: (
    cmd: string,
    args?: Record<string, string | number | boolean>,
  ) => Promise<string | number | boolean | null>
}

/** Popup parameters passed to extension popup */
interface PopupParams {
  path?: string
  data?: Record<string, EIP1193Param>
  requestId?: string
}

/** Popup response data */
interface PopupResponseData {
  hash?: Hex
  signature?: Hex
  intentId?: Hex
  accounts?: Address[]
}

declare global {
  const chrome: typeof import('./chrome-types').chrome | undefined
  const browser: typeof import('./chrome-types').browser | undefined

  // Safari Web Extension API
  const safari:
    | {
        extension?: {
          dispatchMessage?: (
            name: string,
            userInfo?: SafariMessageUserInfo,
          ) => void
          getBaseURI?: () => string
        }
        application?: {
          activeBrowserWindow?: {
            activeTab?: {
              page?: {
                dispatchMessage?: (
                  name: string,
                  userInfo?: SafariMessageUserInfo,
                ) => void
              }
            }
          }
        }
      }
    | undefined

  interface Window {
    __TAURI__?: TauriAPI
    Capacitor?: { getPlatform?: () => string }
    jeju?: import('../extension/content/injected').NetworkProvider
    __POPUP_PARAMS__?: PopupParams
    __SEND_POPUP_RESPONSE__?: (
      requestId: string,
      approved: boolean,
      data?: PopupResponseData,
    ) => void
  }

  // Brave browser detection
  interface Navigator {
    brave?: {
      isBrave: () => Promise<boolean>
    }
  }
}
