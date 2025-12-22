/**
 * Deep Funding Routes
 */

import { Elysia, t } from 'elysia'
import { createDAOService, type DAOService } from '../dao-service'
import { type FundingOracle, getFundingOracle } from '../funding-oracle'
import { config } from '../shared-state'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

let daoService: DAOService | null = null
let fundingOracle: FundingOracle | null = null

function initServices() {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDR) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: parseInt(process.env.CHAIN_ID ?? '31337', 10),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
    })
    fundingOracle = getFundingOracle()
  }
  return { daoService, fundingOracle }
}

export const fundingRoutes = new Elysia({
  prefix: '/api/v1/dao/:daoId/funding',
})
  .get(
    '/epoch',
    async ({ params }) => {
      const { daoService } = initServices()
      if (!daoService) return { error: 'DAO Registry not deployed' }
      const epoch = await daoService.getCurrentEpoch(params.daoId)
      return { epoch }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get current funding epoch' },
    },
  )
  .get(
    '/projects',
    async ({ params }) => {
      const { daoService } = initServices()
      if (!daoService) return { error: 'DAO Registry not deployed' }
      const projects = await daoService.getActiveProjects(params.daoId)
      return { projects }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get active funding projects' },
    },
  )
  .get(
    '/allocations',
    async ({ params }) => {
      const { daoService } = initServices()
      if (!daoService) return { error: 'DAO Registry not deployed' }
      const allocations = await daoService.getFundingAllocations(params.daoId)
      return { allocations }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get funding allocations' },
    },
  )
  .get(
    '/summary',
    async ({ params }) => {
      const { fundingOracle } = initServices()
      if (!fundingOracle) return { error: 'DAO Registry not deployed' }
      const summary = await fundingOracle.getEpochSummary(params.daoId)
      return summary
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get epoch summary' },
    },
  )
  .get(
    '/recommendations',
    async ({ params }) => {
      const { fundingOracle } = initServices()
      if (!fundingOracle) return { error: 'DAO Registry not deployed' }
      const recommendations = await fundingOracle.generateCEORecommendations(
        params.daoId,
      )
      return recommendations
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get CEO funding recommendations' },
    },
  )
  .get(
    '/knobs',
    async ({ params }) => {
      const { fundingOracle } = initServices()
      if (!fundingOracle) return { error: 'DAO Registry not deployed' }
      const knobs = await fundingOracle.getKnobs(params.daoId)
      return knobs
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get funding knobs' },
    },
  )
