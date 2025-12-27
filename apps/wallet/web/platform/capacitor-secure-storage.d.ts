/**
 * Type declarations for @nicememes/capacitor-secure-storage-plugin
 * iOS Keychain / Android Keystore secure storage
 */

declare module '@nicememes/capacitor-secure-storage-plugin' {
  interface SecureStoragePluginPlugin {
    get(options: { key: string }): Promise<{ value: string | null }>
    set(options: { key: string; value: string }): Promise<void>
    remove(options: { key: string }): Promise<void>
    clear(): Promise<void>
    keys(): Promise<{ keys: string[] }>
    getPlatform(): Promise<{ platform: 'ios' | 'android' | 'web' }>
  }

  export const SecureStoragePlugin: SecureStoragePluginPlugin
}

// Augment Capacitor global types
interface CapacitorGlobal {
  isPluginAvailable?(name: string): boolean
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal
  }
}
