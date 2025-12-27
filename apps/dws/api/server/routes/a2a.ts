/**
 * A2A Routes - Agent-to-Agent protocol for DWS
 * Enables AI agents to discover and communicate with DWS services
 */

import { Elysia } from 'elysia'

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
  'cache',
] as const

export function createA2ARouter() {
  return (
    new Elysia({ prefix: '/a2a' })
      // Get available capabilities
      .get('/capabilities', () => ({
        capabilities: CAPABILITIES,
        version: '1.0.0',
        protocol: 'a2a',
      }))

      // Agent card endpoint (discovery)
      .get('/agent-card', () => ({
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
          cache: '/cache',
        },
      }))

      // Health check for A2A protocol
      .get('/health', () => ({ status: 'healthy', protocol: 'a2a' }))
  )
}
