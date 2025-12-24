/**
 * DAO Registry Routes - Multi-tenant DAO management
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { createDAOService, type DAOService } from '../dao-service'
import { config } from '../shared-state'

const ZERO_ADDR = ZERO_ADDRESS

let daoService: DAOService | null = null

function initDAOService(): DAOService | null {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDR) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: parseInt(process.env.CHAIN_ID ?? '31337', 10),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
    })
  }
  return daoService
}

export const daoRoutes = new Elysia({ prefix: '/api/v1/dao' })
  .get(
    '/list',
    async () => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const daoIds = await service.getAllDAOs()
      const daos = await Promise.all(daoIds.map((id) => service.getDAO(id)))
      return { daos }
    },
    {
      detail: { tags: ['dao'], summary: 'List all DAOs' },
    },
  )
  .get(
    '/active',
    async () => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const daoIds = await service.getActiveDAOs()
      const daos = await Promise.all(daoIds.map((id) => service.getDAOFull(id)))
      return { daos }
    },
    {
      detail: { tags: ['dao'], summary: 'List active DAOs' },
    },
  )
  .get(
    '/:daoId',
    async ({ params }) => {
      const service = initDAOService()
      if (!service) throw new Error('DAO Registry not deployed')
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')
      const dao = await service.getDAOFull(params.daoId)
      return dao
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get DAO details' },
    },
  )
  .get(
    '/:daoId/persona',
    async ({ params }) => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const persona = await service.getCEOPersona(params.daoId)
      return persona
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get CEO persona' },
    },
  )
  .get(
    '/:daoId/council',
    async ({ params }) => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const members = await service.getCouncilMembers(params.daoId)
      return { members }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get council members' },
    },
  )
  .get(
    '/:daoId/packages',
    async ({ params }) => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const packages = await service.getLinkedPackages(params.daoId)
      return { packages }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get linked packages' },
    },
  )
  .get(
    '/:daoId/repos',
    async ({ params }) => {
      const service = initDAOService()
      if (!service) return { error: 'DAO Registry not deployed' }
      const repos = await service.getLinkedRepos(params.daoId)
      return { repos }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get linked repositories' },
    },
  )
