/**
 * Stub for @tauri-apps/api/core
 * Used in web builds where Tauri APIs are not available
 */
export async function invoke(
  _cmd: string,
  _args?: Record<string, unknown>,
): Promise<unknown> {
  throw new Error(`Tauri invoke not available in web environment: ${_cmd}`)
}

export default { invoke }
