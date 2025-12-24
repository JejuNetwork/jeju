export interface LoadTestEndpoint {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: Record<string, unknown>
  headers?: Record<string, string>
  weight: number
  name?: string
  expectedStatus?: number[]
  timeout?: number
}

export interface LoadTestThresholds {
  p50Latency: number
  p95Latency: number
  p99Latency: number
  errorRate: number
  minRps: number
}

export interface AppLoadTestConfig {
  name: string
  description: string
  baseUrl: string
  port: number
  healthEndpoint: string
  endpoints: LoadTestEndpoint[]
  thresholds: LoadTestThresholds
  // Network-specific overrides
  testnet?: {
    baseUrl?: string
    port?: number
  }
  mainnet?: {
    baseUrl?: string
    port?: number
  }
}

export interface LoadTestScenario {
  name: string
  description: string
  concurrentUsers: number
  durationSeconds: number
  rampUpSeconds: number
  thinkTimeMs: number
  maxRps?: number
}

export interface RequestResult {
  endpoint: string
  method: string
  status: number
  latency: number
  success: boolean
  error?: string
  timestamp: number
}

export interface EndpointStats {
  endpoint: string
  method: string
  totalRequests: number
  successCount: number
  errorCount: number
  latencies: number[]
  p50: number
  p95: number
  p99: number
  min: number
  max: number
  avg: number
  errorRate: number
  rps: number
}

export interface LoadTestResult {
  app: string
  scenario: string
  network: 'localnet' | 'testnet' | 'mainnet'
  startTime: Date
  endTime: Date
  durationSeconds: number
  totalRequests: number
  successCount: number
  errorCount: number
  errorRate: number
  rps: number
  latency: {
    p50: number
    p95: number
    p99: number
    min: number
    max: number
    avg: number
  }
  endpointStats: EndpointStats[]
  thresholdsPassed: boolean
  failures: ThresholdFailure[]
  errors: ErrorSummary[]
}

export interface ThresholdFailure {
  threshold: string
  expected: number
  actual: number
  message: string
}

export interface ErrorSummary {
  type: string
  count: number
  percentage: number
  examples: string[]
}

export interface BottleneckAnalysis {
  app: string
  severity: 'critical' | 'warning' | 'info'
  category: 'latency' | 'throughput' | 'errors' | 'stability'
  endpoint?: string
  message: string
  metric: string
  value: number
  threshold: number
  recommendation: string
}

export interface CombinedLoadTestResult {
  timestamp: Date
  network: 'localnet' | 'testnet' | 'mainnet'
  scenario: string
  apps: LoadTestResult[]
  overallHealthy: boolean
  bottlenecks: BottleneckAnalysis[]
  recommendations: string[]
}

export interface ContinuousImprovementState {
  runId: string
  iteration: number
  startTime: Date
  results: CombinedLoadTestResult[]
  currentBottlenecks: BottleneckAnalysis[]
  resolvedBottlenecks: BottleneckAnalysis[]
  improvements: ImprovementRecord[]
}

export interface ImprovementRecord {
  timestamp: Date
  bottleneck: BottleneckAnalysis
  action: string
  result: 'improved' | 'no_change' | 'degraded'
  before: number
  after: number
}
