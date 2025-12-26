/**
 * Fundamental prediction environment for financial metric training.
 */

import {
  getFundamentalDatasetUrl,
  getHuggingFaceToken,
} from '@jejunetwork/config'
import { HfInference } from '@huggingface/inference'
import { type ChatMessage, expectValid } from '@jejunetwork/types'
import { z } from 'zod'
import { CompletionResponseSchema } from '../schemas'

export interface EnvConfig {
  tokenizerName: string
  groupSize: number
  maxNumWorkers: number
  rolloutServerUrl: string
  totalSteps: number
  batchSize: number
  stepsPerEval: number
  maxTokenLength: number
  inferenceWeight: number
  dataPathToSaveGroups: string | null
  evalLimitRatio: number
}

export interface APIServerConfig {
  modelName: string
  baseUrl: string
  apiKey: string
  numRequestsForEval: number
}

export interface TrainingItem {
  context: string
  answer: 'maintained' | 'raised' | 'reduced'
  magnitude: string
  fundamentalMetric: string
}

export interface ScoredDataGroup {
  tokens: number[][]
  masks: number[][]
  scores: number[]
  inference_logprobs?: number[][]
}

export interface Completion {
  text: string
  tokens: number[]
  logprobs: number[]
}

export interface CompletionResult {
  choices: Completion[]
}

// Prompts

const SYSTEM_PROMPT = `You are a deep thinking AI financial analyst.
You may use extremely long chains of thought to deeply consider the problem and deliberate with yourself via systematic reasoning processes to help come to a correct solution prior to answering.

You should enclose your thoughts and internal monologue inside <think> </think> tags, and then provide your final prediction.`

function createUserMessage(context: string, fundamentalMetric: string): string {
  return `Your task is to analyze the following company fundamentals, news, and macroeconomic data to predict whether the company's ${fundamentalMetric} will be maintained, raised, or reduced in the next quarter, as well as the magnitude of any change.

Your final answer MUST use the exact format:
"The ${fundamentalMetric} will be: {answer} and the magnitude will be: {percentage}%"

Where {answer} is one of: "maintained", "raised", or "reduced"
And {percentage} is the expected percentage change (0% if maintained).

Here is the data to analyze:

${context}`
}

// Dataset Schemas

/** Schema for validating dataset items */
const DatasetItemSchema = z.object({
  context: z.string().min(1),
  answer: z.enum(['maintained', 'raised', 'reduced']),
  magnitude: z.string(),
  fundamental_metric: z.string().min(1),
})

/** Schema for validating the complete dataset response */
const DatasetResponseSchema = z.object({
  train: z.array(DatasetItemSchema),
  test: z.array(DatasetItemSchema),
})

type DatasetItem = z.infer<typeof DatasetItemSchema>

/**
 * Load training dataset for fundamental prediction
 *
 * In production, load from HuggingFace:
 *   - nous-research/fundamental-prediction-v1
 *   - financialdatasets/earnings-calls
 *
 * For development/testing, uses synthetic examples.
 */
async function loadDataset(): Promise<{
  train: DatasetItem[]
  test: DatasetItem[]
}> {
  const datasetUrl = getFundamentalDatasetUrl()

  if (datasetUrl) {
    const response = await fetch(datasetUrl)
    if (response.ok) {
      const data = expectValid(
        DatasetResponseSchema,
        await response.json(),
        'fundamental prediction dataset',
      )
      console.log(
        `[FundamentalPrediction] Loaded ${data.train.length} train, ${data.test.length} test from ${datasetUrl}`,
      )
      return data
    }
    console.warn(
      `[FundamentalPrediction] Failed to load from ${datasetUrl}: ${response.status}`,
    )
  }

  // Development mode: Generate synthetic training data
  console.warn(
    '[FundamentalPrediction] Using synthetic data - set FUNDAMENTAL_DATASET_URL for production',
  )

  const syntheticData = generateSyntheticDataset(100)
  const shuffled = [...syntheticData].sort(() => Math.random() - 0.5)
  const splitIdx = Math.floor(shuffled.length * 0.9)

  return {
    train: shuffled.slice(0, splitIdx),
    test: shuffled.slice(splitIdx),
  }
}

/**
 * Generate synthetic financial data for development/testing
 */
