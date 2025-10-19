import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@elizaos/core',
    '@elizaos/plugin-openai',
    '@elizaos/plugin-anthropic',
    '@elizaos/plugin-ollama',
    '@elizaos/plugin-elizaos-services',
    '@elizaos/plugin-groq',
    '@elizaos/plugin-local-embedding',
  ],
});
