import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  target: 'node20',
  format: ['esm'],
  external: ['@elizaos/core'],
  sourcemap: true,
  clean: true,
  dts: true,
});