function generateSyntheticDataset(count: number): DatasetItem[] {
  const companies = [
    'TechCorp Inc',
    'RetailMax Corp',
    'FinanceFirst Ltd',
    'HealthPlus Systems',
    'EnergyGlobal Co',
    'MediaStream Inc',
    'AutoDrive Motors',
    'CloudScale Tech',
    'BioGenetics Lab',
    'GreenEnergy Solutions',
  ]

  const metrics = [
    'earnings guidance',
    'revenue forecast',
    'dividend',
    'operating margin',
    'free cash flow',
  ]

  const outcomes: Array<'maintained' | 'raised' | 'reduced'> = [
    'maintained',
    'raised',
    'reduced',
  ]

  const macroConditions = [
    'Fed held rates steady, GDP growth at 2.8%',
    'Interest rates rising, inflation at 3.2%',
    'Economic uncertainty, mixed signals',
    'Strong consumer spending, low unemployment',
    'Recession concerns, market volatility high',
  ]

  const items: DatasetItem[] = []

  for (let i = 0; i < count; i++) {
    const company = companies[i % companies.length] ?? 'Company Inc'
    const metric = metrics[i % metrics.length] ?? 'earnings'
    const outcome = outcomes[i % outcomes.length] ?? 'maintained'
    const macro =
      macroConditions[Math.floor(Math.random() * macroConditions.length)] ??
      macroConditions[0] ??
      ''

    // Generate plausible financials based on outcome
    const baseRevenue = 10 + Math.random() * 50
    const revenueGrowth =
      outcome === 'raised' ? 5 + Math.random() * 15 : -10 + Math.random() * 10
    const epsBeat = outcome === 'raised' ? 0.05 + Math.random() * 0.2 : -0.15

    const magnitude =
      outcome === 'maintained' ? '0' : (5 + Math.random() * 15).toFixed(1)

    items.push({
      context: `Company: ${company}
Q${(i % 4) + 1} 2024 Revenue: $${baseRevenue.toFixed(1)}B (${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(1)}% YoY)
Net Income: $${(baseRevenue * 0.15).toFixed(1)}B
EPS: $${(1 + Math.random()).toFixed(2)} (${epsBeat > 0 ? 'beat' : 'missed'} estimates by $${Math.abs(epsBeat).toFixed(2)})
Macro: ${macro}`,
      answer: outcome,
      magnitude,
      fundamental_metric: metric,
    })
  }

  return items
}

// Scoring

function extractPrediction(
  text: string,
  fundamentalMetric: string,
): { prediction: string | null; magnitude: string | null } {
  const thinkOpenTags = text.match(/<think>/gi) ?? []
  const thinkCloseTags = text.match(/<\/think>/gi) ?? []

  if (thinkOpenTags.length !== 1 || thinkCloseTags.length !== 1) {
    return { prediction: null, magnitude: null }
  }

  const parts = text.split(/<\/think>/i)
  if (parts.length !== 2) {
    return { prediction: null, magnitude: null }
  }

  const thinkingSection = parts[0]
  const answerSection = parts[1]

  if (!thinkingSection || !answerSection) {
    return { prediction: null, magnitude: null }
  }

  if (!thinkingSection.toLowerCase().includes('<think>')) {
    return { prediction: null, magnitude: null }
  }

  const escapedMetric = fundamentalMetric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `The ${escapedMetric} will be:\\s*(maintained|raised|reduced)\\s*and\\s*the\\s*magnitude\\s*will\\s*be:\\s*([-+]?\\d+(?:\\.\\d+)?)%`,
    'i',
  )

  const matches = answerSection.match(pattern)
  if (!matches) {
    return { prediction: null, magnitude: null }
  }

  const allMatches = answerSection.match(new RegExp(pattern.source, 'gi'))
  if (!allMatches || allMatches.length !== 1) {
    return { prediction: null, magnitude: null }
  }

  const predictionMatch = matches[1]
  const magnitudeMatch = matches[2]
  if (!predictionMatch || !magnitudeMatch) {
    return { prediction: null, magnitude: null }
  }

  return {
    prediction: predictionMatch.toLowerCase(),
    magnitude: magnitudeMatch,
  }
}

function calculateMagnitudeScore(
  predictedMagnitude: string,
  expectedMagnitude: string,
): number {
  const predMag = parseFloat(predictedMagnitude)
  const expMag = parseFloat(expectedMagnitude)

  if (Number.isNaN(predMag) || Number.isNaN(expMag)) {
    return 0
  }

  const diff = Math.abs(predMag - expMag)

  if (diff === 0) return 1.0
  if (diff <= 1) return 0.9
  if (diff <= 5) return 0.7
  if (diff <= 10) return 0.5
  if (diff <= 20) return 0.3
  return 0.0
}

// Fundamental Prediction Environment

export class FundamentalPredictionEnv {
  private config: EnvConfig
  private serverConfigs: APIServerConfig[]
  private train: DatasetItem[] = []
  private test: DatasetItem[] = []
  private iter = 0
  private percentCorrectBuffer: number[] = []
  private magnitudeAccuracyBuffer: number[] = []
  private hf: HfInference | null = null
  private _hfInitialized = false

