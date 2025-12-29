/**
 * Futarchy Routes - Prediction market governance
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { toAddress } from '../../lib'
import { type FutarchyConfig, getFutarchyClient } from '../futarchy'
import { autocratConfig, config } from '../shared-state'

const ZERO_ADDR = ZERO_ADDRESS

const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  councilAddress: config.contracts.council ? toAddress(config.contracts.council) : ZERO_ADDR,
  predictionMarketAddress: ZERO_ADDR,
  operatorKey: autocratConfig.operatorKey ?? autocratConfig.privateKey,
}
const futarchy = getFutarchyClient(futarchyConfig)

export const futarchyRoutes = new Elysia({ prefix: '/api/v1/futarchy' })
  .get(
    '/vetoed',
    async () => {
      const proposals = await futarchy.getVetoedProposals()
      return { proposals }
    },
    {
      detail: { tags: ['futarchy'], summary: 'Get vetoed proposals' },
    },
  )
  .get(
    '/pending',
    async () => {
      const proposals = await futarchy.getPendingFutarchyProposals()
      return { proposals }
    },
    {
      detail: { tags: ['futarchy'], summary: 'Get pending futarchy proposals' },
    },
  )
  .get(
    '/market/:proposalId',
    async ({ params }) => {
      const market = await futarchy.getFutarchyMarket(params.proposalId)
      if (!market) throw new Error('No futarchy market for this proposal')
      return market
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: {
        tags: ['futarchy'],
        summary: 'Get futarchy market for proposal',
      },
    },
  )
  .post(
    '/escalate',
    async ({ body }) => {
      const result = await futarchy.escalateToFutarchy(body.proposalId)
      return result
    },
    {
      body: t.Object({ proposalId: t.String() }),
      detail: { tags: ['futarchy'], summary: 'Escalate proposal to futarchy' },
    },
  )
  .post(
    '/resolve',
    async ({ body }) => {
      const result = await futarchy.resolveFutarchy(body.proposalId)
      return result
    },
    {
      body: t.Object({ proposalId: t.String() }),
      detail: { tags: ['futarchy'], summary: 'Resolve futarchy market' },
    },
  )
  .post(
    '/execute',
    async ({ body }) => {
      const result = await futarchy.executeFutarchyApproved(body.proposalId)
      return result
    },
    {
      body: t.Object({ proposalId: t.String() }),
      detail: {
        tags: ['futarchy'],
        summary: 'Execute futarchy-approved proposal',
      },
    },
  )
  .get(
    '/sentiment/:proposalId',
    async ({ params }) => {
      const sentiment = await futarchy.getMarketSentiment(params.proposalId)
      if (!sentiment) throw new Error('No market for this proposal')
      return sentiment
    },
    {
      params: t.Object({ proposalId: t.String() }),
      detail: { tags: ['futarchy'], summary: 'Get market sentiment' },
    },
  )
  .get(
    '/parameters',
    async () => {
      const params = await futarchy.getFutarchyParameters()
      if (!params) return { error: 'Futarchy not deployed' }
      return params
    },
    {
      detail: { tags: ['futarchy'], summary: 'Get futarchy parameters' },
    },
  )
