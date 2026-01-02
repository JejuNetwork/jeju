// Workerd shims for Node.js compatibility
globalThis.process = {
  env: {},
  cwd: () => '/',
  platform: 'linux',
  version: 'v18.0.0',
  versions: { node: '18.0.0' },
  argv: [],
  stdout: { write: console.log },
  stderr: { write: console.error },
  nextTick: (fn: () => void) => setTimeout(fn, 0),
} as unknown as NodeJS.Process

// Export the worker
export * from './workerd-entry'
