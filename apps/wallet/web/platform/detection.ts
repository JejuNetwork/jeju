/**
 * Platform Detection
 */

import type {
  BrowserType,
  PlatformCapabilities,
  PlatformCategory,
  PlatformInfo,
  PlatformType,
} from './types'

let cachedPlatform: PlatformInfo | null = null

/** Window with Capacitor mobile framework */
interface WindowWithCapacitor {
  Capacitor?: {
    getPlatform?: () => string
  }
}

/** Safari extension API */
interface SafariExtension {
  extension?: {
    dispatchMessage?: (...args: string[]) => void
  }
}

/** Firefox browser extension API */
interface BrowserExtension {
  runtime?: {
    id?: string
  }
}

/**
 * Detect the current browser type
 */
export function detectBrowser(): BrowserType {
  if (typeof navigator === 'undefined') return 'unknown'

  const ua = navigator.userAgent.toLowerCase()
  const vendor = navigator.vendor?.toLowerCase() ?? ''

  // Brave has a specific detection method
  if (
    (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } })
      .brave?.isBrave
  ) {
    return 'brave'
  }

  // Check for Edge (Chromium-based)
  if (ua.includes('edg/') || ua.includes('edge/')) {
    return 'edge'
  }

  // Check for Opera
  if (ua.includes('opr/') || ua.includes('opera')) {
    return 'opera'
  }

  // Check for Firefox
  if (ua.includes('firefox')) {
    return 'firefox'
  }

  // Check for Safari (must be after Chrome check since Safari has chrome in UA)
  if (
    ua.includes('safari') &&
    !ua.includes('chrome') &&
    vendor.includes('apple')
  ) {
    return 'safari'
  }

  // Check for Chrome
  if (ua.includes('chrome') && vendor.includes('google')) {
    return 'chrome'
  }

  return 'unknown'
}

function detectPlatformType(): PlatformType {
  if (typeof window === 'undefined') return 'web'

  // Check Tauri
  if ('__TAURI__' in window) {
    const userAgent = navigator.userAgent.toLowerCase()
    if (userAgent.includes('mac')) return 'tauri-macos'
    if (userAgent.includes('win')) return 'tauri-windows'
    return 'tauri-linux'
  }

  // Check Capacitor
  if ('Capacitor' in window) {
    const cap = (window as WindowWithCapacitor).Capacitor
    const platform = cap?.getPlatform?.()
    if (platform === 'ios') return 'capacitor-ios'
    if (platform === 'android') return 'capacitor-android'
  }

  // Check browser extensions - need to detect specific browser
  const browserType = detectBrowser()

  // Safari Web Extension
  if (
    typeof safari !== 'undefined' &&
    (safari as SafariExtension).extension?.dispatchMessage
  ) {
    return 'safari-extension'
  }

  // Firefox extension
  if (
    typeof browser !== 'undefined' &&
    (browser as BrowserExtension).runtime?.id
  ) {
    return 'firefox-extension'
  }

  // Chrome-based extensions (Chrome, Edge, Brave, Opera)
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    if (browserType === 'brave') return 'brave-extension'
    if (browserType === 'edge') return 'edge-extension'
    return 'chrome-extension'
  }

  return 'web'
}

function getPlatformCategory(type: PlatformType): PlatformCategory {
  if (type.startsWith('tauri-')) return 'desktop'
  if (type.startsWith('capacitor-')) return 'mobile'
  if (type.endsWith('-extension')) return 'extension'
  return 'web'
}

function getCapabilities(type: PlatformType): PlatformCapabilities {
  const category = getPlatformCategory(type)

  const baseCapabilities: PlatformCapabilities = {
    hasSecureStorage: false,
    hasBiometrics: false,
    hasDeepLinks: false,
    hasIAP: false,
    hasNotifications: true,
    hasClipboard: true,
    hasCamera: false,
    hasShare: true,
    maxStorageSize: 10 * 1024 * 1024,
    supportsBackgroundTasks: false,
  }

  switch (category) {
    case 'desktop':
      return {
        ...baseCapabilities,
        hasSecureStorage: true,
        hasBiometrics: type === 'tauri-macos',
        hasDeepLinks: true,
        maxStorageSize: 'unlimited',
        supportsBackgroundTasks: true,
      }

    case 'mobile':
      return {
        ...baseCapabilities,
        hasSecureStorage: true,
        hasBiometrics: true,
        hasDeepLinks: true,
        hasIAP: true,
        hasCamera: true,
        maxStorageSize: 'unlimited',
        supportsBackgroundTasks: type === 'capacitor-ios',
      }

    case 'extension':
      return {
        ...baseCapabilities,
        hasSecureStorage: true,
        hasDeepLinks: false,
        maxStorageSize: 'unlimited',
        supportsBackgroundTasks: true,
      }

    default:
      return {
        ...baseCapabilities,
        hasSecureStorage: false,
        hasDeepLinks: true,
      }
  }
}

export function getPlatformInfo(): PlatformInfo {
  if (cachedPlatform) return cachedPlatform

  const type = detectPlatformType()
  const category = getPlatformCategory(type)
  const capabilities = getCapabilities(type)

  cachedPlatform = {
    type,
    category,
    version: '0.1.0',
    capabilities,
    osVersion:
      typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  }

  return cachedPlatform
}

export function isDesktop(): boolean {
  return getPlatformInfo().category === 'desktop'
}

export function isMobile(): boolean {
  return getPlatformInfo().category === 'mobile'
}

export function isExtension(): boolean {
  return getPlatformInfo().category === 'extension'
}

export function isWeb(): boolean {
  return getPlatformInfo().category === 'web'
}

export function isIOS(): boolean {
  return getPlatformInfo().type === 'capacitor-ios'
}

export function isAndroid(): boolean {
  return getPlatformInfo().type === 'capacitor-android'
}

export function isMacOS(): boolean {
  return getPlatformInfo().type === 'tauri-macos'
}

export function hasSecureStorage(): boolean {
  return getPlatformInfo().capabilities.hasSecureStorage
}

export function hasBiometrics(): boolean {
  return getPlatformInfo().capabilities.hasBiometrics
}

export function hasIAP(): boolean {
  return getPlatformInfo().capabilities.hasIAP
}

/**
 * Reset platform cache - useful for testing
 */
export function resetPlatformCache(): void {
  cachedPlatform = null
}
