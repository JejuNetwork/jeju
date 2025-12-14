/// <reference types="vite/client" />

// Fix for wagmi provider JSX types
declare global {
  namespace JSX {
    interface IntrinsicAttributes {
      children?: React.ReactNode;
    }
  }
}

export {};

