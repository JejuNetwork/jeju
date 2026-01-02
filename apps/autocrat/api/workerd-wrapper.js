// Workerd-compatible wrapper
// Define globals BEFORE any imports
globalThis.process = {
  env: {},
  cwd: () => '/',
  platform: 'linux',
  version: 'v18.0.0',
  versions: { node: '18.0.0' },
  argv: [],
  stdout: { write: (s) => console.log(s) },
  stderr: { write: (s) => console.error(s) },
  nextTick: (fn) => setTimeout(fn, 0),
  hrtime: {
    bigint: () => BigInt(Date.now() * 1000000)
  }
};

globalThis.Buffer = globalThis.Buffer || {
  from: (data, encoding) => {
    if (typeof data === 'string') {
      return new TextEncoder().encode(data);
    }
    return new Uint8Array(data);
  },
  isBuffer: () => false,
  alloc: (size) => new Uint8Array(size)
};

// Now we'll import the actual worker
import { createAutocratApp } from './worker';

export default {
  async fetch(request, env) {
    // Merge env into process.env
    Object.assign(globalThis.process.env, env);
    
    const app = createAutocratApp(env);
    return app.handle(request);
  }
};
