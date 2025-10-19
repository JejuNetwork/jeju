// Test configuration for bun test
// This sets up DOM globals for frontend tests

import { beforeAll, afterAll } from 'bun:test';

// Setup DOM environment for frontend tests
beforeAll(() => {
  // Create basic DOM globals for tests that need them
  if (typeof global !== 'undefined') {
    // Mock WebSocket for tests
    global.WebSocket = class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 3;

      readyState = 0;
      onopen: any = null;
      onmessage: any = null;
      onerror: any = null;
      onclose: any = null;

      constructor(public url: string) {
        setTimeout(() => {
          this.readyState = 1;
          if (this.onopen) {
            this.onopen(new Event('open'));
          }
        }, 10);
      }

      send(_data: string) {}
      close() {
        this.readyState = 3;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return true;
      }
    } as any;

    // Mock document with createElement
    global.document = {
      createElement: (tagName: string) => {
        if (tagName === 'canvas') {
          return {
            getContext: () => ({
              drawImage: () => {},
              getImageData: () => ({ data: new Uint8ClampedArray(4) }),
            }),
            width: 0,
            height: 0,
          };
        }
        return {};
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;

    // Mock navigator
    global.navigator = {
      mediaDevices: {
        getUserMedia: () =>
          Promise.resolve({
            getTracks: () => [{ stop: () => {} }],
          }),
        enumerateDevices: () => Promise.resolve([]),
      },
      permissions: {
        query: () => Promise.resolve({ state: 'granted' }),
      },
    } as any;

    // Mock window
    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    } as any;
  }
});

afterAll(() => {
  // Cleanup if needed
});
