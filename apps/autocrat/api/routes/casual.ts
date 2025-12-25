/**
 * Casual Proposal Routes - Simple proposal flow
 */

import { Elysia, t } from 'elysia'
import { expectValid } from '@jejunetwork/types'
import { CasualProposalCategorySchema } from '../../lib'
import {
  type CasualSubmission,
  getProposalAssistant,
} from '../proposal-assistant'

const proposalAssistant = getProposalAssistant()

export const casualRoutes = new Elysia({ prefix: '/api/v1' })
  .post(
    '/dao/:daoId/casual/assess',
    async ({ params, body }) => {
      const submission: CasualSubmission = {
        daoId: params.daoId,
        category: expectValid(
          CasualProposalCategorySchema,
          body.category,
          'category',
        ),
        title: body.title,
        content: body.content,
      }
      const assessment =
        await proposalAssistant.assessCasualSubmission(submission)
      return assessment
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        category: t.String(),
        title: t.String(),
        content: t.String(),
      }),
      detail: { tags: ['casual'], summary: 'Assess casual submission' },
    },
  )
  .post(
    '/dao/:daoId/casual/help',
    async ({ params, body }) => {
      const category = expectValid(
        CasualProposalCategorySchema,
        body.category,
        'category',
      )
      const help = await proposalAssistant.helpCraftSubmission(
        category,
        body.content ?? '',
        params.daoId,
      )
      return help
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        category: t.String(),
        content: t.Optional(t.String()),
      }),
      detail: { tags: ['casual'], summary: 'Get help crafting submission' },
    },
  )
  .get(
    '/casual/categories',
    () => {
      const categories = proposalAssistant.getAllCategories()
      return { categories }
    },
    {
      detail: { tags: ['casual'], summary: 'Get all casual categories' },
    },
  )
