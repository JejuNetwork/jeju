/**
 * Dev Server Types
 */

export interface AppTheme {
  name: string
  storageKey: string
  fonts: {
    google: string
    sans: string
    display: string
    mono: string
  }
  colors: {
    primary: string
    primaryDark: string
    primaryLight: string
    accent: string
    accentDark: string
    accentLight: string
    purple: string
    purpleDark: string
    purpleLight: string
  }
  light: {
    bg: string
    bgSecondary: string
    bgTertiary: string
    surface: string
    surfaceElevated: string
    border: string
    borderStrong: string
    text: string
    textSecondary: string
    textTertiary: string
  }
  dark: {
    bg: string
    bgSecondary: string
    bgTertiary: string
    surface: string
    surfaceElevated: string
    border: string
    borderStrong: string
    text: string
    textSecondary: string
    textTertiary: string
  }
}

export interface DevServerConfig {
  name: string
  frontendPort: number
  apiPort: number
  theme: AppTheme
  entrypoint?: string
  watchDirs?: string[]
  externals?: string[]
  proxyPaths?: string[]
  apiUrl?: string
  useProxy?: boolean
}

// Node.js built-ins and server-only packages that cannot run in browser
export const DEFAULT_BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'module',
  'worker_threads',
  'node:url',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:events',
  'node:module',
  'node:worker_threads',
  'pino',
  'pino-pretty',
]

export const DEFAULT_PROXY_PATHS = ['/api/', '/health', '/.well-known/']

export const DEFAULT_WATCH_DIRS = [
  './web',
  './src',
  './components',
  './hooks',
  './lib',
  './config',
]
