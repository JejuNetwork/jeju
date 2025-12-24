/** Factory API Server */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { staticPlugin } from '@elysiajs/static'
import { CORE_PORTS } from '@jejunetwork/config'
import { type Context, Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { discussionsRoutes } from './routes/discussions'
import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { leaderboardRoutes } from './routes/leaderboard'
import { mcpRoutes } from './routes/mcp'
import { modelsRoutes } from './routes/models'
import { packageSettingsRoutes } from './routes/package-settings'
import { packagesRoutes } from './routes/packages'
import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'
import { repoSettingsRoutes } from './routes/repo-settings'

const PORT = Number(process.env.PORT) || CORE_PORTS.FACTORY.get()
const isDev = process.env.NODE_ENV !== 'production'

function getStaticPath(): string | null {
  const distClient = 'dist/client'
  if (existsSync(distClient) && existsSync(join(distClient, 'index.html'))) {
    return distClient
  }
  return null
}

const staticPath = getStaticPath()
const hasStaticFiles = staticPath !== null

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
    .use(feedRoutes)
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
  if (hasStaticFiles && staticPath) {
    app.use(
      staticPlugin({
        assets: staticPath,
        prefix: '/',
        indexHTML: true,
      }),
    )
    app.get('*', (ctx: Context) => {
      const path = ctx.path
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
