/**
 * Platform types and interfaces
 */

export type PlatformType =
  | 'web'
  | 'chrome-extension'
  | 'firefox-extension'
  | 'safari-extension'
  | 'edge-extension'
  | 'brave-extension'
  | 'tauri-macos'
  | 'tauri-windows'
  | 'tauri-linux'
  | 'capacitor-ios'
  | 'capacitor-android'

export type PlatformCategory = 'web' | 'extension' | 'desktop' | 'mobile'

export type BrowserType =
  | 'chrome'
  | 'firefox'
  | 'safari'
  | 'edge'
  | 'brave'
  | 'opera'
  | 'unknown'

export interface PlatformCapabilities {
  hasSecureStorage: boolean
  hasBiometrics: boolean
  hasDeepLinks: boolean
  hasIAP: boolean
  hasNotifications: boolean
  hasClipboard: boolean
  hasCamera: boolean
  hasShare: boolean
  maxStorageSize: number | 'unlimited'
  supportsBackgroundTasks: boolean
}

export interface SecureStorageOptions {
  service?: string
  accessGroup?: string
  authenticateWithBiometrics?: boolean
}

export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  keys(): Promise<string[]>
}

export interface SecureStorageAdapter {
  get(key: string, options?: SecureStorageOptions): Promise<string | null>
  set(key: string, value: string, options?: SecureStorageOptions): Promise<void>
  remove(key: string): Promise<void>
  hasKey(key: string): Promise<boolean>
}

export interface PlatformInfo {
  type: PlatformType
  category: PlatformCategory
  version: string
  capabilities: PlatformCapabilities
  osVersion?: string
  deviceModel?: string
}
