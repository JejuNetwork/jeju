/**
 * Shared Miniapp SDK
 *
 * Provides utilities for building miniapps for Telegram and Farcaster.
 */

// Telegram WebApp types
export interface TelegramWebApp {
  ready: () => void
  expand: () => void
  close: () => void
  enableClosingConfirmation: () => void
  disableClosingConfirmation: () => void
  MainButton: {
    text: string
    color: string
    textColor: string
    isVisible: boolean
    isActive: boolean
    isProgressVisible: boolean
    show: () => void
    hide: () => void
    enable: () => void
    disable: () => void
    showProgress: (leaveActive?: boolean) => void
    hideProgress: () => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
    setText: (text: string) => void
    setParams: (params: {
      text?: string
      color?: string
      text_color?: string
    }) => void
  }
  BackButton: {
    isVisible: boolean
    show: () => void
    hide: () => void
    onClick: (callback: () => void) => void
    offClick: (callback: () => void) => void
  }
  themeParams: {
    bg_color?: string
    text_color?: string
    hint_color?: string
    link_color?: string
    button_color?: string
    button_text_color?: string
    secondary_bg_color?: string
  }
  initData: string
  initDataUnsafe: {
    query_id?: string
    user?: {
      id: number
      is_bot?: boolean
      first_name: string
      last_name?: string
      username?: string
      language_code?: string
      is_premium?: boolean
      photo_url?: string
    }
    receiver?: {
      id: number
      is_bot?: boolean
      first_name: string
      last_name?: string
      username?: string
      photo_url?: string
    }
    chat?: {
      id: number
      type: 'private' | 'group' | 'supergroup' | 'channel'
      title?: string
      username?: string
      photo_url?: string
    }
    chat_type?: string
    chat_instance?: string
    start_param?: string
    can_send_after?: number
    auth_date: number
    hash: string
  }
  colorScheme: 'light' | 'dark'
  viewportHeight: number
  viewportStableHeight: number
  headerColor: string
  backgroundColor: string
  isExpanded: boolean
  HapticFeedback: {
    impactOccurred: (
      style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft',
    ) => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
  CloudStorage: {
    setItem: (
      key: string,
      value: string,
      callback?: (error: Error | null, success?: boolean) => void,
    ) => void
    getItem: (
      key: string,
      callback: (error: Error | null, value?: string) => void,
    ) => void
    getItems: (
      keys: string[],
      callback: (error: Error | null, values?: Record<string, string>) => void,
    ) => void
    removeItem: (
      key: string,
      callback?: (error: Error | null, success?: boolean) => void,
    ) => void
    removeItems: (
      keys: string[],
      callback?: (error: Error | null, success?: boolean) => void,
    ) => void
    getKeys: (callback: (error: Error | null, keys?: string[]) => void) => void
  }
  sendData: (data: string) => void
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void
  openTelegramLink: (url: string) => void
  showPopup: (
    params: {
      title?: string
      message: string
      buttons?: Array<{
        id?: string
        type?: 'default' | 'ok' | 'close' | 'cancel' | 'destructive'
        text?: string
      }>
    },
    callback?: (buttonId: string) => void,
  ) => void
  showAlert: (message: string, callback?: () => void) => void
  showConfirm: (
    message: string,
    callback?: (confirmed: boolean) => void,
  ) => void
  showScanQrPopup: (
    params?: { text?: string },
    callback?: (text: string) => boolean | undefined,
  ) => void
  closeScanQrPopup: () => void
  readTextFromClipboard: (callback?: (text: string | null) => void) => void
  requestWriteAccess: (callback?: (granted: boolean) => void) => void
  requestContact: (callback?: (granted: boolean) => void) => void
  switchInlineQuery: (
    query: string,
    chat_types?: Array<'users' | 'bots' | 'groups' | 'channels'>,
  ) => void
  onEvent: (eventType: string, callback: (...args: unknown[]) => void) => void
  offEvent: (eventType: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

// Platform detection
export type MiniappPlatform = 'telegram' | 'farcaster' | 'web'

export function detectMiniappPlatform(): MiniappPlatform {
  if (typeof window === 'undefined') return 'web'

  // Check for Telegram
  if (window.Telegram?.WebApp?.initData) {
    return 'telegram'
  }

  // Check for Farcaster frame context
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.has('fc') || urlParams.has('fid')) {
    return 'farcaster'
  }

  return 'web'
}

// Telegram WebApp utilities
export function initTelegram(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  if (!window.Telegram?.WebApp) return null

  const webapp = window.Telegram.WebApp
  webapp.ready()
  webapp.expand()

  return webapp
}

export function haptic(
  type: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning',
): void {
  if (typeof window === 'undefined') return
  if (!window.Telegram?.WebApp?.HapticFeedback) return

  const feedback = window.Telegram.WebApp.HapticFeedback
  if (type === 'success' || type === 'error' || type === 'warning') {
    feedback.notificationOccurred(type)
  } else {
    feedback.impactOccurred(type)
  }
}

export function getTelegramUser():
  | TelegramWebApp['initDataUnsafe']['user']
  | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp?.initDataUnsafe?.user ?? null
}

export function getTelegramTheme(): TelegramWebApp['themeParams'] | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp?.themeParams ?? null
}

