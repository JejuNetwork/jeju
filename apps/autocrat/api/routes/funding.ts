import { getChainId } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { type DAOService, getOrCreateDAOService } from '../dao-service'
import { type FundingOracle, getFundingOracle } from '../funding-oracle'
import { autocratConfig, config } from '../shared-state'

const ZERO_ADDR = ZERO_ADDRESS

let fundingOracle: FundingOracle | null = null

async function initServices(): Promise<{
  daoService: DAOService | null
  fundingOracle: FundingOracle | null
}> {
  if (config.contracts.daoRegistry === ZERO_ADDR) {
    return { daoService: null, fundingOracle: null }
  }

  const daoService = await getOrCreateDAOService(
    {
      rpcUrl: config.rpcUrl,
      chainId: getChainId(),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
    },
    autocratConfig.operatorKey ?? autocratConfig.privateKey,
  )

  if (!fundingOracle) {
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
      const { daoService } = await initServices()
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
      const { daoService } = await initServices()
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
      const { daoService } = await initServices()
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
      const { fundingOracle } = await initServices()
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
      const { fundingOracle } = await initServices()
      if (!fundingOracle) return { error: 'DAO Registry not deployed' }
      const recommendations =
        await fundingOracle.generateDirectorRecommendations(params.daoId)
      return recommendations
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: {
        tags: ['funding'],
        summary: 'Get Director funding recommendations',
      },
    },
  )
  .get(
    '/knobs',
    async ({ params }) => {
      const { fundingOracle } = await initServices()
      if (!fundingOracle) return { error: 'DAO Registry not deployed' }
      const knobs = await fundingOracle.getKnobs(params.daoId)
      return knobs
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['funding'], summary: 'Get funding knobs' },
    },
  )
