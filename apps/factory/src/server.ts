/**
 * Factory API Server - Elysia
 *
 * Developer coordination hub powered by Bun + Elysia.
 * Fully decentralized, ready for CDN deployment.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { staticPlugin } from '@elysiajs/static'
import { type Context, Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { mcpRoutes } from './routes/mcp'
import { modelsRoutes } from './routes/models'
import { packagesRoutes } from './routes/packages'
import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'

const PORT = parseInt(process.env.PORT || '4009', 10)
const isDev = process.env.NODE_ENV !== 'production'

// Determine static files path based on execution context
// Only use built dist/client, never serve source files
function getStaticPath(): string | null {
  const distClient = 'dist/client'
  if (existsSync(distClient) && existsSync(join(distClient, 'index.html'))) {
    return distClient
  }
  return null
}

const staticPath = getStaticPath()
const hasStaticFiles = staticPath !== null

// Create the base Elysia app with all API routes
function createApp() {
  const baseApp = new Elysia()
    .use(
      cors({
        origin: isDev
          ? '*'
          : ['https://factory.jejunetwork.org', 'https://jeju.local:4009'],
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
    // API Routes
    .use(healthRoutes)
    .use(bountiesRoutes)
    .use(gitRoutes)
    .use(packagesRoutes)
    .use(containersRoutes)
    .use(modelsRoutes)
    .use(datasetsRoutes)
    .use(jobsRoutes)
    .use(projectsRoutes)
    .use(ciRoutes)
    .use(agentsRoutes)
    .use(feedRoutes)
    .use(issuesRoutes)
    .use(pullsRoutes)
    .use(a2aRoutes)
    .use(mcpRoutes)

  return baseApp
}

// Export the app for use in worker
export const app = createApp()

// Start server when running directly
if (import.meta.main) {
  // Add static file serving if available
  if (hasStaticFiles && staticPath) {
    app.use(
      staticPlugin({
        assets: staticPath,
        prefix: '/',
        indexHTML: true,
      }),
    )
    // SPA fallback - serve index.html for frontend routes only
    // Exclude API routes, swagger, and protocol endpoints
    app.get('*', (ctx: Context) => {
      const path = ctx.path
      // Don't serve SPA for API, swagger, or protocol routes
      if (
        path.startsWith('/api') ||
        path.startsWith('/swagger') ||
        path.startsWith('/a2a') ||
        path.startsWith('/mcp')
      ) {
        ctx.set.status = 404
        return { error: 'Not found' }
      }
      ctx.set.headers['content-type'] = 'text/html'
      return Bun.file(join(staticPath, 'index.html'))
    })
  }

  app.listen(PORT, () => {
    console.log(`🏭 Factory API running at http://localhost:${PORT}`)
    console.log(`📚 API docs at http://localhost:${PORT}/swagger`)
    if (!hasStaticFiles) {
      console.log(
        `📦 Run "bun run dev:client" in another terminal for the frontend`,
      )
    }
  })
}

export type App = typeof app
