import { Elysia } from 'elysia'

export const a2aRoutes = new Elysia({ name: 'a2a', prefix: '/a2a' })
  .get('/capabilities', () => ({
    capabilities: ['storage', 'compute', 'cdn'],
  }))

export type A2ARoutes = typeof a2aRoutes
