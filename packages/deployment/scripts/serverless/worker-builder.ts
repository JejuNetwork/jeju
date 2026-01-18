/**
 * Worker Builder
 *
 * Builds Elysia apps for workerd/Cloudflare Workers compatibility.
 * Handles bundling, tree-shaking, and worker wrapper generation.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import { z } from 'zod'
import type { ServerlessWorkerConfig, WorkerBuildOutput } from './types'

// Package.json schema
const PackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
})

// Constants

// Builder Class

export class WorkerBuilder {
  private outputDir: string

  constructor(rootDir: string, outputDir?: string) {
    this.outputDir = outputDir || join(rootDir, 'dist', 'worker')
  }

  /**
   * Build a worker from an Elysia app
   */
  async build(
    appPath: string,
    config: ServerlessWorkerConfig,
  ): Promise<WorkerBuildOutput> {
    console.log(`[WorkerBuilder] Building worker: ${config.name}`)
    console.log(`[WorkerBuilder] Entrypoint: ${config.entrypoint}`)

    // Ensure output directory exists
    const workerOutputDir = join(this.outputDir, config.name)
    mkdirSync(workerOutputDir, { recursive: true })

    const entrypointPath = join(appPath, config.entrypoint)
    if (!existsSync(entrypointPath)) {
      throw new Error(`Entrypoint not found: ${entrypointPath}`)
    }

    // Step 1: Generate a temporary wrapper that imports the app
    const tempWrapperPath = join(workerOutputDir, '_temp_wrapper.ts')
    this.generateTempWrapper(entrypointPath, tempWrapperPath)

    // Step 2: Bundle everything together into a single file
    const workerPath = join(workerOutputDir, 'worker.js')
    await this.bundleApp(tempWrapperPath, workerPath)

    // Clean up temp file
    Bun.file(tempWrapperPath)
      .exists()
      .then((exists) => {
        if (exists) Bun.write(tempWrapperPath, '')
      })

    // Step 3: Generate workerd config
    const configPath = join(workerOutputDir, 'wrangler.toml')
    this.generateWranglerConfig(config, workerOutputDir, configPath)

    // Step 4: Also generate capnp config for pure workerd usage
    const capnpPath = join(workerOutputDir, 'config.capnp')
    this.generateCapnpConfig(config, capnpPath)

    // Calculate content hash
    const workerContent = readFileSync(workerPath)
    const contentHash = bytesToHex(hash256(new Uint8Array(workerContent)))

    // Get bundle size
    const stats = Bun.file(workerPath)
    const size = stats.size

    // Get dependencies
    const dependencies = await this.getDependencies(entrypointPath)

    console.log(
      `[WorkerBuilder] Built ${config.name}: ${(size / 1024).toFixed(1)}KB`,
    )

    return {
      bundlePath: workerPath,
      contentHash,
      size,
      dependencies,
    }
  }

  /**
   * Detect the export pattern of an entrypoint file
   */
  private detectExportPattern(
    appPath: string,
  ): 'worker' | 'elysia-listen' | 'elysia-export' | 'unknown' {
    const content = readFileSync(appPath, 'utf-8')

    // Check for worker pattern: export default { fetch: ... }
    if (
      content.includes('export default') &&
      (content.includes('.fetch') || content.includes('async fetch'))
    ) {
      return 'worker'
    }

    // Check for Elysia with app.listen pattern
    if (
      (content.includes('new Elysia') || content.includes('from "elysia"')) &&
      (content.includes('.listen(') || content.includes('app.listen'))
    ) {
      return 'elysia-listen'
    }

    // Check for Elysia export pattern (exports the app directly)
    if (
      content.includes('new Elysia') &&
      content.includes('export default') &&
      !content.includes('.listen(')
    ) {
      return 'elysia-export'
    }

    return 'unknown'
  }

  /**
   * Generate a temporary wrapper file that will be bundled
   * This creates a self-contained bundle with the server startup code
   * Handles both worker format (export default { fetch }) and Elysia app.listen() format
   */
  private generateTempWrapper(appPath: string, outputPath: string): void {
    const relativePath = relative(dirname(outputPath), appPath)
      .replace(/\\/g, '/')
      .replace(/\.ts$/, '')

    const pattern = this.detectExportPattern(appPath)
    console.log(`[WorkerBuilder] Detected export pattern: ${pattern}`)

    let wrapper: string

    if (pattern === 'worker') {
      // App exports a worker-compatible default export with fetch method
      // SECURITY: All environment values are read at RUNTIME, never embedded at build time
      wrapper = `// Temporary wrapper for bundling - worker format
// SECURITY: No secrets or sensitive config embedded - all read at runtime
import worker from './${relativePath}';

const PORT = parseInt(process.env.PORT || '8080', 10);

// RUNTIME environment - all values from process.env or injected bindings
// NEVER hardcode sensitive values here
const env = {
  // Public config - read at runtime
  NETWORK: process.env.JEJU_NETWORK || process.env.NETWORK || 'localnet',
  TEE_MODE: process.env.TEE_MODE || 'simulated',
  TEE_PLATFORM: process.env.TEE_PLATFORM || 'local',
  TEE_REGION: process.env.TEE_REGION || 'local',
  RPC_URL: process.env.RPC_URL || '',
  DWS_URL: process.env.DWS_URL || '',
  FUNCTION_ID: process.env.FUNCTION_ID || '',
  INSTANCE_ID: process.env.INSTANCE_ID || '',
  // KMS configuration for secret retrieval
  KMS_ENDPOINT: process.env.KMS_ENDPOINT || '',
  KMS_SECRET_IDS: process.env.KMS_SECRET_IDS || '[]',
  OWNER_ADDRESS: process.env.OWNER_ADDRESS || '',
  WORKER_ID: process.env.WORKER_ID || process.env.FUNCTION_ID || '',
};

const handler = async (request: Request) => {
  const headers = new Headers(request.headers);
  headers.set('x-network', env.NETWORK);
  headers.set('x-tee-mode', env.TEE_MODE);
  headers.set('x-function-id', env.FUNCTION_ID);

  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
  });

  try {
    const response = await worker.fetch(modifiedRequest, env, {
      waitUntil: () => {},
      passThroughOnException: () => {},
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-powered-by', 'jeju-dws');
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Worker] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

Bun.serve({ port: PORT, fetch: handler });
console.log(\`Worker running on port \${PORT}\`);
`
    } else if (pattern === 'elysia-listen' || pattern === 'elysia-export') {
      // App uses Elysia with app.listen() - we import the exported app and use its handle method
      // Elysia apps have a built-in handle() method that processes requests
      // See: https://elysiajs.com/integrations/cloudflare-worker
      wrapper = `// Temporary wrapper for bundling - Elysia app pattern
// Imports the Elysia app and wraps it for Bun.serve

import * as appModule from './${relativePath}';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Find the Elysia app instance from exports
// Elysia apps have both .handle() and .fetch() methods
type ElysiaLike = { handle: (req: Request) => Promise<Response> } | { fetch: (req: Request) => Promise<Response> };
let elysiaApp: ElysiaLike | null = null;

// Check named exports first (e.g., export { app })
for (const [name, exp] of Object.entries(appModule)) {
  if (exp && typeof exp === 'object') {
    const expRecord = exp as Record<string, unknown>;
    if (typeof expRecord.handle === 'function') {
      elysiaApp = exp as ElysiaLike;
      console.log('[Worker] Found Elysia app via export:', name);
      break;
    }
    if (typeof expRecord.fetch === 'function') {
      elysiaApp = exp as ElysiaLike;
      console.log('[Worker] Found Elysia app with fetch via export:', name);
      break;
    }
  }
}

if (!elysiaApp) {
  console.error('[Worker] ERROR: No Elysia app found in exports');
  console.error('[Worker] Available exports:', Object.keys(appModule));
  process.exit(1);
}

// RUNTIME environment - all values from process.env or injected bindings
// SECURITY: No secrets embedded at build time
const env = {
  NETWORK: process.env.JEJU_NETWORK || process.env.NETWORK || 'localnet',
  TEE_MODE: process.env.TEE_MODE || 'simulated',
  TEE_PLATFORM: process.env.TEE_PLATFORM || 'local',
  TEE_REGION: process.env.TEE_REGION || 'local',
  FUNCTION_ID: process.env.FUNCTION_ID || '',
  KMS_ENDPOINT: process.env.KMS_ENDPOINT || '',
  KMS_SECRET_IDS: process.env.KMS_SECRET_IDS || '[]',
  OWNER_ADDRESS: process.env.OWNER_ADDRESS || '',
  WORKER_ID: process.env.WORKER_ID || process.env.FUNCTION_ID || '',
};

// Use the app's handle or fetch method
const appHandler = 'handle' in elysiaApp
  ? elysiaApp.handle.bind(elysiaApp)
  : elysiaApp.fetch.bind(elysiaApp);

const handler = async (request: Request) => {
  // Inject DWS environment headers
  const headers = new Headers(request.headers);
  headers.set('x-network', env.NETWORK);
  headers.set('x-tee-mode', env.TEE_MODE);
  headers.set('x-function-id', env.FUNCTION_ID);

  const modifiedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
  });

  try {
    const response = await appHandler(modifiedRequest);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-powered-by', 'jeju-dws');
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Worker] Request error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// Start the Bun server
Bun.serve({ port: PORT, fetch: handler });
console.log('[Worker] Server running on port', PORT);
`
    } else {
      // Unknown pattern - try the worker format and hope for the best
      console.warn(
        `[WorkerBuilder] Unknown export pattern, trying worker format`,
      )
      wrapper = `// Temporary wrapper for bundling - unknown format (trying worker)
import worker from './${relativePath}';

const PORT = parseInt(process.env.PORT || '8080', 10);

const handler = async (request: Request) => {
  try {
    if (typeof worker.fetch === 'function') {
      return worker.fetch(request, process.env, {});
    }
    if (typeof worker.handle === 'function') {
      return worker.handle(request);
    }
    if (typeof worker === 'function') {
      return worker(request);
    }
    throw new Error('Unknown worker format');
  } catch (error) {
    console.error('[Worker] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', message: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

Bun.serve({ port: PORT, fetch: handler });
console.log(\`Worker running on port \${PORT}\`);
`
    }

    writeFileSync(outputPath, wrapper, 'utf-8')
  }

  /**
   * Bundle the Elysia app using Bun's bundler
   * For local dev (DWS Bun runtime): use 'bun' target
   * For production (workerd): use 'browser' target with polyfills
   */
  private async bundleApp(
    entrypoint: string,
    output: string,
    forWorkerd = false,
  ): Promise<void> {
    console.log(`[WorkerBuilder] Bundling: ${basename(entrypoint)}`)

    // For local development, use Bun target to support Bun-specific APIs
    // For workerd production, use browser target
    const target = forWorkerd ? 'browser' : 'bun'

    const result = await Bun.build({
      entrypoints: [entrypoint],
      outdir: dirname(output),
      naming: basename(output),
      target,
      format: 'esm',
      minify: {
        whitespace: true,
        syntax: true,
        identifiers: false, // Keep identifiers for debugging
      },
      splitting: false, // Single bundle for workers
      sourcemap: 'external',
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.WORKER_MODE': '"true"',
      },
      external: forWorkerd
        ? [
            // Node.js built-ins not available in Workers
            'node:*',
            'fs',
            'path',
            'crypto',
            'stream',
            'util',
            'events',
            'buffer',
            // These should be handled by Cloudflare
            'cloudflare:*',
          ]
        : [], // For Bun, include everything
    })

    if (!result.success) {
      const errors = result.logs
        .filter((log) => log.level === 'error')
        .map((log) => log.message)
        .join('\n')
      throw new Error(`Bundle failed:\n${errors}`)
    }

    console.log(`[WorkerBuilder] Bundle complete: ${basename(output)}`)
  }

  /**
   * Generate wrangler.toml for Cloudflare Workers deployment
   * SECURITY: Does not embed secrets - use wrangler secret put or KMS
   */
  private generateWranglerConfig(
    config: ServerlessWorkerConfig,
    _outputDir: string,
    outputPath: string,
  ): void {
    const kvBindings = config.kv
      ? Object.entries(config.kv)
          .map(
            ([name, namespace]) =>
              `[[kv_namespaces]]\nbinding = "${name}"\nid = "${namespace}"`,
          )
          .join('\n\n')
      : ''

    // For KMS-managed secrets, generate reference IDs
    const kmsSecretIds = config.secrets
      ? config.secrets.map((s) => `kms:${config.name}:${s}`).join(',')
      : ''

    const secretInstructions = config.secrets
      ? config.secrets
          .map((s) => `# ${s} - managed via KMS (ID: kms:${config.name}:${s})`)
          .join('\n')
      : ''

    const toml = `# Auto-generated wrangler.toml
# Generated by @jejunetwork/deployment serverless builder
#
# SECURITY NOTES:
# - Environment vars below are non-sensitive runtime config
# - All secrets are managed via KMS, not embedded
# - Workers fetch secrets at runtime using KMS_SECRET_IDS

name = "${config.name}"
main = "worker.js"
compatibility_date = "${config.compatibilityDate}"

[vars]
# Runtime config - set these via environment or wrangler vars
# These are intentionally placeholders - set at deployment time
JEJU_NETWORK = "$JEJU_NETWORK"
NETWORK = "$JEJU_NETWORK"
TEE_MODE = "$TEE_MODE"
TEE_REGION = "$TEE_REGION"
KMS_ENDPOINT = "$KMS_ENDPOINT"
WORKER_ID = "${config.name}"
${kmsSecretIds ? `KMS_SECRET_IDS = "${kmsSecretIds}"` : '# No secrets configured'}

${kvBindings}

# Secrets managed via KMS
# Workers fetch these at runtime using the KMS client
${secretInstructions}

# Limits
[limits]
cpu_ms = ${config.timeoutMs}

# Routes
${
  config.routes
    ?.map(
      (r) =>
        `[[routes]]\npattern = "${r.pattern}"${r.zone ? `\nzone_name = "${r.zone}"` : ''}`,
    )
    .join('\n\n') ?? '# No routes configured'
}
`

    writeFileSync(outputPath, toml, 'utf-8')
    console.log(`[WorkerBuilder] Generated wrangler.toml`)
  }

  /**
   * Generate Cap'n Proto config for pure workerd usage
   * SECURITY: Uses FROM_ENVIRONMENT for runtime config, no secrets embedded
   */
  private generateCapnpConfig(
    config: ServerlessWorkerConfig,
    outputPath: string,
  ): void {
    const camelName = config.name
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^[a-z]/, (c) => c.toUpperCase())

    // Build bindings section
    // SECURITY: Use FROM_ENVIRONMENT to read values at runtime, never embed
    const bindings: string[] = []

    // Runtime environment variables - read from system environment
    bindings.push(
      `    (name = "JEJU_NETWORK", fromEnvironment = "JEJU_NETWORK")`,
    )
    bindings.push(`    (name = "NETWORK", fromEnvironment = "JEJU_NETWORK")`)
    bindings.push(`    (name = "TEE_MODE", fromEnvironment = "TEE_MODE")`)
    bindings.push(`    (name = "TEE_REGION", fromEnvironment = "TEE_REGION")`)
    bindings.push(
      `    (name = "TEE_PLATFORM", fromEnvironment = "TEE_PLATFORM")`,
    )
    bindings.push(
      `    (name = "KMS_ENDPOINT", fromEnvironment = "KMS_ENDPOINT")`,
    )
    bindings.push(
      `    (name = "OWNER_ADDRESS", fromEnvironment = "OWNER_ADDRESS")`,
    )
    bindings.push(`    (name = "FUNCTION_ID", fromEnvironment = "FUNCTION_ID")`)
    bindings.push(`    (name = "INSTANCE_ID", fromEnvironment = "INSTANCE_ID")`)
    bindings.push(`    (name = "RPC_URL", fromEnvironment = "RPC_URL")`)
    bindings.push(`    (name = "DWS_URL", fromEnvironment = "DWS_URL")`)

    // Secrets - stored in KMS, referenced by ID
    // Workers fetch these at runtime via KMS_SECRET_IDS configuration
    if (config.secrets) {
      // Add KMS secret IDs list so worker knows which secrets to fetch
      const secretIds = config.secrets
        .map((s) => `kms:${config.name}:${s}`)
        .join(',')
      bindings.push(`    (name = "KMS_SECRET_IDS", text = "${secretIds}")`)
      // Add worker ID for KMS auth
      bindings.push(`    (name = "WORKER_ID", text = "${config.name}")`)
    }

    const capnp = `# Auto-generated workerd configuration
# Generated by @jejunetwork/deployment serverless builder
# Worker: ${config.name}
# Generated: ${new Date().toISOString()}
#
# SECURITY NOTES:
# - All environment bindings use FROM_ENVIRONMENT (read at runtime)
# - Secrets are NOT embedded - workers fetch from KMS using KMS_SECRET_IDS
# - Set environment variables on the host/container before starting workerd

using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "${config.name}", worker = .${camelName}Worker),
  ],
  sockets = [
    (
      name = "http",
      address = "*:8787",
      http = (),
      service = "${config.name}"
    ),
  ],
);

const ${camelName}Worker :Workerd.Worker = (
  modules = [
    (name = "worker.js", esModule = embed "worker.js"),
  ],
  bindings = [
${bindings.join(',\n')}
  ],
  compatibilityDate = "${config.compatibilityDate}",
);
`

    writeFileSync(outputPath, capnp, 'utf-8')
    console.log(`[WorkerBuilder] Generated config.capnp`)
  }

  /**
   * Get dependencies from package.json
   */
  private async getDependencies(entrypoint: string): Promise<string[]> {
    // Walk up to find package.json
    let dir = dirname(entrypoint)
    while (dir !== '/') {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
        const pkg = PackageJsonSchema.parse(
          JSON.parse(readFileSync(pkgPath, 'utf-8')),
        )
        return Object.keys(pkg.dependencies ?? {})
      }
      dir = dirname(dir)
    }
    return []
  }

  /**
   * Build all workers for an app
   */
  async buildAll(
    apps: Array<{ path: string; config: ServerlessWorkerConfig }>,
  ): Promise<Map<string, WorkerBuildOutput>> {
    const results = new Map<string, WorkerBuildOutput>()

    for (const app of apps) {
      const output = await this.build(app.path, app.config)
      results.set(app.config.name, output)
    }

    return results
  }
}

