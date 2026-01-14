/**
 * Inference Action - AI model inference
 */

import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
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
    _options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    const service = runtime.getService(JEJU_SERVICE_NAME) as JejuService
    const client = service.getClient()

    // Use the prompt from the message (sanitized with length limit)
    const rawPrompt = getMessageText(message)
    const prompt = sanitizeText(rawPrompt.slice(0, MAX_MESSAGE_LENGTH))

    // List available models
    const models = await client.compute.listModels()

    if (models.length === 0) {
      if (client.network === 'localnet') {
        const dwsUrl = getDWSUrl() ?? `http://${getLocalhostHost()}:4030`
        const fallbackModel = 'llama-3.1-8b-instant'

        callback?.({
          text: `No on-chain models found. Running inference via DWS (${fallbackModel})...`,
        })

        try {
          const response = await fetch(`${dwsUrl}/compute/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: fallbackModel,
              messages: [{ role: 'user', content: prompt }],
            }),
          })

          if (!response.ok) {
            const errorText = await response.text()
            callback?.({
              text: `DWS inference failed: ${errorText || response.statusText}`,
            })
            return
          }

          const data = (await response.json()) as {
            model?: string
            choices?: Array<{ message?: { content?: string } }>
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
              total_tokens?: number
            }
          }

          const responseText =
            data.choices?.[0]?.message?.content ?? ''
          const responseContent = truncateOutput(responseText, 20000)
          const usage = data.usage ?? {}
          const totalTokens = usage.total_tokens ?? 0

          callback?.({
            text: `Inference result:\n\n${responseContent}\n\n---\nModel: ${data.model ?? fallbackModel}\nTokens: ${totalTokens}`,
            content: {
              model: data.model ?? fallbackModel,
              response: responseContent,
              usage: {
                promptTokens: usage.prompt_tokens ?? 0,
                completionTokens: usage.completion_tokens ?? 0,
                totalTokens,
              },
            },
          })
        } catch (err) {
          callback?.({
            text: `DWS inference failed: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
        return
      }

      callback?.({ text: 'No inference models available on the network.' })
      return
    }

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
