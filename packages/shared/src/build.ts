/**
 * Build Utilities
 *
 * Common utilities for production builds across apps.
 */

/** Browser modules that should be externalized during bundling */
export const BROWSER_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react-router-dom',
  '@tanstack/react-query',
  'wagmi',
  'viem',
  '@wagmi/core',
  '@wagmi/connectors',
  'zustand',
  'sonner',
]

/** Worker modules that should be externalized during bundling */
export const WORKER_EXTERNALS = [
  'node:*',
  'crypto',
  'stream',
  'buffer',
  'util',
  'events',
  'path',
  'fs',
  'os',
]

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`
}

/** Build output with size info */
interface BuildOutput {
  path: string
  size?: number
}

/** Build result with outputs */
interface BuildResult {
  outputs: BuildOutput[]
}

/** Report bundle sizes from build result */
export function reportBundleSizes(result: BuildResult, label: string): void {
  console.log(`\n${label} Bundle Sizes:`)
  for (const output of result.outputs) {
    const name = output.path.split('/').pop() ?? output.path
    const size = output.size ?? 0
    const kb = (size / 1024).toFixed(2)
    console.log(`  ${name}: ${kb} KB`)
  }
}

/** Validate build inputs exist */
export function validateBuildInputs(inputs: string[]): void {
  const { existsSync } = require('node:fs')
  for (const input of inputs) {
    if (!existsSync(input)) {
      throw new Error(`Build input not found: ${input}`)
    }
  }
}

/** Define replacements for build */
export interface DefineConfig {
  'process.env.NODE_ENV'?: string
  [key: string]: string | undefined
}

/** Create define replacements for bundler */
export function createDefines(env: 'production' | 'development'): DefineConfig {
  return {
    'process.env.NODE_ENV': JSON.stringify(env),
  }
}

/** Resolve callback for build plugins */
type ResolveCallback = (
  opts: { filter: RegExp },
  handler: (args: { path: string }) => { path: string; external: boolean },
) => void

/** Load callback for build plugins */
type LoadCallback = (
  opts: { filter: RegExp },
  handler: (args: { path: string }) => { contents: string; loader: string },
) => void

/** Browser plugin configuration */
export interface BrowserPluginConfig {
  name: string
  setup: (build: { onResolve: ResolveCallback; onLoad: LoadCallback }) => void
}

/** Create browser compatibility plugin */
export function createBrowserPlugin(): BrowserPluginConfig {
  return {
    name: 'browser-compat',
    setup(build) {
      // Handle node: protocol imports
      build.onResolve({ filter: /^node:/ }, (args) => {
        return { path: args.path.replace('node:', ''), external: true }
      })
    },
  }
}

/** Frontend build configuration */
export interface FrontendBuildConfig {
  entrypoints: string[]
  outdir: string
  minify: boolean
  sourcemap: 'external' | 'inline' | 'none'
  target: string
  define: DefineConfig
  external: string[]
}

/** Create frontend build configuration */
export function createFrontendBuildConfig(
  entrypoints: string[],
  outdir: string,
  options?: { minify?: boolean; sourcemap?: boolean },
): FrontendBuildConfig {
  return {
    entrypoints,
    outdir,
    minify: options?.minify ?? true,
    sourcemap: options?.sourcemap ? 'external' : 'none',
    target: 'browser',
    define: createDefines('production'),
    external: BROWSER_EXTERNALS,
  }
}

/** Worker build configuration */
export interface WorkerBuildConfig {
  entrypoints: string[]
  outdir: string
  minify: boolean
  sourcemap: 'external' | 'inline' | 'none'
  target: string
  define: DefineConfig
  external: string[]
  format: 'esm'
}

/** Create worker build configuration */
export function createWorkerBuildConfig(
  entrypoints: string[],
  outdir: string,
  options?: { minify?: boolean; sourcemap?: boolean },
): WorkerBuildConfig {
  return {
    entrypoints,
    outdir,
    minify: options?.minify ?? true,
    sourcemap: options?.sourcemap ? 'external' : 'none',
    target: 'node',
    define: createDefines('production'),
    external: WORKER_EXTERNALS,
    format: 'esm',
  }
}