  constructor(config: EnvConfig, serverConfigs: APIServerConfig[]) {
    this.config = config
    this.serverConfigs = serverConfigs
  }

  static configInit(): {
    envConfig: EnvConfig
    serverConfigs: APIServerConfig[]
  } {
    const envConfig: EnvConfig = {
      tokenizerName: 'microsoft/phi-2',
      groupSize: 8,
      maxNumWorkers: 32,
      rolloutServerUrl: 'http://localhost:8000',
      totalSteps: 100,
      batchSize: 16,
      stepsPerEval: 10,
      maxTokenLength: 2048,
      inferenceWeight: 1.0,
      dataPathToSaveGroups: null,
      evalLimitRatio: 0.1,
    }

    const serverConfigs: APIServerConfig[] = [
      {
        modelName: 'microsoft/phi-2',
        baseUrl: 'http://localhost:9001/v1',
        apiKey: 'x',
        numRequestsForEval: 64,
      },
    ]

    return { envConfig, serverConfigs }
  }

  async setup(): Promise<void> {
    const dataset = await loadDataset()
    this.train = dataset.train
    this.test = dataset.test

    console.log(
      `[FundamentalPrediction] Loaded dataset with ${this.train.length} training and ${this.test.length} test examples`,
    )

    const hfToken = getHuggingFaceToken()
    if (hfToken) {
      this.hf = new HfInference(hfToken)
      this._hfInitialized = true
    }
  }

  get hfClient(): HfInference | null {
    return this.hf
  }

  get isHfInitialized(): boolean {
    return this._hfInitialized
  }

  async getNextItem(): Promise<TrainingItem> {
    const item = this.train[this.iter % this.train.length]
    if (!item) {
      throw new Error('Training data is empty')
    }
    this.iter++

    return {
      context: item.context,
      answer: item.answer,
      magnitude: item.magnitude,
      fundamentalMetric: item.fundamental_metric,
    }
  }

