/**
 * Tailwind CSS Build Script
 *
 * Processes Tailwind CSS for production without using CDN
 * Uses Tailwind CLI to compile and minify CSS
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Build CSS with Tailwind CLI
 */
export async function buildCSS(): Promise<string> {
  const globalsPath = './web/styles/globals.css'

  if (!existsSync(globalsPath)) {
    throw new Error(`CSS input file not found: ${globalsPath}`)
  }

  // Create temp directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), 'factory-css-'))
  const inputPath = join(tempDir, 'input.css')
  const outputPath = join(tempDir, 'output.css')

  // Read globals.css and prepend Tailwind directives
  const globalsContent = await readFile(globalsPath, 'utf-8')

  // Create input with Tailwind directives
  const inputContent = `@tailwind base;
@tailwind components;
@tailwind utilities;

${globalsContent}`

  await writeFile(inputPath, inputContent)

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
      './web/**/*.{ts,tsx,html}',
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
  console.log('Building Tailwind CSS...')
  const css = await buildCSS()
  console.log('CSS built successfully.')
  console.log(`Output size: ${(css.length / 1024).toFixed(2)} KB`)
}
