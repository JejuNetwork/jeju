// Global type declarations for external modules used by synpress dependencies
declare module 'rimraf' {
  export function rimraf(path: string): Promise<boolean>
}

declare module 'gradient-string' {
  const gradient: {
    rainbow: {
      multiline: (text: string) => string
    }
  }
  export default gradient
}

declare module 'unzip-crx-3' {
  export default function unzip(
    source: string,
    destination: string,
  ): Promise<void>
}

declare module 'unzipper' {
  import type { Readable } from 'node:stream'
  interface ParseStream extends Readable {
    on(
      event: 'entry',
      listener: (entry: {
        path: string
        type: string
        pipe: (dest: NodeJS.WritableStream) => void
      }) => void,
    ): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    promise(): Promise<void>
  }
  export function Parse(): ParseStream
}

declare module 'progress' {
  export default class ProgressBar {
    constructor(format: string, options: { width?: number; total: number })
    tick(len?: number): void
    complete: boolean
  }
}
