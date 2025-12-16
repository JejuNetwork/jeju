/// <reference types="react" />
/// <reference types="react-dom" />

// Override React types to fix monorepo version mismatch
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number;
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export {};
