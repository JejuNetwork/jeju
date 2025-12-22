import { $ } from 'bun'

await $`rm -rf dist`
await $`tsc`

console.log('Build complete')
