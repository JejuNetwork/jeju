import type { BuildConfig } from 'bun';

// Main build configuration
export const buildConfig: BuildConfig = {
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  external: [
    // Node built-ins
    'fs',
    'path',
    'http',
    'https',
    'crypto',
    'child_process',
    'os',
    'util',
    'stream',
    'buffer',
    'events',
    'url',
    'node:fs',
    'node:path',
    'node:http',
    'node:https',
    'node:crypto',
    'node:child_process',
    'node:os',
    'node:util',
    'node:stream',
    'node:buffer',
    'node:events',
    'node:url',
    // Test framework
    'bun:test',
    // Core dependencies
    'dotenv',
    'zod',
    '@elizaos/core',
    '@elizaos/plugin-bootstrap',
    // Other dependencies
    'axios',
    // Native modules - DO NOT BUNDLE
    'sharp',
    '@napi-rs/canvas',
    'face-api.js',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  naming: '[dir]/[name].[ext]',
};

// Workers build configuration
export const workersConfig: BuildConfig = {
  entrypoints: [
    './src/workers/screen-capture-worker.ts',
    './src/workers/florence2-worker.ts',
    './src/workers/ocr-worker.ts',
  ],
  outdir: './dist/workers',
  target: 'node',
  format: 'cjs',
  splitting: false,
  sourcemap: true,
  external: [
    // All native modules must be external
    'sharp',
    '@napi-rs/canvas',
    'face-api.js',
    '@tensorflow/tfjs-node',
    '@tensorflow-models/mobilenet',
    '@mapbox/node-pre-gyp',
    'mock-aws-s3',
    'aws-sdk',
    'nock',
  ],
  naming: '[name].[ext]',
};
