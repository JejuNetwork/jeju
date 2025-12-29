import { createHash } from 'node:crypto'

export type RouteType =
  | 'api-route' // pages/api/...
  | 'route-handler' // app/.../route.ts
  | 'server-action' // Server Actions
  | 'middleware' // Middleware
  | 'edge-function' // Edge functions

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export interface CompiledRoute {
  routeId: string
  type: RouteType
  path: string
  methods: HttpMethod[]
  runtime: 'edge' | 'nodejs'

  // Compiled output
  code: string
  sourceMap?: string

  // Dependencies
  imports: string[]
  externals: string[]

  // Metadata
  sourcePath: string
  hash: string
  sizeBytes: number
}

export interface CompilationResult {
  routes: CompiledRoute[]
  manifest: WorkerManifest
  errors: CompilationError[]
  warnings: string[]
  duration: number
}

export interface CompilationError {
  file: string
  line?: number
  column?: number
  message: string
  code: string
}

export interface WorkerManifest {
  version: string
  routes: Array<{
    path: string
    routeId: string
    methods: HttpMethod[]
    runtime: 'edge' | 'nodejs'
  }>
  middleware?: {
    matcher: string[]
    routeId: string
  }
  staticAssets: string[]
}

export interface NextJSProject {
  rootDir: string
  pagesDir?: string
  appDir?: string
  nextConfig: NextConfig
}

export interface NextConfig {
  experimental?: {
    serverActions?: boolean
  }
  images?: {
    domains?: string[]
  }
}

// ============================================================================
// Route Parser
// ============================================================================

interface ParsedRoute {
  sourcePath: string
  routePath: string
  type: RouteType
  methods: HttpMethod[]
  runtime: 'edge' | 'nodejs'
  isDynamic: boolean
  params: string[]
}

