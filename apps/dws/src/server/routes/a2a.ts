/**
 * A2A Routes - Agent-to-Agent protocol for DWS
 * Enables AI agents to discover and communicate with DWS services
 */

import { Hono } from 'hono'

const CAPABILITIES = [
  'storage',
  'compute',
  'cdn',
  'git',
  'pkg',
  'kms',
  'vpn',
  'scraping',
  'workerd',
  'workers',
  'containers',
  'k8s',
  'helm',
  'terraform',
  'ingress',
  'mesh',
] as const

export function createA2ARouter(): Hono {
  const router = new Hono()

  // Get available capabilities
  router.get('/capabilities', (c) => {
    return c.json({
      capabilities: CAPABILITIES,
      version: '1.0.0',
      protocol: 'a2a',
    })
  })

  // Agent card endpoint (discovery)
  router.get('/agent-card', (c) => {
    return c.json({
      name: 'DWS',
      description:
        'Decentralized Web Services - compute, storage, CDN, git, packages, infrastructure',
      version: '1.0.0',
      capabilities: CAPABILITIES,
      endpoints: {
        storage: '/storage',
        compute: '/compute',
        cdn: '/cdn',
        git: '/git',
        pkg: '/pkg',
        kms: '/kms',
        vpn: '/vpn',
        scraping: '/scraping',
        workerd: '/workerd',
        workers: '/workers',
        containers: '/containers',
        k8s: '/k3s',
        helm: '/helm',
        terraform: '/terraform',
        ingress: '/ingress',
        mesh: '/mesh',
      },
    })
  })

  // Health check for A2A protocol
  router.get('/health', (c) => {
    return c.json({ status: 'healthy', protocol: 'a2a' })
  })

  return router
}
