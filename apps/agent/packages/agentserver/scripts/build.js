#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json to get dependencies
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

// Get all workspace dependencies that should be bundled
const workspaceDependencies = Object.keys(packageJson.dependencies || {}).filter((dep) =>
  packageJson.dependencies[dep].startsWith('workspace:')
);

console.log('Workspace dependencies to bundle:', workspaceDependencies);

async function build() {
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'src/index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'esm',
      outfile: path.join(__dirname, '..', 'dist', 'server.js'),
      external: [
        // File compression libraries - have native dependencies
        'adm-zip',
        'archiver',
        // Canvas has native dependencies that can't be bundled
        'canvas',
        'pino-pretty',
        // Playwright and its native dependencies - ALL variations
        'playwright',
        'playwright-core',
        'playwright-chromium',
        'playwright-firefox',
        'playwright-webkit',
        '@playwright/test',
        // Electron (used by playwright)
        'electron',
        // Native node modules that can't be bundled
        'fsevents',
        // External dependencies for plugins that use browser automation
        '@browserbasehq/stagehand',
        // Additional playwright dependencies that might cause issues
        'playwright-core/lib/server/electron/loader.js',
        'playwright/lib/server/electron/loader.js',
        // WebSocket library - REMOVED from external to bundle it
        // 'ws',
        // Ensure the plugin's browser automation deps are external
        '@elizaos/plugin-stagehand/stagehand-server',
        // Vision plugin dependencies that should remain external
        'sharp',
        'jimp',
        // Fastembed and ONNX Runtime dependencies - have native bindings
        'fastembed',
        'onnxruntime-node',
        '@anush008/tokenizers',
        '@anush008/tokenizers-darwin-universal',
        'onnxruntime-extensions',
      ],
      // Add a plugin to resolve workspace dependencies
      plugins: [
        {
          name: 'workspace-resolver',
          setup(build) {
            const fs = require('fs');
            const path = require('path');

            // Resolve @elizaos/* packages to their dist directories
            build.onResolve({ filter: /^@elizaos\// }, (args) => {
              const packageName = args.path;
              const packageDir = packageName.replace('@elizaos/', '');
              const packagePath = path.resolve(
                __dirname,
                '..',
                '..',
                packageDir,
                'dist',
                'index.js'
              );

              // Check if the built package exists
              if (fs.existsSync(packagePath)) {
                return { path: packagePath };
              }

              // Fallback to source if dist doesn't exist
              const srcPath = path.resolve(__dirname, '..', '..', packageDir, 'src', 'index.ts');
              if (fs.existsSync(srcPath)) {
                return { path: srcPath };
              }

              return null;
            });
          },
        },
      ],
      sourcemap: true,
      minify: false,
      loader: {
        '.ts': 'ts',
        '.js': 'js',
      },
      resolveExtensions: ['.ts', '.js', '.json'],
      tsconfig: path.join(__dirname, '..', 'tsconfig.json'),
      banner: {
        js: `// CRITICAL: Load DOM polyfills FIRST before any module execution
import { createRequire as __createRequire } from "module"; 
const require = __createRequire(import.meta.url);

// INLINE DOM POLYFILLS - MUST BE FIRST
(function() {
  console.log('[POLYFILL-BANNER] Loading critical DOM polyfills...');
  
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class MockDOMMatrix {
      constructor(init) {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
        if (typeof init === 'string') {
          Object.assign(this, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
        } else if (init && typeof init === 'object') {
          Object.assign(this, init);
        }
        return this;
      }
      translate(x = 0, y = 0) { return this; }
      scale(x = 1, y = x) { return this; }
      rotate(angle = 0) { return this; }
      multiply(matrix) { return this; }
      inverse() { return this; }
      toString() { return \`matrix(\${this.a}, \${this.b}, \${this.c}, \${this.d}, \${this.e}, \${this.f})\`; }
      static fromMatrix(matrix) { return new globalThis.DOMMatrix(matrix); }
      static fromFloat32Array(array) { return new globalThis.DOMMatrix(); }
      static fromFloat64Array(array) { return new globalThis.DOMMatrix(); }
    };
  }
  
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class MockImageData {
      constructor(dataOrWidth, height, width) {
        if (dataOrWidth instanceof Uint8ClampedArray) {
          this.data = dataOrWidth;
          this.width = height;
          this.height = width || height;
        } else {
          this.width = dataOrWidth || 0;
          this.height = height || 0;
          this.data = new Uint8ClampedArray((dataOrWidth || 0) * (height || 0) * 4);
        }
        this.colorSpace = 'srgb';
      }
    };
  }
  
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class MockPath2D {
      constructor(path) { this.path = path || ''; }
      addPath() {} arc() {} arcTo() {} bezierCurveTo() {} closePath() {}
      ellipse() {} lineTo() {} moveTo() {} quadraticCurveTo() {} rect() {}
    };
  }
  
  if (typeof globalThis.HTMLCanvasElement === 'undefined') {
    globalThis.HTMLCanvasElement = class MockHTMLCanvasElement {
      constructor() { this.width = 300; this.height = 150; }
      getContext(type) {
        if (type === '2d') {
          return {
            arc: () => {}, beginPath: () => {}, clearRect: () => {}, closePath: () => {},
            createImageData: () => new globalThis.ImageData(1, 1),
            drawImage: () => {}, fill: () => {}, fillRect: () => {},
            getImageData: () => new globalThis.ImageData(1, 1),
            lineTo: () => {}, moveTo: () => {}, putImageData: () => {},
            restore: () => {}, save: () => {}, scale: () => {}, stroke: () => {},
            translate: () => {}, canvas: this, fillStyle: '#000', strokeStyle: '#000'
          };
        }
        return null;
      }
      toDataURL() { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; }
    };
  }
  
  // Set on all global contexts - but check for existence first
  const contexts = [];
  try { if (typeof globalThis !== 'undefined') contexts.push(globalThis); } catch (e) {}
  try { if (typeof global !== 'undefined') contexts.push(global); } catch (e) {}
  try { if (typeof window !== 'undefined') contexts.push(window); } catch (e) {}
  try { if (typeof self !== 'undefined') contexts.push(self); } catch (e) {}
  for (const ctx of contexts) {
    try {
      if (ctx && typeof ctx === 'object') {
        ctx.DOMMatrix = globalThis.DOMMatrix;
        ctx.ImageData = globalThis.ImageData;
        ctx.Path2D = globalThis.Path2D;
        ctx.HTMLCanvasElement = globalThis.HTMLCanvasElement;
      }
    } catch (e) {}
  }
  
  console.log('[POLYFILL-BANNER] ✅ Critical DOM polyfills loaded');
})();`,
      },
    });

    console.log('Backend build complete!');

    // Copy public folder to dist
    const fs = require('fs');
    const publicDir = path.join(__dirname, '..', 'public');
    const distPublicDir = path.join(__dirname, '..', 'dist', 'public');

    if (fs.existsSync(publicDir)) {
      // Create dist/public directory if it doesn't exist
      if (!fs.existsSync(distPublicDir)) {
        fs.mkdirSync(distPublicDir, { recursive: true });
      }

      // Copy files from public to dist/public
      const files = fs.readdirSync(publicDir);
      files.forEach((file) => {
        const srcPath = path.join(publicDir, file);
        const destPath = path.join(distPublicDir, file);
        fs.copyFileSync(srcPath, destPath);
      });

      console.log('Public folder copied to dist/public');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
