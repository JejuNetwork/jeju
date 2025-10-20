/**
 * Global test setup for Bun test runner
 * This file is automatically loaded before all tests
 */

// Setup DOM environment
import { Window } from 'happy-dom';
const window = new Window();
global.document = window.document;
global.window = window as any;
global.navigator = window.navigator;
global.HTMLElement = window.HTMLElement as any;

// Import testing library matchers
import '@testing-library/jest-dom';

// Mock Next.js environment
process.env.NEXT_PUBLIC_GRAPHQL_URL = 'http://localhost:4350/graphql';
process.env.NEXT_PUBLIC_RPC_URL = 'http://localhost:9545';
process.env.NEXT_PUBLIC_CHAIN_ID = '1337';
process.env.NEXT_PUBLIC_PREDIMARKET_ADDRESS = '0x1234567890123456789012345678901234567890';
process.env.NEXT_PUBLIC_ELIZA_OS_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

// Mock window.matchMedia for responsive tests
global.matchMedia = global.matchMedia || function (query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = '';
  thresholds = [];
};

// Suppress console errors in tests
const originalError = console.error;
console.error = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].includes('Not implemented: HTMLFormElement.prototype.submit') ||
     args[0].includes('Could not parse CSS stylesheet'))
  ) {
    return;
  }
  originalError.call(console, ...args);
};

