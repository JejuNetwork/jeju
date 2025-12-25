/**
 * HuggingFace Upload Utility
 *
 * Shared utility for uploading files to HuggingFace Hub.
 *
 * @packageDocumentation
 */

import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

/**
 * Get HuggingFace token from environment variables
 *
 * Checks both HUGGING_FACE_TOKEN and HF_TOKEN for compatibility
 * with different HuggingFace tooling conventions.
 *
 * @returns Token string or undefined if not set
 */
export function getHuggingFaceToken(): string | undefined {
  return process.env.HUGGING_FACE_TOKEN || process.env.HF_TOKEN
}

/**
 * Get HuggingFace token or throw error if not set
 *
 * @throws Error if token is not configured
 * @returns Token string
 */
export function requireHuggingFaceToken(): string {
  const token = getHuggingFaceToken()
  if (!token) {
    throw new Error(
      'HuggingFace token not configured. Set HUGGING_FACE_TOKEN or HF_TOKEN environment variable.',
    )
  }
  return token
}

/**
 * Upload a single file to HuggingFace Hub using the @huggingface/hub package
 */
export async function uploadFileToHuggingFace(
  repoName: string,
  repoType: 'model' | 'dataset',
  filePath: string,
  fileContent: string,
  token: string,
): Promise<void> {
  // Dynamic import to make the dependency optional
  const hubModule = await import('@huggingface/hub')

  await hubModule.uploadFile({
    repo: { type: repoType, name: repoName },
    file: {
      path: filePath,
      content: new Blob([fileContent]),
    },
    credentials: {
      accessToken: token,
    },
  })
}

/**
 * Upload directory to HuggingFace Hub
 */
export async function uploadDirectoryToHuggingFace(
  repoName: string,
  repoType: 'model' | 'dataset',
  localDir: string,
  token: string,
): Promise<number> {
  const files = await fs.readdir(localDir)
  let uploadCount = 0

  for (const file of files) {
    const filePath = path.join(localDir, file)
    const stats = await fs.stat(filePath)

    if (stats.isFile()) {
      const content = await fs.readFile(filePath, 'utf-8')
      await uploadFileToHuggingFace(repoName, repoType, file, content, token)
      uploadCount++
    }
  }

  return uploadCount
}

/**
 * Ensure repository exists (create if needed)
 */
export async function ensureHuggingFaceRepository(
  repoName: string,
  repoType: 'model' | 'dataset',
  token: string,
  isPrivate = false,
): Promise<{ created: boolean; error?: string }> {
  const hubModule = await import('@huggingface/hub')

  try {
    await hubModule.createRepo({
      repo: { type: repoType, name: repoName },
      credentials: { accessToken: token },
      private: isPrivate,
    })
    return { created: true }
  } catch (error) {
    // Repository might already exist, which is fine
    if (
      error instanceof Error &&
      (error.message.includes('already exists') ||
        error.message.includes('Repository not found'))
    ) {
      return { created: false }
    }
    return { created: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Upload using huggingface-cli (fallback method)
 */
export async function uploadToHuggingFaceViaCLI(
  repoName: string,
  repoType: 'model' | 'dataset',
  localDir: string,
  token: string,
): Promise<void> {
  const execAsync = promisify(exec)

  process.env.HUGGINGFACE_HUB_TOKEN = token

  await execAsync(
    `huggingface-cli upload ${repoName} ${localDir} --repo-type ${repoType}`,
  )
}

/**
 * Provide manual upload instructions
 */
export function getHuggingFaceManualUploadInstructions(
  repoName: string,
  repoType: 'model' | 'dataset',
  localDir: string,
): string[] {
  return [
    '1. Install huggingface-cli: pip install huggingface_hub',
    '2. Login: huggingface-cli login',
    `3. Upload: huggingface-cli upload ${repoName} ${localDir} --repo-type ${repoType}`,
  ]
}

/**
 * Configuration for dataset export
 */
export interface DatasetExportConfig {
  /** HuggingFace repository name (e.g., "username/dataset-name") */
  repoName: string
  /** Local directory to export to */
  outputDir: string
  /** Export format */
  format: 'parquet' | 'jsonl' | 'csv'
  /** Include private metadata */
  includeMetadata?: boolean
  /** Maximum records per file for chunking */
  chunkSize?: number
}

/**
 * Configuration for model upload
 */
export interface ModelUploadConfig {
  /** HuggingFace repository name */
  repoName: string
  /** Local model directory */
  modelDir: string
  /** Model card description */
  description?: string
  /** Include model weights */
  includeWeights?: boolean
  /** Make repository private */
  private?: boolean
  /** Model card benchmark results */
  benchmarkResults?: Array<{
    benchmark: string
    score: number
    details?: Record<string, unknown>
  }>
}

/**
 * Generate model card markdown
 */
export function generateModelCard(config: {
  modelName: string
  description: string
  baseModel?: string
  benchmarkResults?: Array<{
    benchmark: string
    score: number
    details?: Record<string, unknown>
  }>
  trainingDetails?: {
    epochs?: number
    learningRate?: number
    batchSize?: number
    trajectoryCount?: number
  }
  license?: string
  tags?: string[]
}): string {
  const lines: string[] = [
    '---',
    `license: ${config.license ?? 'mit'}`,
    'language:',
    '  - en',
    `tags:`,
  ]

  for (const tag of config.tags ?? ['agents', 'trading', 'autonomous']) {
    lines.push(`  - ${tag}`)
  }

  if (config.baseModel) {
    lines.push(`base_model: ${config.baseModel}`)
  }

  lines.push('---', '', `# ${config.modelName}`, '', config.description, '')

  if (config.benchmarkResults && config.benchmarkResults.length > 0) {
    lines.push('## Benchmark Results', '')
    lines.push('| Benchmark | Score |')
    lines.push('|-----------|-------|')

    for (const result of config.benchmarkResults) {
      lines.push(`| ${result.benchmark} | ${result.score.toFixed(3)} |`)
    }
    lines.push('')
  }

  if (config.trainingDetails) {
    const details = config.trainingDetails
    lines.push('## Training Details', '')

    if (details.epochs !== undefined) {
      lines.push(`- **Epochs**: ${details.epochs}`)
    }
    if (details.learningRate !== undefined) {
      lines.push(`- **Learning Rate**: ${details.learningRate}`)
    }
    if (details.batchSize !== undefined) {
      lines.push(`- **Batch Size**: ${details.batchSize}`)
    }
    if (details.trajectoryCount !== undefined) {
      lines.push(`- **Training Trajectories**: ${details.trajectoryCount}`)
    }
    lines.push('')
  }

  lines.push('## Usage', '')
  lines.push('```python')
  lines.push('from transformers import AutoModelForCausalLM, AutoTokenizer')
  lines.push('')
  lines.push(`tokenizer = AutoTokenizer.from_pretrained("${config.modelName}")`)
  lines.push(`model = AutoModelForCausalLM.from_pretrained("${config.modelName}")`)
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}