  async generateCompletions(
    prompt: string,
    n: number,
    maxTokens: number,
    temperature: number,
  ): Promise<CompletionResult> {
    const serverConfig = this.serverConfigs[0]
    if (!serverConfig) {
      throw new Error('No server config available')
    }

    const completions: Completion[] = []

    for (let i = 0; i < n; i++) {
      const response = await fetch(`${serverConfig.baseUrl}/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serverConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: serverConfig.modelName,
          prompt,
          max_tokens: maxTokens,
          temperature,
          n: 1,
          logprobs: 1,
        }),
      })

      if (!response.ok) {
        throw new Error(`Completion request failed: ${response.status}`)
      }

      const result = expectValid(
        CompletionResponseSchema,
        await response.json(),
        'vLLM completion response',
      )

      const choice = result.choices[0]
      if (!choice) {
        throw new Error('No completion choice returned')
      }

      completions.push({
        text: choice.text,
        tokens: choice.logprobs?.tokens ?? [],
        logprobs: choice.logprobs?.token_logprobs ?? [],
      })
    }

    return { choices: completions }
  }

  async collectTrajectories(item: TrainingItem): Promise<{
    scoredData: ScoredDataGroup | null
    backlog: TrainingItem[]
  }> {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: createUserMessage(item.context, item.fundamentalMetric),
      },
    ]

    const prompt = `${messages
      .map((m) => {
        if (m.role === 'system') return `<|system|>\n${m.content}\n`
        if (m.role === 'user') return `<|user|>\n${m.content}\n`
        return `<|assistant|>\n${m.content}\n`
      })
      .join('')}<|assistant|>\n`

    const completions = await this.generateCompletions(
      prompt,
      this.config.groupSize,
      1024 * 15,
      0.8,
    )

    const toScore: Array<{
      text: string
      tokens: number[]
      logprobs: number[]
    }> = completions.choices.map((c) => ({
      text: c.text,
      tokens: c.tokens,
      logprobs: c.logprobs,
    }))

    return {
      scoredData: await this.score(toScore, item),
      backlog: [],
    }
  }

  async score(
    rolloutData: Array<{
      text: string
      tokens: number[]
      logprobs: number[]
    }>,
    item: TrainingItem,
  ): Promise<ScoredDataGroup | null> {
    const scores: ScoredDataGroup = {
      tokens: [],
      masks: [],
      scores: [],
      inference_logprobs: [],
    }

    const shuffled = [...rolloutData].sort(() => Math.random() - 0.5)

    for (const data of shuffled) {
      const { prediction, magnitude } = extractPrediction(
        data.text,
        item.fundamentalMetric,
      )

      let finalScore: number
      if (prediction === null) {
        finalScore = 0.0
      } else if (prediction === item.answer) {
        const magnitudeScore =
          magnitude !== null
            ? calculateMagnitudeScore(magnitude, item.magnitude)
            : 0.0
        finalScore = 1.0 + magnitudeScore
      } else {
        finalScore = 0.0
      }

      const responseTokens = data.tokens.length
      if (responseTokens > this.config.maxTokenLength * 0.95) {
        finalScore -= 0.5 * (responseTokens / this.config.maxTokenLength)
      }

      const binaryReward = finalScore > 0 ? 1.0 : -1.0

      const mask = data.tokens.map((_, i) =>
        i < data.tokens.length - 1 ? i : -100,
      )

      if (mask.filter((m) => m !== -100).length < 10) {
        continue
      }

      scores.tokens.push(data.tokens)
      scores.masks.push(mask)
      scores.inference_logprobs?.push(data.logprobs)
      scores.scores.push(binaryReward)

      const directionalCorrect =
        prediction === item.answer && prediction !== null ? 1.0 : 0.0
      this.percentCorrectBuffer.push(directionalCorrect)

      if (prediction === item.answer && magnitude !== null) {
        this.magnitudeAccuracyBuffer.push(
          calculateMagnitudeScore(magnitude, item.magnitude),
        )
      }

      if (scores.tokens.length >= this.config.groupSize) {
        break
      }
    }

    const allSame = scores.scores.every((s) => s === scores.scores[0])
    if (allSame) {
      return null
    }

    return scores
  }

  async evaluate(): Promise<{
    directionAccuracy: number
    magnitudeAccuracy: number
    combinedScore: number
  }> {
    const directionScores: number[] = []
    const magnitudeScores: number[] = []
    const combinedScores: number[] = []

    for (const testItem of this.test) {
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: createUserMessage(
            testItem.context,
            testItem.fundamental_metric,
          ),
        },
      ]

      const prompt = `${messages
        .map((m) => {
          if (m.role === 'system') return `<|system|>\n${m.content}\n`
          if (m.role === 'user') return `<|user|>\n${m.content}\n`
          return `<|assistant|>\n${m.content}\n`
        })
        .join('')}<|assistant|>\n`

      const completions = await this.generateCompletions(
        prompt,
        1,
        1024 * 16,
        0.2,
      )
      const modelChoice = completions.choices[0]
      if (!modelChoice) {
        throw new Error('No completion returned')
      }
      const modelResponse = modelChoice.text

      const { prediction, magnitude } = extractPrediction(
        modelResponse,
        testItem.fundamental_metric,
      )

      const directionScore =
        prediction === testItem.answer && prediction !== null ? 1 : 0
      directionScores.push(directionScore)

      let magnitudeScore = 0
      if (directionScore === 1 && magnitude !== null) {
        magnitudeScore = calculateMagnitudeScore(magnitude, testItem.magnitude)
        magnitudeScores.push(magnitudeScore)
      }

      const combinedScore = directionScore === 1 ? 1 + magnitudeScore : 0
      combinedScores.push(combinedScore)
    }

    const directionAccuracy =
      directionScores.length > 0
        ? directionScores.reduce((a, b) => a + b, 0) / directionScores.length
        : 0
    const magnitudeAccuracy =
      magnitudeScores.length > 0
        ? magnitudeScores.reduce((a, b) => a + b, 0) / magnitudeScores.length
        : 0
    const avgCombinedScore =
      combinedScores.length > 0
        ? combinedScores.reduce((a, b) => a + b, 0) / combinedScores.length
        : 0

    return {
      directionAccuracy,
      magnitudeAccuracy,
      combinedScore: avgCombinedScore,
    }
  }

  getTrainingMetrics(): {
    directionAccuracy: number
    magnitudeAccuracy: number
    combinedScore: number
  } {
    const directionAccuracy =
      this.percentCorrectBuffer.length > 0
        ? this.percentCorrectBuffer.reduce((a, b) => a + b, 0) /
          this.percentCorrectBuffer.length
        : 0

    const magnitudeAccuracy =
      this.magnitudeAccuracyBuffer.length > 0
        ? this.magnitudeAccuracyBuffer.reduce((a, b) => a + b, 0) /
          this.magnitudeAccuracyBuffer.length
        : 0

    this.percentCorrectBuffer = []
    this.magnitudeAccuracyBuffer = []

    return {
      directionAccuracy,
      magnitudeAccuracy,
      combinedScore: directionAccuracy + magnitudeAccuracy,
    }
  }
}

// Factory

export function createFundamentalPredictionEnv(
  config?: Partial<EnvConfig>,
  serverConfigs?: APIServerConfig[],
): FundamentalPredictionEnv {
  const defaults = FundamentalPredictionEnv.configInit()

  return new FundamentalPredictionEnv(
    { ...defaults.envConfig, ...config },
    serverConfigs ?? defaults.serverConfigs,
  )
}
