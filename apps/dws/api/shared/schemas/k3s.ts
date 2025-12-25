/**
 * K3s/Kubernetes infrastructure schemas
 */

import { z } from 'zod'
import { hexSchema, nonEmptyStringSchema } from '../validation'

/**
 * Install DWS agent on cluster request
 */
export const installDWSAgentRequestSchema = z.object({
  nodeEndpoint: nonEmptyStringSchema,
  privateKey: hexSchema.optional(),
  capabilities: z.array(z.string()).optional(),
})

// Type export
export type InstallDWSAgentRequest = z.infer<
  typeof installDWSAgentRequestSchema
>