function parseRoutePath(filePath: string, baseDir: string): ParsedRoute | null {
  const relativePath = filePath.replace(baseDir, '').replace(/^\//, '')

  // Pages Router API Route: pages/api/*.ts
  if (relativePath.startsWith('pages/api/')) {
    const routePath = `/${relativePath
      .replace('pages/', '')
      .replace(/\.(ts|js|tsx|jsx)$/, '')
      .replace(/\/index$/, '')}`

    return {
      sourcePath: filePath,
      routePath: convertDynamicSegments(routePath),
      type: 'api-route',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      runtime: 'nodejs', // Default, can be overridden
      isDynamic: routePath.includes('['),
      params: extractParams(routePath),
    }
  }

  // App Router Route Handler: app/*/route.ts
  if (relativePath.startsWith('app/') && relativePath.endsWith('route.ts')) {
    const routePath = `/${relativePath
      .replace('app/', '')
      .replace('/route.ts', '')
      .replace(/^\//, '')}`

    return {
      sourcePath: filePath,
      routePath: convertDynamicSegments(routePath || '/'),
      type: 'route-handler',
      methods: [], // Determined by exported functions
      runtime: 'edge', // Default for App Router
      isDynamic: routePath.includes('['),
      params: extractParams(routePath),
    }
  }

  // Middleware: middleware.ts at root
  if (
    relativePath === 'middleware.ts' ||
    relativePath === 'src/middleware.ts'
  ) {
    return {
      sourcePath: filePath,
      routePath: '/_middleware',
      type: 'middleware',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      runtime: 'edge',
      isDynamic: false,
      params: [],
    }
  }

  return null
}

function convertDynamicSegments(path: string): string {
  // Convert [param] to :param
  return path
    .replace(/\[\.\.\.(\w+)\]/g, '*$1') // Catch-all [...param]
    .replace(/\[\[\.\.\.(\w+)\]\]/g, '*$1?') // Optional catch-all [[...param]]
    .replace(/\[(\w+)\]/g, ':$1') // Dynamic [param]
}

function extractParams(path: string): string[] {
  const matches = path.matchAll(/\[\.?\.?\.?(\w+)\]/g)
  return Array.from(matches, (m) => m[1])
}

// ============================================================================
// Code Transformer
// ============================================================================

interface TransformResult {
  code: string
  sourceMap?: string
  methods: HttpMethod[]
  runtime: 'edge' | 'nodejs'
}

async function transformToWorkerd(
  sourceCode: string,
  route: ParsedRoute,
): Promise<TransformResult> {
  // Detect runtime from code
  const runtime = detectRuntime(sourceCode)

  // Detect exported HTTP methods
  const methods = detectMethods(sourceCode, route.type)

  // Transform based on route type
  let transformedCode: string

  if (route.type === 'api-route') {
    transformedCode = transformPagesApiRoute(sourceCode, route)
  } else if (route.type === 'route-handler') {
    transformedCode = transformAppRouteHandler(sourceCode, route)
  } else if (route.type === 'middleware') {
    transformedCode = transformMiddleware(sourceCode)
  } else {
    transformedCode = sourceCode
  }

  // Wrap in workerd-compatible module
  const workerdCode = wrapForWorkerd(transformedCode, route, methods)

  return {
    code: workerdCode,
    methods,
    runtime,
  }
}

function detectRuntime(code: string): 'edge' | 'nodejs' {
  // Check for edge runtime config
  if (code.includes("runtime = 'edge'") || code.includes('runtime: "edge"')) {
    return 'edge'
  }
  if (code.includes("runtime = 'experimental-edge'")) {
    return 'edge'
  }
  return 'nodejs'
}

function detectMethods(code: string, type: RouteType): HttpMethod[] {
  if (type === 'api-route') {
    // Pages API routes use default export
    return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  }

  // App Router exports named functions
  const methods: HttpMethod[] = []

  if (/export\s+(async\s+)?function\s+GET/m.test(code)) methods.push('GET')
  if (/export\s+(async\s+)?function\s+POST/m.test(code)) methods.push('POST')
  if (/export\s+(async\s+)?function\s+PUT/m.test(code)) methods.push('PUT')
  if (/export\s+(async\s+)?function\s+PATCH/m.test(code)) methods.push('PATCH')
  if (/export\s+(async\s+)?function\s+DELETE/m.test(code))
    methods.push('DELETE')
  if (/export\s+(async\s+)?function\s+HEAD/m.test(code)) methods.push('HEAD')
  if (/export\s+(async\s+)?function\s+OPTIONS/m.test(code))
    methods.push('OPTIONS')

  return methods.length > 0 ? methods : ['GET']
}

function transformPagesApiRoute(code: string, route: ParsedRoute): string {
  // Transform Pages API route to workerd fetch handler
  return `
// Transformed from Next.js Pages API Route
import { NextResponse } from 'next/server';

${code}

// Workerd adapter for Pages API route
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const params = ${JSON.stringify(Object.fromEntries(route.params.map((p) => [p, ''])))};
  
  // Extract dynamic params from URL
  ${route.params.map((p, i) => `params['${p}'] = url.pathname.split('/')[${i + 2}] || '';`).join('\n  ')}
  
  // Create Next.js-like request/response
  const req = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(url.searchParams.entries()),
    body: request.body ? await request.json().catch(() => null) : null,
    cookies: parseCookies(request.headers.get('cookie') || ''),
  };
  
  let statusCode = 200;
  let responseHeaders = new Headers();
  let responseBody = null;
  
  const res = {
    status: (code) => { statusCode = code; return res; },
    json: (data) => { responseBody = JSON.stringify(data); responseHeaders.set('Content-Type', 'application/json'); return res; },
    send: (data) => { responseBody = data; return res; },
    setHeader: (name, value) => { responseHeaders.set(name, value); return res; },
    end: () => {},
  };
  
  try {
    await handler(req, res);
    return new Response(responseBody, { status: statusCode, headers: responseHeaders });
  } catch (error) {
    console.error('API route error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

export default { fetch: handleRequest };
`
}

function transformAppRouteHandler(code: string, route: ParsedRoute): string {
  // Transform App Router handler to workerd fetch handler
  return `
// Transformed from Next.js App Router Handler
${code}

// Workerd adapter for App Router
async function handleRequest(request, env, ctx) {
  const method = request.method;
  
  // Route to appropriate handler
  ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    .map(
      (m) => `
  if (method === '${m}' && typeof ${m} === 'function') {
    const params = extractParams(request);
    return ${m}(request, { params });
  }`,
    )
    .join('')}
  
  return new Response('Method Not Allowed', { status: 405 });
}

function extractParams(request) {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  return ${JSON.stringify(Object.fromEntries(route.params.map((p, i) => [p, `segments[${i}]`])))};
}

export default { fetch: handleRequest };
`
}

function transformMiddleware(code: string): string {
  return `
// Transformed from Next.js Middleware
${code}

// Workerd adapter for Middleware
async function handleRequest(request, env, ctx) {
  const response = await middleware(request);
  return response || new Response(null, { status: 200 });
}

export default { fetch: handleRequest };
`
}

function wrapForWorkerd(
  code: string,
  route: ParsedRoute,
  methods: HttpMethod[],
): string {
  return `
/**
 * Auto-generated workerd module
 * Source: ${route.sourcePath}
 * Path: ${route.routePath}
 * Methods: ${methods.join(', ')}
 */

${code}
`
}

// ============================================================================
// Next.js Compiler
// ============================================================================

export class NextJSCompiler {
  private project: NextJSProject

  constructor(project: NextJSProject) {
    this.project = project
  }

  async compile(): Promise<CompilationResult> {
    const startTime = Date.now()
    const routes: CompiledRoute[] = []
    const errors: CompilationError[] = []
    const warnings: string[] = []

    // Find all route files
    const routeFiles = await this.findRouteFiles()

    for (const filePath of routeFiles) {
      const parsed = parseRoutePath(filePath, this.project.rootDir)
      if (!parsed) continue

      try {
        // Read source file
        const sourceCode = await this.readFile(filePath)

        // Transform to workerd format
        const result = await transformToWorkerd(sourceCode, parsed)

        const routeId = createHash('sha256')
          .update(filePath)
          .digest('hex')
          .slice(0, 16)

        const compiled: CompiledRoute = {
          routeId,
          type: parsed.type,
          path: parsed.routePath,
          methods: result.methods,
          runtime: result.runtime,
          code: result.code,
          sourceMap: result.sourceMap,
          imports: this.extractImports(sourceCode),
          externals: this.detectExternals(sourceCode),
          sourcePath: filePath,
          hash: createHash('sha256')
            .update(result.code)
            .digest('hex')
            .slice(0, 16),
          sizeBytes: Buffer.byteLength(result.code),
        }

        routes.push(compiled)

        console.log(`[NextJS] Compiled ${parsed.type}: ${parsed.routePath}`)
      } catch (error) {
        errors.push({
          file: filePath,
          message: error instanceof Error ? error.message : String(error),
          code: 'COMPILATION_ERROR',
        })
      }
    }

    // Generate manifest
    const manifest = this.generateManifest(routes)

    return {
      routes,
      manifest,
      errors,
      warnings,
      duration: Date.now() - startTime,
    }
  }

  private async findRouteFiles(): Promise<string[]> {
    const files: string[] = []

    // Scan pages/api directory
    if (this.project.pagesDir) {
      const apiDir = `${this.project.pagesDir}/api`
      files.push(...(await this.globFiles(`${apiDir}/**/*.{ts,js,tsx,jsx}`)))
    }

    // Scan app directory for route handlers
    if (this.project.appDir) {
      files.push(
        ...(await this.globFiles(`${this.project.appDir}/**/route.{ts,js}`)),
      )
    }

    // Find middleware
    const middlewareFiles = [
      `${this.project.rootDir}/middleware.ts`,
      `${this.project.rootDir}/middleware.js`,
      `${this.project.rootDir}/src/middleware.ts`,
      `${this.project.rootDir}/src/middleware.js`,
    ]

    for (const mw of middlewareFiles) {
      if (await this.fileExists(mw)) {
        files.push(mw)
        break
      }
    }

    return files
  }

  private async globFiles(pattern: string): Promise<string[]> {
    // Use Bun's glob
    const glob = new Bun.Glob(pattern)
    const files: string[] = []
    for await (const file of glob.scan({ cwd: this.project.rootDir })) {
      files.push(`${this.project.rootDir}/${file}`)
    }
    return files
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await Bun.file(path).exists()
      return true
    } catch {
      return false
    }
  }

  private async readFile(path: string): Promise<string> {
    return Bun.file(path).text()
  }

  private extractImports(code: string): string[] {
    const imports: string[] = []
    const regex =
      /import\s+(?:(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g
    let match: RegExpExecArray | null = regex.exec(code)
    while (match !== null) {
      imports.push(match[1])
      match = regex.exec(code)
    }
    return imports
  }

  private detectExternals(code: string): string[] {
    const imports = this.extractImports(code)
    return imports.filter((i) => !i.startsWith('.') && !i.startsWith('/'))
  }

  private generateManifest(routes: CompiledRoute[]): WorkerManifest {
    const middleware = routes.find((r) => r.type === 'middleware')

    return {
      version: '1.0.0',
      routes: routes
        .filter((r) => r.type !== 'middleware')
        .map((r) => ({
          path: r.path,
          routeId: r.routeId,
          methods: r.methods,
          runtime: r.runtime,
        })),
      middleware: middleware
        ? {
            matcher: ['/*'], // Would parse from config
            routeId: middleware.routeId,
          }
        : undefined,
      staticAssets: [],
    }
  }
}

// ============================================================================
// Vite/Elysia Compiler
// ============================================================================

export class ElysiaCompiler {
  private rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
  }

  async compile(): Promise<CompilationResult> {
    const startTime = Date.now()
    const routes: CompiledRoute[] = []
    const errors: CompilationError[] = []
    const warnings: string[] = []

    // Find entry file
    const entryFiles = [
      `${this.rootDir}/src/index.ts`,
      `${this.rootDir}/api/index.ts`,
      `${this.rootDir}/server/index.ts`,
      `${this.rootDir}/index.ts`,
    ]

    let entryFile: string | null = null
    for (const f of entryFiles) {
      if (await Bun.file(f).exists()) {
        entryFile = f
        break
      }
    }

    if (!entryFile) {
      errors.push({
        file: this.rootDir,
        message: 'No entry file found',
        code: 'NO_ENTRY',
      })
      return {
        routes,
        manifest: this.generateEmptyManifest(),
        errors,
        warnings,
        duration: Date.now() - startTime,
      }
    }

    // Bundle with Bun
    const buildResult = await Bun.build({
      entrypoints: [entryFile],
      target: 'bun',
      minify: true,
      sourcemap: 'external',
    })

    if (!buildResult.success) {
      for (const log of buildResult.logs) {
        errors.push({
          file: entryFile,
          message: log.message,
          code: 'BUILD_ERROR',
        })
      }
      return {
        routes,
        manifest: this.generateEmptyManifest(),
        errors,
        warnings,
        duration: Date.now() - startTime,
      }
    }

    const output = buildResult.outputs[0]
    const code = await output.text()

    const routeId = createHash('sha256')
      .update(entryFile)
      .digest('hex')
      .slice(0, 16)

    routes.push({
      routeId,
      type: 'route-handler',
      path: '/*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      runtime: 'edge',
      code: this.wrapElysiaForWorkerd(code),
      imports: [],
      externals: [],
      sourcePath: entryFile,
      hash: createHash('sha256').update(code).digest('hex').slice(0, 16),
      sizeBytes: Buffer.byteLength(code),
    })

    return {
      routes,
      manifest: this.generateManifest(routes),
      errors,
      warnings,
      duration: Date.now() - startTime,
    }
  }

  private wrapElysiaForWorkerd(code: string): string {
    return `
// Wrapped Elysia app for workerd
${code}

// Export fetch handler
export default {
  async fetch(request, env, ctx) {
    // Elysia's app.handle is the fetch handler
    if (typeof app !== 'undefined' && app.handle) {
      return app.handle(request);
    }
    // If exported as default
    if (typeof exports !== 'undefined' && exports.default && exports.default.handle) {
      return exports.default.handle(request);
    }
    return new Response('Not Found', { status: 404 });
  }
};
`
  }

  private generateManifest(routes: CompiledRoute[]): WorkerManifest {
    return {
      version: '1.0.0',
      routes: routes.map((r) => ({
        path: r.path,
        routeId: r.routeId,
        methods: r.methods,
        runtime: r.runtime,
      })),
      staticAssets: [],
    }
  }

  private generateEmptyManifest(): WorkerManifest {
    return {
      version: '1.0.0',
      routes: [],
      staticAssets: [],
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export async function compileNextJS(
  rootDir: string,
): Promise<CompilationResult> {
  // Detect project structure
  const pagesDir = (await Bun.file(`${rootDir}/pages`).exists())
    ? `${rootDir}/pages`
    : undefined
  const appDir = (await Bun.file(`${rootDir}/app`).exists())
    ? `${rootDir}/app`
    : undefined

  // Load next.config
  let nextConfig: NextConfig = {}
  const configPath = `${rootDir}/next.config.js`
  if (await Bun.file(configPath).exists()) {
    // Would require() the config
    nextConfig = {}
  }

  const compiler = new NextJSCompiler({
    rootDir,
    pagesDir,
    appDir,
    nextConfig,
  })

  return compiler.compile()
}

export async function compileElysia(
  rootDir: string,
): Promise<CompilationResult> {
  const compiler = new ElysiaCompiler(rootDir)
  return compiler.compile()
}

export async function compileProject(
  rootDir: string,
  framework: 'nextjs' | 'elysia' | 'vite' | 'auto',
): Promise<CompilationResult> {
  // Auto-detect framework
  if (framework === 'auto') {
    if (
      (await Bun.file(`${rootDir}/next.config.js`).exists()) ||
      (await Bun.file(`${rootDir}/next.config.mjs`).exists())
    ) {
      framework = 'nextjs'
    } else if (await Bun.file(`${rootDir}/vite.config.ts`).exists()) {
      framework = 'vite'
    } else {
      framework = 'elysia'
    }
  }

  switch (framework) {
    case 'nextjs':
      return compileNextJS(rootDir)
    case 'elysia':
    case 'vite':
      return compileElysia(rootDir)
    default:
      throw new Error(`Unknown framework: ${framework}`)
  }
}
