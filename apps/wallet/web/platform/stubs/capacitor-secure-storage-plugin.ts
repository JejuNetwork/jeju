/**
 * Stub for capacitor-secure-storage-plugin
 * Used in web builds where native Capacitor plugins are not available
 */
export const SecureStoragePlugin = {
  async get(_options: { key: string }): Promise<{ value: string }> {
    throw new Error('SecureStoragePlugin not available in web environment')
  },
  async set(_options: { key: string; value: string }): Promise<void> {
    throw new Error('SecureStoragePlugin not available in web environment')
  },
  async remove(_options: { key: string }): Promise<void> {
    throw new Error('SecureStoragePlugin not available in web environment')
  },
}

export default { SecureStoragePlugin }

