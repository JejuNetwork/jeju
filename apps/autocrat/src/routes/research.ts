/**
 * Research Agent Routes
 */

import { Elysia, t } from 'elysia'
import { getResearchAgent } from '../research-agent'

const researchAgent = getResearchAgent()

export const researchRoutes = new Elysia({ prefix: '/api/v1/research' })
  .post(
    '/conduct',
    async ({ body }) => {
      const report = await researchAgent.conductResearch(body)
      return report
    },
    {
      body: t.Object({
        topic: t.String(),
        context: t.Optional(t.String()),
        depth: t.Optional(
          t.Union([
            t.Literal('shallow'),
            t.Literal('deep'),
            t.Literal('comprehensive'),
          ]),
        ),
        sources: t.Optional(t.Array(t.String())),
      }),
      detail: { tags: ['research'], summary: 'Conduct research on a topic' },
    },
  )
  .post(
    '/quick-screen',
    async ({ body }) => {
      const result = await researchAgent.quickScreen(body)
      return result
    },
    {
      body: t.Object({
        topic: t.String(),
        context: t.Optional(t.String()),
      }),
      detail: { tags: ['research'], summary: 'Quick screen a topic' },
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
