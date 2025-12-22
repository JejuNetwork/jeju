/**
 * Type declarations for @jejunetwork/tests submodule imports
 */
declare module '@jejunetwork/tests/warmup' {
  export function warmupServices(): Promise<void>
  export function checkServicesReady(): Promise<boolean>
}

declare module '@jejunetwork/tests/lock-manager' {
  export function acquireLock(name: string): Promise<() => void>
  export function releaseLock(name: string): Promise<void>
  export function isLocked(name: string): Promise<boolean>
}

declare module '@jejunetwork/tests/preflight' {
  export function runPreflightChecks(): Promise<{
    passed: boolean
    errors: string[]
  }>
  export function checkDependencies(): Promise<boolean>
}
