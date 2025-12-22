/**
 * Inference Action - AI model inference
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { JEJU_SERVICE_NAME, type JejuService } from '../service'
import {
  expect,
  getMessageText,
  MAX_MESSAGE_LENGTH,
  sanitizeText,
  truncateOutput,
  validateServiceExists,
} from '../validation'

export const runInferenceAction: Action = {
  name: 'RUN_INFERENCE',
  description: 'Run AI inference on the network decentralized compute',
  similes: [
    'run inference',
    'ai inference',
    'call model',
    'use llm',
    'generate text',
  ],

  validate: async (runtime: IAgentRuntime): Promise<boolean> =>
    validateServiceExists(runtime),

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    // List available models
    const models = await client.compute.listModels()

    if (models.length === 0) {
      callback?.({ text: 'No inference models available on the network.' })
      return
    }

    // Use the prompt from the message (sanitized with length limit)
    const rawPrompt = getMessageText(message)
    const prompt = sanitizeText(rawPrompt.slice(0, MAX_MESSAGE_LENGTH))

    // Find a suitable model (prefer llama or gpt)
    const preferredModel = models.find((m: { model: string }) =>
      /llama|gpt|mistral/i.test(m.model),
    )
    const model = expect(
      preferredModel ?? models[0],
      'available inference model',
    )

    callback?.({ text: `Running inference on ${model.model}...` })

    const result = await client.compute.inference({
      model: model.model,
      messages: [{ role: 'user', content: prompt }],
    })

    // Truncate and sanitize the inference result
    const responseContent = truncateOutput(result.content ?? '', 20000)

    callback?.({
      text: `Inference result:

${responseContent}

---
Model: ${result.model}
Tokens: ${result.usage.totalTokens}`,
      content: {
        model: result.model,
        response: responseContent,
        usage: result.usage,
      },
    })
  },

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Run inference: What is the meaning of life?' },
      },
      {
        name: 'agent',
        content: { text: 'Running inference on llama-3-70b... [response]' },
      },
    ],
  ],
}
