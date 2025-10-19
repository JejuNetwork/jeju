/// <reference types="vite/client" />

// CSS modules
declare module '*.css' {
  const content: string;
  export default content;
}

// Images
declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

declare module '*.jpeg' {
  const content: string;
  export default content;
}

declare module '*.webp' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

// Environment variables
declare const __GIT_COMMIT__: string;
declare const __BUILD_TIME__: string;
