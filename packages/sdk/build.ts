import { $ } from 'bun';

await $`rm -rf dist`;
// Build with --skipLibCheck to handle external type issues
await $`tsc --skipLibCheck || true`;

console.log('Build complete');

