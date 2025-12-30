import { randomUUID } from 'node:crypto'
import { Elysia, t } from 'elysia'

type DeploymentState = 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'
type DeploymentTarget = 'production' | 'preview'

interface Deployment {
  id: string
  projectId: string
  state: DeploymentState
  target: DeploymentTarget
  url: string
  subdomain: string
  createdAt: Date
  updatedAt: Date
  readyAt?: Date
  buildDuration?: number
  meta: {
    gitBranch?: string
    gitCommit?: string
    gitMessage?: string
    gitRepo?: string
    gitAuthor?: string
  }
  buildLogs: string[]
  regions: string[]
}

interface Project {
  id: string
  name: string
  orgId: string
  framework: 'nextjs' | 'remix' | 'astro' | 'static'
  buildCommand: string
  outputDirectory: string
  installCommand: string
  rootDirectory: string
  environmentVariables: Array<{
    key: string
    value: string
    target: DeploymentTarget[]
    encrypted: boolean
  }>
  domains: Array<{
    domain: string
    verified: boolean
    verification?: {
      type: 'TXT' | 'CNAME'
      name: string
      value: string
    }
  }>
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// In-Memory Storage (replace with SQLit in production)
// ============================================================================

const deployments = new Map<string, Deployment>()
const projects = new Map<string, Project>()
const deploymentsByProject = new Map<string, string[]>()

// ============================================================================
// Helper Functions
// ============================================================================

function generateDeploymentUrl(
  subdomain: string,
  _target: DeploymentTarget,
): string {
  const network = process.env.DWS_NETWORK ?? 'localnet'

  if (network === 'mainnet') {
    return `https://${subdomain}.dws.jejunetwork.org`
  } else if (network === 'testnet') {
    return `https://${subdomain}.dws.testnet.jejunetwork.org`
  }
  return `http://${subdomain}.dws.local`
}

function addBuildLog(deployment: Deployment, message: string) {
  const timestamp = new Date().toISOString()
  deployment.buildLogs.push(`[${timestamp}] ${message}`)
  deployment.updatedAt = new Date()
}

async function processDeployment(deployment: Deployment): Promise<void> {
  try {
    deployment.state = 'BUILDING'
    addBuildLog(deployment, 'Starting build...')

    // Simulate build process
    addBuildLog(deployment, 'Installing dependencies...')
    await new Promise((r) => setTimeout(r, 1000))

    addBuildLog(deployment, 'Building application...')
    await new Promise((r) => setTimeout(r, 2000))

    addBuildLog(deployment, 'Optimizing for edge runtime...')
    await new Promise((r) => setTimeout(r, 500))

    addBuildLog(deployment, 'Uploading to CDN...')
    await new Promise((r) => setTimeout(r, 500))

    deployment.state = 'READY'
    deployment.readyAt = new Date()
    deployment.buildDuration = Date.now() - deployment.createdAt.getTime()
    addBuildLog(
      deployment,
      `Build completed in ${Math.round(deployment.buildDuration / 1000)}s`,
    )
    addBuildLog(deployment, `Deployed to ${deployment.url}`)
  } catch (error) {
    deployment.state = 'ERROR'
    addBuildLog(deployment, `Build failed: ${error}`)
  }
}

// ============================================================================
// Router
// ============================================================================

export function createGitHubIntegrationRouter() {
  return (
    new Elysia({ prefix: '/deploy' })
      // Create deployment from GitHub
      .post(
        '/github',
        async ({ body }) => {
          const {
            projectId,
            target,
            subdomain,
            gitBranch,
            gitCommit,
            gitMessage,
            gitRepo,
            gitAuthor,
          } = body as {
            projectId: string
            target: DeploymentTarget
            subdomain: string
            gitBranch?: string
            gitCommit?: string
            gitMessage?: string
            gitRepo?: string
            gitAuthor?: string
          }

          const deployment: Deployment = {
            id: `dpl_${randomUUID().slice(0, 12)}`,
            projectId,
            state: 'QUEUED',
            target,
            subdomain,
            url: generateDeploymentUrl(subdomain, target),
            createdAt: new Date(),
            updatedAt: new Date(),
            meta: {
              gitBranch,
              gitCommit,
              gitMessage,
              gitRepo,
              gitAuthor,
            },
            buildLogs: [],
            regions: ['na-east'],
          }

          deployments.set(deployment.id, deployment)

          // Track by project
          const projectDeployments = deploymentsByProject.get(projectId) ?? []
          projectDeployments.unshift(deployment.id)
          deploymentsByProject.set(projectId, projectDeployments.slice(0, 100))

          // Process deployment asynchronously
          processDeployment(deployment)

          return deployment
        },
        {
          body: t.Object({
            projectId: t.String(),
            target: t.Union([t.Literal('production'), t.Literal('preview')]),
            subdomain: t.String(),
            gitBranch: t.Optional(t.String()),
            gitCommit: t.Optional(t.String()),
            gitMessage: t.Optional(t.String()),
            gitRepo: t.Optional(t.String()),
            gitAuthor: t.Optional(t.String()),
          }),
        },
      )

      // Create deployment (CLI)
      .post('/create', async ({ body }) => {
        const {
          projectId,
          name,
          target,
          framework: _framework,
          regions,
          meta,
        } = body as {
          projectId: string
          name: string
          target: DeploymentTarget
          framework: string
          regions: string[]
          meta?: {
            gitBranch?: string
            gitCommit?: string
            gitMessage?: string
          }
        }

        const subdomain =
          target === 'preview'
            ? `${meta?.gitBranch ?? 'preview'}-${name}`
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
            : name

        const deployment: Deployment = {
          id: `dpl_${randomUUID().slice(0, 12)}`,
          projectId,
          state: 'QUEUED',
          target,
          subdomain,
          url: generateDeploymentUrl(subdomain, target),
          createdAt: new Date(),
          updatedAt: new Date(),
          meta: meta ?? {},
          buildLogs: [],
          regions,
        }

        deployments.set(deployment.id, deployment)

        const projectDeployments = deploymentsByProject.get(projectId) ?? []
        projectDeployments.unshift(deployment.id)
        deploymentsByProject.set(projectId, projectDeployments.slice(0, 100))

        return deployment
      })

      // Upload deployment artifacts
      .post('/:id/upload', async ({ params, body: _body }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          return { error: 'Deployment not found' }
        }

        addBuildLog(deployment, 'Received build artifacts')

        // Process the deployment
        processDeployment(deployment)

        return { success: true }
      })

      // Get deployment status
      .get('/:id', ({ params }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          return { error: 'Deployment not found' }
        }
        return deployment
      })