export function isTelegramDarkMode(): boolean {
  if (typeof window === 'undefined') return true
  const scheme = window.Telegram?.WebApp?.colorScheme
  return scheme === undefined ? true : scheme === 'dark'
}

// Farcaster Frame utilities
export interface FarcasterFrameContext {
  fid: number
  username?: string
  displayName?: string
  pfp?: string
  castHash?: string
}

export function getFarcasterContext(): FarcasterFrameContext | null {
  if (typeof window === 'undefined') return null

  const urlParams = new URLSearchParams(window.location.search)
  const fid = urlParams.get('fid')

  if (!fid) return null

  return {
    fid: Number.parseInt(fid, 10),
    username: urlParams.get('username') ?? undefined,
    displayName: urlParams.get('display_name') ?? undefined,
    pfp: urlParams.get('pfp') ?? undefined,
    castHash: urlParams.get('cast_hash') ?? undefined,
  }
}

// Farcaster Frame HTML generator
export interface FrameMetadata {
  image: string
  postUrl: string
  buttons?: Array<{
    label: string
    action?: 'post' | 'post_redirect' | 'link' | 'mint' | 'tx'
    target?: string
  }>
  input?: {
    placeholder: string
  }
  version?: string
}

export function generateFrameMetaTags(frame: FrameMetadata): string {
  const tags: string[] = [
    `<meta property="fc:frame" content="${frame.version ?? 'vNext'}">`,
    `<meta property="fc:frame:image" content="${frame.image}">`,
    `<meta property="fc:frame:post_url" content="${frame.postUrl}">`,
  ]

  if (frame.input) {
    tags.push(
      `<meta property="fc:frame:input:text" content="${frame.input.placeholder}">`,
    )
  }

  if (frame.buttons) {
    frame.buttons.forEach((button, index) => {
      const idx = index + 1
      tags.push(
        `<meta property="fc:frame:button:${idx}" content="${button.label}">`,
      )
      if (button.action) {
        tags.push(
          `<meta property="fc:frame:button:${idx}:action" content="${button.action}">`,
        )
      }
      if (button.target) {
        tags.push(
          `<meta property="fc:frame:button:${idx}:target" content="${button.target}">`,
        )
      }
    })
  }

  return tags.join('\n  ')
}

// Frame response helper for server-side
export function createFrameResponse(frame: FrameMetadata): string {
  return `<!DOCTYPE html>
<html>
<head>
  ${generateFrameMetaTags(frame)}
</head>
<body></body>
</html>`
}

// Storage utilities (works across platforms)
export interface MiniappStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  getKeys(): Promise<string[]>
}

export function createMiniappStorage(): MiniappStorage {
  const platform = detectMiniappPlatform()

  if (platform === 'telegram' && window.Telegram?.WebApp?.CloudStorage) {
    const cloud = window.Telegram.WebApp.CloudStorage
    return {
      get: (key: string) =>
        new Promise((resolve) => {
          cloud.getItem(key, (err, value) => {
            if (err) resolve(null)
            else resolve(value ?? null)
          })
        }),
      set: (key: string, value: string) =>
        new Promise((resolve, reject) => {
          cloud.setItem(key, value, (err) => {
            if (err) reject(err)
            else resolve()
          })
        }),
      remove: (key: string) =>
        new Promise((resolve, reject) => {
          cloud.removeItem(key, (err) => {
            if (err) reject(err)
            else resolve()
          })
        }),
      getKeys: () =>
        new Promise((resolve) => {
          cloud.getKeys((err, keys) => {
            if (err) resolve([])
            else resolve(keys ?? [])
          })
        }),
    }
  }

  // Fallback to localStorage
  return {
    get: async (key: string) => localStorage.getItem(`miniapp:${key}`),
    set: async (key: string, value: string) =>
      localStorage.setItem(`miniapp:${key}`, value),
    remove: async (key: string) => localStorage.removeItem(`miniapp:${key}`),
    getKeys: async () => {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith('miniapp:')) {
          keys.push(key.replace('miniapp:', ''))
        }
      }
      return keys
    },
  }
}

// CSS theme variables generator
export function getMiniappThemeVars(): Record<string, string> {
  const theme = getTelegramTheme()

  if (theme) {
    return {
      '--bg-primary': theme.bg_color ?? '#0a0a0f',
      '--bg-secondary': theme.secondary_bg_color ?? '#1a1a1f',
      '--text-primary': theme.text_color ?? '#ffffff',
      '--text-secondary': theme.hint_color ?? '#8a8a8f',
      '--accent': theme.button_color ?? '#00ff88',
      '--accent-text': theme.button_text_color ?? '#000000',
      '--link': theme.link_color ?? '#00d4ff',
    }
  }

  // Default dark theme
  return {
    '--bg-primary': '#0a0a0f',
    '--bg-secondary': '#1a1a1f',
    '--text-primary': '#ffffff',
    '--text-secondary': '#8a8a8f',
    '--accent': '#00ff88',
    '--accent-text': '#000000',
    '--link': '#00d4ff',
  }
}

export function applyMiniappTheme(): void {
  if (typeof document === 'undefined') return

  const vars = getMiniappThemeVars()
  const root = document.documentElement

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}
