/**
 * Type declarations for capacitor-secure-storage-plugin
 * iOS Keychain / Android Keystore secure storage
 * @see https://github.com/martinkasa/capacitor-secure-storage-plugin
 */

declare module 'capacitor-secure-storage-plugin' {
  interface SecureStoragePluginPlugin {
    get(options: { key: string }): Promise<{ value: string }>
    set(options: { key: string; value: string }): Promise<{ value: boolean }>
    remove(options: { key: string }): Promise<{ value: boolean }>
    clear(): Promise<{ value: boolean }>
    keys(): Promise<{ value: string[] }>
    getPlatform(): Promise<{ value: string }>
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