      // Stream deployment logs
      .get('/:id/logs', async function* ({ params, query }) {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          yield JSON.stringify({ error: 'Deployment not found' })
          return
        }

        let lastIndex = 0
        const follow = query.follow === 'true'

        while (true) {
          if (deployment.buildLogs.length > lastIndex) {
            for (let i = lastIndex; i < deployment.buildLogs.length; i++) {
              yield `${deployment.buildLogs[i]}\n`
            }
            lastIndex = deployment.buildLogs.length
          }

          if (
            !follow ||
            deployment.state === 'READY' ||
            deployment.state === 'ERROR'
          ) {
            break
          }

          await new Promise((r) => setTimeout(r, 500))
        }
      })

      // Promote deployment to production
      .post('/:id/promote', async ({ params }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          return { error: 'Deployment not found' }
        }

        if (deployment.state !== 'READY') {
          return { error: 'Can only promote ready deployments' }
        }

        // Create a new production deployment from this one
        const prodDeployment: Deployment = {
          ...deployment,
          id: `dpl_${randomUUID().slice(0, 12)}`,
          target: 'production',
          subdomain: deployment.subdomain.replace(/^pr-\d+-/, ''),
          url: generateDeploymentUrl(
            deployment.subdomain.replace(/^pr-\d+-/, ''),
            'production',
          ),
          createdAt: new Date(),
          updatedAt: new Date(),
          buildLogs: [`Promoted from ${deployment.id}`],
        }

        deployments.set(prodDeployment.id, prodDeployment)

        return prodDeployment
      })

      // Cancel deployment
      .post('/:id/cancel', async ({ params }) => {
        const deployment = deployments.get(params.id)
        if (!deployment) {
          return { error: 'Deployment not found' }
        }

        if (deployment.state === 'READY' || deployment.state === 'ERROR') {
          return { error: 'Cannot cancel completed deployment' }
        }

        deployment.state = 'CANCELED'
        addBuildLog(deployment, 'Deployment canceled')

        return { success: true }
      })

      // Delete preview deployment
      .delete('/preview/:subdomain', async ({ params }) => {
        const { subdomain } = params

        for (const [id, deployment] of deployments) {
          if (
            deployment.subdomain === subdomain &&
            deployment.target === 'preview'
          ) {
            deployments.delete(id)
            return { success: true, deleted: id }
          }
        }

        return { error: 'Preview deployment not found' }
      })

      // List deployments for project
      .get('/projects/:projectId/deployments', ({ params, query }) => {
        const limit = parseInt(query.limit ?? '10', 10)
        const target = query.target as DeploymentTarget | undefined

        const projectDeploymentIds =
          deploymentsByProject.get(params.projectId) ?? []

        let result = projectDeploymentIds
          .map((id) => deployments.get(id))
          .filter((d): d is Deployment => d !== undefined)

        if (target) {
          result = result.filter((d) => d.target === target)
        }

        return result.slice(0, limit)
      })

      // Project environment variables
      .get('/projects/:projectId/env', ({ params }) => {
        const project = projects.get(params.projectId)
        if (!project) {
          return []
        }
        return project.environmentVariables.map((env) => ({
          key: env.key,
          value: env.encrypted ? '********' : env.value,
          target: env.target,
        }))
      })

      .post('/projects/:projectId/env', async ({ params, body }) => {
        const { key, value, target } = body as {
          key: string
          value: string
          target: DeploymentTarget[]
        }

        let project = projects.get(params.projectId)
        if (!project) {
          // Create project if it doesn't exist
          project = {
            id: params.projectId,
            name: 'default',
            orgId: 'default',
            framework: 'nextjs',
            buildCommand: 'bun run build',
            outputDirectory: '.next',
            installCommand: 'bun install',
            rootDirectory: '.',
            environmentVariables: [],
            domains: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          projects.set(params.projectId, project)
        }

        // Remove existing key if present
        project.environmentVariables = project.environmentVariables.filter(
          (e) => e.key !== key,
        )

        // Add new env var
        project.environmentVariables.push({
          key,
          value,
          target,
          encrypted:
            key.includes('SECRET') ||
            key.includes('KEY') ||
            key.includes('TOKEN'),
        })

        project.updatedAt = new Date()

        return { success: true }
      })

      .delete('/projects/:projectId/env/:key', async ({ params }) => {
        const project = projects.get(params.projectId)
        if (!project) {
          return { error: 'Project not found' }
        }

        project.environmentVariables = project.environmentVariables.filter(
          (e) => e.key !== params.key,
        )
        project.updatedAt = new Date()

        return { success: true }
      })

      // Project domains
      .get('/projects/:projectId/domains', ({ params }) => {
        const project = projects.get(params.projectId)
        if (!project) {
          return []
        }
        return project.domains
      })

      .post('/projects/:projectId/domains', async ({ params, body }) => {
        const { domain } = body as { domain: string }

        let project = projects.get(params.projectId)
        if (!project) {
          project = {
            id: params.projectId,
            name: 'default',
            orgId: 'default',
            framework: 'nextjs',
            buildCommand: 'bun run build',
            outputDirectory: '.next',
            installCommand: 'bun install',
            rootDirectory: '.',
            environmentVariables: [],
            domains: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          projects.set(params.projectId, project)
        }

        const verification = {
          type: 'TXT' as const,
          name: `_dws.${domain}`,
          value: `dws-verification=${randomUUID()}`,
        }

        project.domains.push({
          domain,
          verified: false,
          verification,
        })

        project.updatedAt = new Date()

        return {
          success: true,
          verification: {
            records: [
              {
                type: 'TXT',
                name: verification.name,
                value: verification.value,
              },
              {
                type: 'CNAME',
                name: domain,
                value: `${project.id}.dws.jejunetwork.org`,
              },
            ],
          },
        }
      })

      .delete('/projects/:projectId/domains/:domain', async ({ params }) => {
        const project = projects.get(params.projectId)
        if (!project) {
          return { error: 'Project not found' }
        }

        project.domains = project.domains.filter(
          (d) => d.domain !== params.domain,
        )
        project.updatedAt = new Date()

        return { success: true }
      })

      // GitHub webhook handler
      .post('/webhook/github', async ({ body, headers }) => {
        const event = headers['x-github-event']
        const signature = headers['x-hub-signature-256']

        // Verify webhook signature with secret (if configured)
        const secret = process.env.GITHUB_WEBHOOK_SECRET
        if (secret && signature) {
          const crypto = await import('node:crypto')
          const expectedSignature = `sha256=${crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(body))
            .digest('hex')}`
          if (signature !== expectedSignature) {
            console.warn('[GitHub Webhook] Invalid signature')
            return { error: 'Invalid signature' }
          }
        }

        const payload = body as Record<string, unknown>

        switch (event) {
          case 'push': {
            const ref = payload.ref as string
            const branch = ref.replace('refs/heads/', '')

            // Only deploy main/master branches to production
            if (branch === 'main' || branch === 'master') {
              // Trigger production deployment
              console.log(
                '[GitHub Webhook] Push to main - triggering production deploy',
              )
            }
            break
          }

          case 'pull_request': {
            const action = payload.action as string
            const pr = payload.pull_request as Record<string, unknown>
            const prNumber = pr?.number ?? 'unknown'
            const prBranch =
              (pr?.head as Record<string, unknown>)?.ref ?? 'unknown'

            if (action === 'opened' || action === 'synchronize') {
              // Trigger preview deployment
              console.log(
                `[GitHub Webhook] PR #${prNumber} (${prBranch}) updated - triggering preview deploy`,
              )
            } else if (action === 'closed') {
              // Cleanup preview deployment
              console.log(
                `[GitHub Webhook] PR #${prNumber} closed - cleaning up preview`,
              )
            }
            break
          }

          case 'deployment':
          case 'deployment_status':
            // GitHub deployments API integration
            break
        }

        return { received: true }
      })

      // List all deployments (for dashboard)
      .get('/list', ({ query }) => {
        const app = query.app as string | undefined
        const limit = parseInt(query.limit ?? '20', 10)

        let result = Array.from(deployments.values()).sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )

        if (app) {
          result = result.filter((d) => d.subdomain.includes(app))
        }

        return result.slice(0, limit)
      })
  )
}

export const githubIntegration = {
  createRouter: createGitHubIntegrationRouter,
  deployments,
  projects,
}
