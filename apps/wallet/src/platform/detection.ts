/**
 * Platform Detection
 */

import type { PlatformType, PlatformCategory, PlatformCapabilities, PlatformInfo } from './types';

let cachedPlatform: PlatformInfo | null = null;

function detectPlatformType(): PlatformType {
  if (typeof window === 'undefined') return 'web';

  // Check Tauri
  if ('__TAURI__' in window) {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) return 'tauri-macos';
    if (userAgent.includes('win')) return 'tauri-windows';
    return 'tauri-linux';
  }

  // Check Capacitor
  if ('Capacitor' in window) {
    const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    const platform = cap?.getPlatform?.();
    if (platform === 'ios') return 'capacitor-ios';
    if (platform === 'android') return 'capacitor-android';
  }

  // Check browser extension
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return 'chrome-extension';
  }
  if (typeof browser !== 'undefined' && (browser as { runtime?: { id?: string } }).runtime?.id) {
    return 'firefox-extension';
  }

  return 'web';
}

function getPlatformCategory(type: PlatformType): PlatformCategory {
  if (type.startsWith('tauri-')) return 'desktop';
  if (type.startsWith('capacitor-')) return 'mobile';
  if (type.endsWith('-extension')) return 'extension';
  return 'web';
}

function getCapabilities(type: PlatformType): PlatformCapabilities {
  const category = getPlatformCategory(type);

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
  };

  switch (category) {
    case 'desktop':
      return {
        ...baseCapabilities,
        hasSecureStorage: true,
        hasBiometrics: type === 'tauri-macos',
        hasDeepLinks: true,
        maxStorageSize: 'unlimited',
        supportsBackgroundTasks: true,
      };

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
      };

    case 'extension':
      return {
        ...baseCapabilities,
        hasSecureStorage: true,
        hasDeepLinks: false,
        maxStorageSize: 'unlimited',
        supportsBackgroundTasks: true,
      };

    default:
      return {
        ...baseCapabilities,
        hasSecureStorage: false,
        hasDeepLinks: true,
      };
  }
}

export function getPlatformInfo(): PlatformInfo {
  if (cachedPlatform) return cachedPlatform;

  const type = detectPlatformType();
  const category = getPlatformCategory(type);
  const capabilities = getCapabilities(type);

  cachedPlatform = {
    type,
    category,
    version: '0.1.0',
    capabilities,
    osVersion: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  return cachedPlatform;
}

export function isDesktop(): boolean {
  return getPlatformInfo().category === 'desktop';
}

export function isMobile(): boolean {
  return getPlatformInfo().category === 'mobile';
}

export function isExtension(): boolean {
  return getPlatformInfo().category === 'extension';
}

export function isWeb(): boolean {
  return getPlatformInfo().category === 'web';
}

export function isIOS(): boolean {
  return getPlatformInfo().type === 'capacitor-ios';
}

export function isAndroid(): boolean {
  return getPlatformInfo().type === 'capacitor-android';
}

export function isMacOS(): boolean {
  return getPlatformInfo().type === 'tauri-macos';
}

export function hasSecureStorage(): boolean {
  return getPlatformInfo().capabilities.hasSecureStorage;
}

export function hasBiometrics(): boolean {
  return getPlatformInfo().capabilities.hasBiometrics;
}

export function hasIAP(): boolean {
  return getPlatformInfo().capabilities.hasIAP;
}
