// Type declarations for external modules without TypeScript support
declare module 'rimraf' {
  export interface RimrafAsyncOptions {
    maxRetries?: number
    retryDelay?: number
    glob?: boolean
  }
  export function rimraf(path: string, options?: RimrafAsyncOptions): Promise<boolean>
}

declare module 'gradient-string' {
  interface GradientModule {
    (colors: string[]): {
      multiline: (text: string) => string
    }
    rainbow: {
      multiline: (text: string) => string
    }
    pastel: {
      multiline: (text: string) => string
    }
  }
  const gradient: GradientModule
  export default gradient
}

declare module 'unzip-crx-3' {
  export default function unzip(source: string, destination: string): Promise<void>
}

declare module 'unzipper' {
  import type { Readable } from 'stream'
  
  interface Entry {
    path: string
    type: 'File' | 'Directory'
    pipe(destination: NodeJS.WritableStream): NodeJS.WritableStream
    autodrain(): void
  }

  interface ParseStream extends Readable {
    on(event: 'entry', listener: (entry: Entry) => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    promise(): Promise<void>
  }

  export function Parse(): ParseStream
  export function Extract(options: { path: string }): ParseStream
}

declare module 'progress' {
  interface ProgressBarOptions {
    width?: number
    complete?: string
    incomplete?: string
    renderThrottle?: number
    total: number
    clear?: boolean
    callback?: () => void
    stream?: NodeJS.WritableStream
  }

  class ProgressBar {
    constructor(format: string, options: ProgressBarOptions)
    tick(len?: number, tokens?: Record<string, string>): void
    render(tokens?: Record<string, string>): void
    update(ratio: number, tokens?: Record<string, string>): void
    interrupt(message: string): void
    terminate(): void
    complete: boolean
    curr: number
    total: number
  }

  export = ProgressBar
}
