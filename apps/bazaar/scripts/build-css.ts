/**
 * Tailwind CSS Build Script
 *
 * Processes Tailwind CSS for production without using CDN
 *
 * Note: This creates a postcss-compatible input file since globals.css
 * uses @import "tailwindcss" (v4 syntax) which requires postcss processing
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Build CSS with Tailwind CLI
 */
export async function buildCSS(): Promise<string> {
  const globalsPath = './web/globals.css'

  if (!existsSync(globalsPath)) {
    throw new Error(`CSS input file not found: ${globalsPath}`)
  }

  // Create temp directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), 'bazaar-css-'))
  const inputPath = join(tempDir, 'input.css')
  const outputPath = join(tempDir, 'output.css')

  // Read globals.css and replace @import "tailwindcss" with proper v3 directives
  let globalsContent = await readFile(globalsPath, 'utf-8')
  globalsContent = globalsContent.replace(
    '@import "tailwindcss";',
    `@tailwind base;
@tailwind components;
@tailwind utilities;`,
  )

  await writeFile(inputPath, globalsContent)

  // Run tailwindcss CLI
  const proc = Bun.spawn(
    [
      'bunx',
      'tailwindcss',
      '-i',
      inputPath,
      '-o',
      outputPath,
      '-c',
      './tailwind.config.ts',
      '--content',
      './web/**/*.{ts,tsx}',
      '--minify',
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: process.cwd(),
    },
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    await rm(tempDir, { recursive: true })
    throw new Error(`Tailwind CSS build failed: ${stderr}`)
  }

  // Read output
  const css = await readFile(outputPath, 'utf-8')

  // Cleanup temp dir
  await rm(tempDir, { recursive: true })

  return css
}

// Allow running standalone
if (import.meta.main) {
  const css = await buildCSS()
  console.log('CSS built successfully.')
  console.log(`Output size: ${(css.length / 1024).toFixed(2)} KB`)
}
