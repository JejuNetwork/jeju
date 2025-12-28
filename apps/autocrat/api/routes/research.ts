import { Elysia, t } from 'elysia'
import { getResearchAgent, type ResearchRequest } from '../research-agent'

const researchAgent = getResearchAgent()

export const researchRoutes = new Elysia({ prefix: '/api/v1/research' })
  .post(
    '/conduct',
    async ({ body }) => {
      const request: ResearchRequest = {
        proposalId: body.proposalId,
        title: body.title,
        description: body.description,
        proposalType: body.proposalType,
        references: body.references,
        depth: body.depth,
        daoId: body.daoId,
        daoName: body.daoName,
      }
      const report = await researchAgent.conductResearch(request)
      return report
    },
    {
      body: t.Object({
        proposalId: t.String(),
        title: t.String(),
        description: t.String(),
        proposalType: t.Optional(t.String()),
        references: t.Optional(t.Array(t.String())),
        depth: t.Optional(
          t.Union([
            t.Literal('quick'),
            t.Literal('standard'),
            t.Literal('deep'),
          ]),
        ),
        daoId: t.Optional(t.String()),
        daoName: t.Optional(t.String()),
      }),
      detail: { tags: ['research'], summary: 'Conduct research on a proposal' },
    },
  )
  .post(
    '/quick-screen',
    async ({ body }) => {
      const request: ResearchRequest = {
        proposalId: body.proposalId,
        title: body.title,
        description: body.description,
        depth: 'quick',
      }
      const result = await researchAgent.quickScreen(request)
      return result
    },
    {
      body: t.Object({
        proposalId: t.String(),
        title: t.String(),
        description: t.String(),
      }),
      detail: { tags: ['research'], summary: 'Quick screen a proposal' },
    },
  )
  .post(
    '/fact-check',
    async ({ body }) => {
      const result = await researchAgent.factCheck(
        body.claim,
        body.context ?? '',
      )
      return result
    },
    {
      body: t.Object({
        claim: t.String(),
        context: t.Optional(t.String()),
      }),
      detail: { tags: ['research'], summary: 'Fact check a claim' },
    },
  )
