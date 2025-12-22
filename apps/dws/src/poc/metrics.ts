/**
 * Proof-of-Cloud Metrics Exporter
 */

import type {
  PoCStatus,
  PoCVerificationEvent,
  PoCVerificationLevel,
} from './types'

interface PrometheusMetric {
  name: string
  help: string
  type: 'gauge' | 'counter'
  labels: Record<string, string>
  value: number
}

export class PoCMetrics {
  private verificationsTotal = 0
  private verificationsSuccess = 0
  private verificationsFailed = 0
  private revocationsTotal = 0
  private activeAgents = 0
  private pendingVerifications = 0
  private lastVerificationMs = 0
  private verificationDurations: number[] = []
  private statusCounts: Record<PoCStatus, number> = {
    verified: 0,
    pending: 0,
    rejected: 0,
    revoked: 0,
    unknown: 0,
  }
  private levelCounts: Record<PoCVerificationLevel, number> = {
    1: 0,
    2: 0,
    3: 0,
  }
  private errorCounts: Record<string, number> = {}
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(private readonly metricsPort: number = 9091) {}

  recordVerification(event: PoCVerificationEvent): void {
    if (event.type === 'request') {
      this.pendingVerifications++
    } else if (event.type === 'result') {
      this.verificationsTotal++
      this.pendingVerifications = Math.max(0, this.pendingVerifications - 1)

      if (event.status) {
        this.statusCounts[event.status]++
        if (event.status === 'verified') this.verificationsSuccess++
        else if (event.status === 'rejected' || event.status === 'revoked')
          this.verificationsFailed++
      }

      if (event.level) this.levelCounts[event.level]++

      const duration = (event.metadata as { durationMs?: number })?.durationMs
      if (typeof duration === 'number') {
        this.verificationDurations.push(duration)
        if (this.verificationDurations.length > 1000)
          this.verificationDurations.shift()
      }

      this.lastVerificationMs = event.timestamp
    } else if (event.type === 'revocation') {
      this.revocationsTotal++
    } else if (event.type === 'error') {
      const code = (event.metadata as { code?: string })?.code ?? 'UNKNOWN'
      this.errorCounts[code] = (this.errorCounts[code] ?? 0) + 1
    }
  }

  setActiveAgents(count: number): void {
    this.activeAgents = count
  }

  getMetrics(): PrometheusMetric[] {
    const metrics: PrometheusMetric[] = [
      {
        name: 'poc_verifications_total',
        help: 'Total verification attempts',
        type: 'counter',
        labels: {},
        value: this.verificationsTotal,
      },
      {
        name: 'poc_verifications_success',
        help: 'Successful verifications',
        type: 'counter',
        labels: {},
        value: this.verificationsSuccess,
      },
      {
        name: 'poc_verifications_failed',
        help: 'Failed verifications',
        type: 'counter',
        labels: {},
        value: this.verificationsFailed,
      },
      {
        name: 'poc_revocations_total',
        help: 'Total revocations processed',
        type: 'counter',
        labels: {},
        value: this.revocationsTotal,
      },
      {
        name: 'poc_active_agents',
        help: 'Number of actively monitored agents',
        type: 'gauge',
        labels: {},
        value: this.activeAgents,
      },
      {
        name: 'poc_pending_verifications',
        help: 'Verifications currently in progress',
        type: 'gauge',
        labels: {},
        value: this.pendingVerifications,
      },
      {
        name: 'poc_last_verification_timestamp',
        help: 'Unix timestamp of last verification',
        type: 'gauge',
        labels: {},
        value: this.lastVerificationMs,
      },
    ]

    // Status breakdown
    for (const [status, count] of Object.entries(this.statusCounts)) {
      metrics.push({
        name: 'poc_status_count',
        help: 'Verifications by status',
        type: 'counter',
        labels: { status },
        value: count,
      })
    }

    // Level breakdown
    for (const [level, count] of Object.entries(this.levelCounts)) {
      metrics.push({
        name: 'poc_level_count',
        help: 'Verifications by level',
        type: 'counter',
        labels: { level },
        value: count,
      })
    }

    // Error breakdown
    for (const [code, count] of Object.entries(this.errorCounts)) {
      metrics.push({
        name: 'poc_errors',
        help: 'Errors by code',
        type: 'counter',
        labels: { code },
        value: count,
      })
    }

    // Percentiles
    if (this.verificationDurations.length > 0) {
      const sorted = [...this.verificationDurations].sort((a, b) => a - b)
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
      const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0
      metrics.push({
        name: 'poc_verification_duration_p50_ms',
        help: 'P50 verification duration',
        type: 'gauge',
        labels: {},
        value: p50,
      })
      metrics.push({
        name: 'poc_verification_duration_p95_ms',
        help: 'P95 verification duration',
        type: 'gauge',
        labels: {},
        value: p95,
      })
      metrics.push({
        name: 'poc_verification_duration_p99_ms',
        help: 'P99 verification duration',
        type: 'gauge',
        labels: {},
        value: p99,
      })
    }

    return metrics
  }

  formatPrometheus(): string {
    const lines: string[] = []
    for (const m of this.getMetrics()) {
      lines.push(`# HELP ${m.name} ${m.help}`)
      lines.push(`# TYPE ${m.name} ${m.type}`)
      const labelStr = Object.entries(m.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      lines.push(
        labelStr ? `${m.name}{${labelStr}} ${m.value}` : `${m.name} ${m.value}`,
      )
    }
    return lines.join('\n')
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.metricsPort,
      fetch: async (req) => {
        const { pathname } = new URL(req.url)
        if (pathname === '/metrics') {
          return new Response(this.formatPrometheus(), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        }
        if (pathname === '/health') {
          return new Response(
            JSON.stringify({ status: 'healthy', timestamp: Date.now() }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('Not Found', { status: 404 })
      },
    })
    console.log(`[PoCMetrics] Server started on port ${this.metricsPort}`)
  }

  stop(): void {
    this.server?.stop()
    this.server = null
  }
}

let metricsInstance: PoCMetrics | null = null

export function getPoCMetrics(port?: number): PoCMetrics {
  if (!metricsInstance) metricsInstance = new PoCMetrics(port)
  return metricsInstance
}
