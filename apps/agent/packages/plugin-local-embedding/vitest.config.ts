import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      '@elizaos/core': path.resolve(__dirname, '../core/src'),
      '@elizaos/plugin-openai': path.resolve(__dirname, '../plugin-openai/src'),
      '@elizaos/plugin-anthropic': path.resolve(__dirname, '../plugin-anthropic/src'),
      '@elizaos/plugin-ollama': path.resolve(__dirname, '../plugin-ollama/src'),
      '@elizaos/plugin-elizaos-services': path.resolve(__dirname, '../plugin-elizaos-services/src'),
      '@elizaos/plugin-groq': path.resolve(__dirname, '../plugin-groq/src'),
    },
  },
});
