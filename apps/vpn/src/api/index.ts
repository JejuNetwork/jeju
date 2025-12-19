/**
 * API layer that works in both Tauri and web contexts
 */

import { isTauri, mockInvoke } from './mock';

/**
 * Invoke a command - uses Tauri if available, otherwise mock API
 */
export async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) {
    // Dynamic import to avoid bundling issues in web
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/tauri');
    return tauriInvoke<T>(cmd, args);
  }
  
  return mockInvoke<T>(cmd, args);
}

export { isTauri };

