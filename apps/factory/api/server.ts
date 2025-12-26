/** Factory API Server */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { CORE_PORTS } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { discussionsRoutes } from './routes/discussions'
import { farcasterRoutes } from './routes/farcaster'
import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { leaderboardRoutes } from './routes/leaderboard'
import { mcpRoutes } from './routes/mcp'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { packageSettingsRoutes } from './routes/package-settings'
import { packagesRoutes } from './routes/packages'
import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'
import { repoSettingsRoutes } from './routes/repo-settings'

const PORT = Number(process.env.PORT) || CORE_PORTS.FACTORY.get()
const isDev = process.env.NODE_ENV !== 'production'

/** Auto-detect static files from dist/client if they exist */
const STATIC_DIR = 'dist/client'
const hasStaticFiles = existsSync(join(STATIC_DIR, 'index.html'))

/** MIME type mapping */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'))
  return MIME_TYPES[ext] ?? 'application/octet-stream'
}

function createApp() {
  const baseApp = new Elysia()
    .use(
      cors({
        origin: isDev
          ? '*'
          : [
              'https://factory.jejunetwork.org',
              `https://jeju.local:${CORE_PORTS.FACTORY.get()}`,
            ],
        credentials: true,
      }),
    )
    .use(
      openapi({
        provider: 'swagger-ui',
        path: '/swagger',
        documentation: {
          info: {
            title: 'Factory API',
            version: '1.0.0',
            description:
              'Developer coordination hub - bounties, jobs, git, packages, containers, models',
          },
          tags: [
            { name: 'health', description: 'Health check endpoints' },
            { name: 'bounties', description: 'Bounty management' },
            { name: 'git', description: 'Git repository operations' },
            { name: 'packages', description: 'Package registry' },
            { name: 'containers', description: 'Container registry' },
            { name: 'models', description: 'AI model hub' },
            { name: 'datasets', description: 'Dataset management' },
            { name: 'jobs', description: 'Job postings' },
            { name: 'projects', description: 'Project management' },
            { name: 'ci', description: 'CI/CD workflows' },
            { name: 'agents', description: 'AI agents' },
            { name: 'feed', description: 'Developer feed' },
            { name: 'issues', description: 'Issue tracking' },
            { name: 'pulls', description: 'Pull requests' },
            { name: 'a2a', description: 'Agent-to-Agent protocol' },
            { name: 'mcp', description: 'Model Context Protocol' },
          ],
        },
      }),
    )
    .use(healthRoutes)
    .use(bountiesRoutes)
    .use(gitRoutes)
    .use(repoSettingsRoutes)
    .use(packagesRoutes)
    .use(packageSettingsRoutes)
    .use(containersRoutes)
    .use(modelsRoutes)
    .use(datasetsRoutes)
    .use(jobsRoutes)
    .use(projectsRoutes)
    .use(ciRoutes)
    .use(agentsRoutes)
    .use(farcasterRoutes)
    .use(feedRoutes)
    .use(messagesRoutes)
    .use(discussionsRoutes)
    .use(issuesRoutes)
    .use(pullsRoutes)
    .use(a2aRoutes)
    .use(leaderboardRoutes)
    .use(mcpRoutes)

  return baseApp
}

export const app = createApp()

if (import.meta.main) {
  // Serve static files if dist/client exists
  // Note: This is registered after API routes so API routes take precedence
  if (hasStaticFiles) {
    // Catch-all for static files and SPA routes
    // Elysia registers routes in order, API routes are already registered above
    app.onError(({ code, set, request }) => {
      // Only handle NOT_FOUND errors
      if (code !== 'NOT_FOUND') return

      const url = new URL(request.url)
      const path = url.pathname

      // Check if this looks like a static file request
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(path)
      if (hasExtension) {
        const filePath = join(STATIC_DIR, path)
        const file = Bun.file(filePath)
        // Can't use async here, so just try to return the file
        if (existsSync(filePath)) {
          return new Response(file, {
            headers: { 'Content-Type': getMimeType(path) },
          })
        }
        set.status = 404
        return { error: 'File not found' }
      }

      // SPA fallback - serve index.html for routes without extensions
      const indexFile = Bun.file(join(STATIC_DIR, 'index.html'))
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html' },
      })
    })
  }

  app.listen(PORT, () => {
    console.log(`🏭 Factory API running at http://localhost:${PORT}`)
    console.log(`📚 API docs at http://localhost:${PORT}/swagger`)
    if (hasStaticFiles) {
      console.log(`📁 Serving static files from ${STATIC_DIR}`)
    }
  })
}

export type App = typeof app
