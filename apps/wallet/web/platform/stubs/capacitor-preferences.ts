/**
 * Stub for @capacitor/preferences
 * Used in web builds where native Capacitor plugins are not available
 */
export const Preferences = {
  async get(_options: { key: string }): Promise<{ value: string | null }> {
    // In web, we use localStorage
    const value = localStorage.getItem(_options.key)
    return { value }
  },
  async set(_options: { key: string; value: string }): Promise<void> {
    localStorage.setItem(_options.key, _options.value)
  },
  async remove(_options: { key: string }): Promise<void> {
    localStorage.removeItem(_options.key)
  },
  async keys(): Promise<{ keys: string[] }> {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) keys.push(key)
    }
    return { keys }
  },
  async clear(): Promise<void> {
    localStorage.clear()
  },
}

export default { Preferences }