// Frontend Builder

export class FrontendBuilder {
  /**
   * Build frontend for an app
   */
  async build(
    appPath: string,
    buildDir: string,
    buildCommand?: string,
  ): Promise<{ buildDir: string; files: string[] }> {
    console.log(`[FrontendBuilder] Building frontend for: ${basename(appPath)}`)

    const fullBuildDir = join(appPath, buildDir)

    // Run build command if provided
    if (buildCommand) {
      console.log(`[FrontendBuilder] Running: ${buildCommand}`)
      const proc = Bun.spawn(['sh', '-c', buildCommand], {
        cwd: appPath,
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        throw new Error(`Build command failed with exit code ${exitCode}`)
      }
    }

    // Check if build directory exists
    if (!existsSync(fullBuildDir)) {
      throw new Error(`Build directory not found: ${fullBuildDir}`)
    }

    // Collect all files
    const files = this.walkDir(fullBuildDir)
    console.log(`[FrontendBuilder] Found ${files.length} files`)

    return { buildDir: fullBuildDir, files }
  }

  private walkDir(dir: string): string[] {
    const files: string[] = []

    // Use shell to list files recursively
    const proc = Bun.spawnSync(['find', dir, '-type', 'f'], {
      stdout: 'pipe',
    })

    const output = proc.stdout.toString()
    const paths = output.trim().split('\n').filter(Boolean)

    for (const path of paths) {
      if (!path.includes('/node_modules/') && !path.includes('/.')) {
        files.push(path)
      }
    }

    return files
  }
}

// Export

export async function buildWorker(
  appPath: string,
  config: ServerlessWorkerConfig,
  outputDir?: string,
): Promise<WorkerBuildOutput> {
  const builder = new WorkerBuilder(appPath, outputDir)
  return builder.build(appPath, config)
}

export async function buildFrontend(
  appPath: string,
  buildDir: string,
  buildCommand?: string,
): Promise<{ buildDir: string; files: string[] }> {
  const builder = new FrontendBuilder()
  return builder.build(appPath, buildDir, buildCommand)
}
