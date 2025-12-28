import { createHash } from 'node:crypto'
import type { Address } from 'viem'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogEntry {
  timestamp: number
  level: LogLevel
  message: string

  // Context
  service: string
  instance?: string
  traceId?: string
  spanId?: string

  // Structured data
  attributes: Record<string, string | number | boolean>

  // Error info
  error?: {
    name: string
    message: string
    stack?: string
  }
}

export interface LogQuery {
  service?: string
  level?: LogLevel[]
  startTime?: number
  endTime?: number
  search?: string
  attributes?: Record<string, string>
  limit?: number
}

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary'

export interface MetricDefinition {
  name: string
  type: MetricType
  help: string
  labels: string[]
}

export interface MetricValue {
  name: string
  labels: Record<string, string>
  value: number
  timestamp: number
}

export interface HistogramValue {
  name: string
  labels: Record<string, string>
  buckets: Array<{ le: number; count: number }>
  sum: number
  count: number
  timestamp: number
}

export type SpanKind =
  | 'internal'
  | 'server'
  | 'client'
  | 'producer'
  | 'consumer'

export type SpanStatus = 'unset' | 'ok' | 'error'

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string

  name: string
  kind: SpanKind
  status: SpanStatus

  startTime: number
  endTime?: number
  durationMs?: number

  // Context
  service: string

  // Attributes
  attributes: Record<string, string | number | boolean>

  // Events
  events: SpanEvent[]

  // Links to other spans
  links: Array<{ traceId: string; spanId: string }>
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes: Record<string, string | number | boolean>
}

export interface TraceQuery {
  traceId?: string
  service?: string
  name?: string
  startTime?: number
  endTime?: number
  minDurationMs?: number
  status?: SpanStatus
  limit?: number
}

export type AlertSeverity = 'info' | 'warning' | 'critical'

export type AlertState = 'pending' | 'firing' | 'resolved'

export interface AlertRule {
  ruleId: string
  name: string
  expression: string // PromQL-like expression
  duration: number // How long condition must be true
  severity: AlertSeverity
  labels: Record<string, string>
  annotations: {
    summary: string
    description: string
    runbook?: string
  }
  enabled: boolean
}

export interface Alert {
  alertId: string
  ruleId: string
  state: AlertState
  severity: AlertSeverity

  labels: Record<string, string>
  annotations: Record<string, string>

  startedAt: number
  resolvedAt?: number
  lastEvaluatedAt: number

  // Notification tracking
  notifiedAt?: number
  acknowledgedAt?: number
  acknowledgedBy?: Address
}

export class Logger {
  private entries: LogEntry[] = []
  private maxEntries = 100000
  private service: string
  private instance: string
  private onLog?: (entry: LogEntry) => void

  constructor(
    service: string,
    instance?: string,
    onLog?: (entry: LogEntry) => void,
  ) {
    this.service = service
    this.instance = instance ?? crypto.randomUUID().slice(0, 8)
    this.onLog = onLog
  }

  private log(
    level: LogLevel,
    message: string,
    attributes: Record<string, unknown> = {},
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      service: this.service,
      instance: this.instance,
      attributes: this.normalizeAttributes(attributes),
    }

    // Extract trace context
    if (attributes.traceId) {
      entry.traceId = String(attributes.traceId)
    }
    if (attributes.spanId) {
      entry.spanId = String(attributes.spanId)
    }

    // Extract error
    if (attributes.error instanceof Error) {
      entry.error = {
        name: attributes.error.name,
        message: attributes.error.message,
        stack: attributes.error.stack,
      }
    }

    this.entries.push(entry)

    // Evict old entries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift()
    }

    // Console output
    const logFn =
      level === 'error' || level === 'fatal' ? console.error : console.log
    logFn(`[${this.service}] ${level.toUpperCase()}: ${message}`, attributes)

    // Callback
    this.onLog?.(entry)

    return entry
  }

  private normalizeAttributes(
    attrs: Record<string, unknown>,
  ): Record<string, string | number | boolean> {
    const normalized: Record<string, string | number | boolean> = {}

    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'error' || key === 'traceId' || key === 'spanId') continue

      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        normalized[key] = value
      } else if (value !== null && value !== undefined) {
        normalized[key] = JSON.stringify(value)
      }
    }

    return normalized
  }

  debug(message: string, attributes?: Record<string, unknown>): LogEntry {
    return this.log('debug', message, attributes)
  }

  info(message: string, attributes?: Record<string, unknown>): LogEntry {
    return this.log('info', message, attributes)
  }

  warn(message: string, attributes?: Record<string, unknown>): LogEntry {
    return this.log('warn', message, attributes)
  }

  error(message: string, attributes?: Record<string, unknown>): LogEntry {
    return this.log('error', message, attributes)
  }

  fatal(message: string, attributes?: Record<string, unknown>): LogEntry {
    return this.log('fatal', message, attributes)
  }

  query(query: LogQuery): LogEntry[] {
    let results = this.entries

    if (query.service) {
      results = results.filter((e) => e.service === query.service)
    }

    if (query.level && query.level.length > 0) {
      results = results.filter((e) => query.level?.includes(e.level))
    }

    if (query.startTime) {
      results = results.filter((e) => e.timestamp >= (query.startTime ?? 0))
    }

    if (query.endTime) {
      results = results.filter(
        (e) => e.timestamp <= (query.endTime ?? Infinity),
      )
    }

    if (query.search) {
      const search = query.search.toLowerCase()
      results = results.filter((e) => e.message.toLowerCase().includes(search))
    }

    if (query.attributes) {
      for (const [key, value] of Object.entries(query.attributes)) {
        results = results.filter((e) => String(e.attributes[key]) === value)
      }
    }

    return results.slice(-(query.limit ?? 100))
  }

  child(_attributes: Record<string, string>): Logger {
    const child = new Logger(this.service, this.instance, this.onLog)
    // Would merge attributes
    return child
  }
}

export class MetricsRegistry {
  private definitions = new Map<string, MetricDefinition>()
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<
    string,
    { buckets: number[]; values: number[] }
  >()

  // Default histogram buckets
  private defaultBuckets = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ]

  private labelKey(name: string, labels: Record<string, string>): string {
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b))
    return `${name}{${sorted.map(([k, v]) => `${k}="${v}"`).join(',')}}`
  }

  registerCounter(name: string, help: string, labels: string[] = []): void {
    this.definitions.set(name, { name, type: 'counter', help, labels })
  }

  registerGauge(name: string, help: string, labels: string[] = []): void {
    this.definitions.set(name, { name, type: 'gauge', help, labels })
  }

  registerHistogram(
    name: string,
    help: string,
    labels: string[] = [],
    _buckets?: number[],
  ): void {
    this.definitions.set(name, { name, type: 'histogram', help, labels })
    // Store buckets in histogram config
  }

  incCounter(
    name: string,
    labels: Record<string, string> = {},
    value = 1,
  ): void {
    const key = this.labelKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + value)
  }

  setGauge(name: string, labels: Record<string, string>, value: number): void {
    const key = this.labelKey(name, labels)
    this.gauges.set(key, value)
  }

  incGauge(name: string, labels: Record<string, string>, value = 1): void {
    const key = this.labelKey(name, labels)
    this.gauges.set(key, (this.gauges.get(key) ?? 0) + value)
  }

  decGauge(name: string, labels: Record<string, string>, value = 1): void {
    const key = this.labelKey(name, labels)
    this.gauges.set(key, (this.gauges.get(key) ?? 0) - value)
  }

  observeHistogram(
    name: string,
    labels: Record<string, string>,
    value: number,
  ): void {
    const key = this.labelKey(name, labels)
    const histogram = this.histograms.get(key) ?? {
      buckets: [...this.defaultBuckets],
      values: [],
    }
    histogram.values.push(value)

    // Keep only last 1000 values for summary statistics
    if (histogram.values.length > 1000) {
      histogram.values.shift()
    }

    this.histograms.set(key, histogram)
  }

  getCounter(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(this.labelKey(name, labels)) ?? 0
  }

  getGauge(name: string, labels: Record<string, string>): number {
    return this.gauges.get(this.labelKey(name, labels)) ?? 0
  }

  getHistogram(
    name: string,
    labels: Record<string, string>,
  ): HistogramValue | null {
    const key = this.labelKey(name, labels)
    const histogram = this.histograms.get(key)

    if (!histogram || histogram.values.length === 0) return null

    const buckets = histogram.buckets.map((le) => {
      const count = histogram.values.filter((v) => v <= le).length
      return { le, count }
    })

    return {
      name,
      labels,
      buckets,
      sum: histogram.values.reduce((a, b) => a + b, 0),
      count: histogram.values.length,
      timestamp: Date.now(),
    }
  }

  // Export in Prometheus format
  export(): string {
    const lines: string[] = []

    for (const [name, def] of this.definitions) {
      lines.push(`# HELP ${name} ${def.help}`)
      lines.push(`# TYPE ${name} ${def.type}`)
    }

    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`)
    }

    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`)
    }

    for (const [key, histogram] of this.histograms) {
      const baseName = key.split('{')[0]
      const labels = key.match(/\{([^}]*)\}/)?.[1] ?? ''

      for (const bucket of this.defaultBuckets) {
        const count = histogram.values.filter((v) => v <= bucket).length
        const bucketLabels = labels
          ? `${labels},le="${bucket}"`
          : `le="${bucket}"`
        lines.push(`${baseName}_bucket{${bucketLabels}} ${count}`)
      }

      lines.push(
        `${baseName}_sum{${labels}} ${histogram.values.reduce((a, b) => a + b, 0)}`,
      )
      lines.push(`${baseName}_count{${labels}} ${histogram.values.length}`)
    }

    return lines.join('\n')
  }
}

export class Tracer {
  private spans = new Map<string, Span>()
  private spansByTrace = new Map<string, string[]>()
  private service: string
  private maxSpans = 100000

  constructor(service: string) {
    this.service = service
  }

  startSpan(
    name: string,
    options: {
      kind?: SpanKind
      parentSpanId?: string
      traceId?: string
      attributes?: Record<string, string | number | boolean>
    } = {},
  ): Span {
    const traceId = options.traceId ?? this.generateId()
    const spanId = this.generateId()

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      name,
      kind: options.kind ?? 'internal',
      status: 'unset',
      startTime: Date.now(),
      service: this.service,
      attributes: options.attributes ?? {},
      events: [],
      links: [],
    }

    this.spans.set(spanId, span)

    const traceSpans = this.spansByTrace.get(traceId) ?? []
    traceSpans.push(spanId)
    this.spansByTrace.set(traceId, traceSpans)

    // Evict old spans
    while (this.spans.size > this.maxSpans) {
      const oldestSpan = Array.from(this.spans.values())[0]
      this.spans.delete(oldestSpan.spanId)
      const traceSpanIds = this.spansByTrace.get(oldestSpan.traceId)
      if (traceSpanIds) {
        const idx = traceSpanIds.indexOf(oldestSpan.spanId)
        if (idx >= 0) traceSpanIds.splice(idx, 1)
        if (traceSpanIds.length === 0)
          this.spansByTrace.delete(oldestSpan.traceId)
      }
    }

    return span
  }

  endSpan(spanId: string, status: SpanStatus = 'ok'): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.endTime = Date.now()
    span.durationMs = span.endTime - span.startTime
    span.status = status
  }

  addEvent(
    spanId: string,
    name: string,
    attributes: Record<string, string | number | boolean> = {},
  ): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    })
  }

  setAttribute(
    spanId: string,
    key: string,
    value: string | number | boolean,
  ): void {
    const span = this.spans.get(spanId)
    if (!span) return

    span.attributes[key] = value
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId)
  }

  getTrace(traceId: string): Span[] {
    const spanIds = this.spansByTrace.get(traceId) ?? []
    return spanIds
      .map((id) => this.spans.get(id))
      .filter((s): s is Span => s !== undefined)
      .sort((a, b) => a.startTime - b.startTime)
  }

  query(query: TraceQuery): Span[] {
    let results = Array.from(this.spans.values())

    if (query.traceId) {
      return this.getTrace(query.traceId)
    }

    if (query.service) {
      results = results.filter((s) => s.service === query.service)
    }

    if (query.name) {
      results = results.filter((s) => s.name.includes(query.name ?? ''))
    }

    if (query.startTime) {
      results = results.filter((s) => s.startTime >= (query.startTime ?? 0))
    }

    if (query.endTime) {
      results = results.filter(
        (s) => s.startTime <= (query.endTime ?? Infinity),
      )
    }

    if (query.minDurationMs !== undefined) {
      results = results.filter(
        (s) => (s.durationMs ?? 0) >= (query.minDurationMs ?? 0),
      )
    }

    if (query.status) {
      results = results.filter((s) => s.status === query.status)
    }

    return results.slice(-(query.limit ?? 100))
  }

  private generateId(): string {
    return createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 16)
  }
}

export class AlertManager {
  private rules = new Map<string, AlertRule>()
  private alerts = new Map<string, Alert>()
  private notifyCallback?: (alert: Alert) => Promise<void>

  constructor(notifyCallback?: (alert: Alert) => Promise<void>) {
    this.notifyCallback = notifyCallback
  }

  addRule(rule: Omit<AlertRule, 'ruleId'>): AlertRule {
    const ruleId = createHash('sha256')
      .update(`${rule.name}-${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const fullRule: AlertRule = { ...rule, ruleId }
    this.rules.set(ruleId, fullRule)

    return fullRule
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId)
  }

  enableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId)
    if (rule) rule.enabled = true
  }

  disableRule(ruleId: string): void {
    const rule = this.rules.get(ruleId)
    if (rule) rule.enabled = false
  }

  async evaluateRule(
    rule: AlertRule,
    currentValue: number,
    threshold: number,
  ): Promise<void> {
    const alertId = `${rule.ruleId}-${JSON.stringify(rule.labels)}`
    const existingAlert = this.alerts.get(alertId)
    const shouldFire = currentValue > threshold // Simplified; would parse expression

    if (shouldFire) {
      if (!existingAlert || existingAlert.state === 'resolved') {
        // Create new alert
        const alert: Alert = {
          alertId,
          ruleId: rule.ruleId,
          state: 'pending',
          severity: rule.severity,
          labels: rule.labels,
          annotations: rule.annotations,
          startedAt: Date.now(),
          lastEvaluatedAt: Date.now(),
        }

        this.alerts.set(alertId, alert)
      } else if (existingAlert.state === 'pending') {
        // Check if duration threshold met
        if (Date.now() - existingAlert.startedAt >= rule.duration * 1000) {
          existingAlert.state = 'firing'
          existingAlert.lastEvaluatedAt = Date.now()

          // Notify
          if (this.notifyCallback && !existingAlert.notifiedAt) {
            await this.notifyCallback(existingAlert)
            existingAlert.notifiedAt = Date.now()
          }
        }
      }
    } else {
      if (existingAlert && existingAlert.state !== 'resolved') {
        existingAlert.state = 'resolved'
        existingAlert.resolvedAt = Date.now()
        existingAlert.lastEvaluatedAt = Date.now()
      }
    }
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: Address): void {
    const alert = this.alerts.get(alertId)
    if (alert) {
      alert.acknowledgedAt = Date.now()
      alert.acknowledgedBy = acknowledgedBy
    }
  }

  getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId)
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => a.state === 'firing')
  }

  getAllAlerts(): Alert[] {
    return Array.from(this.alerts.values())
  }

  listRules(): AlertRule[] {
    return Array.from(this.rules.values())
  }
}

export interface HealthCheck {
  name: string
  check: () => Promise<{ healthy: boolean; message?: string }>
}

export interface HealthStatus {
  healthy: boolean
  checks: Array<{
    name: string
    healthy: boolean
    message?: string
    durationMs: number
  }>
  timestamp: number
}

export class HealthChecker {
  private checks: HealthCheck[] = []

  register(
    name: string,
    check: () => Promise<{ healthy: boolean; message?: string }>,
  ): void {
    this.checks.push({ name, check })
  }

  async check(): Promise<HealthStatus> {
    const results: HealthStatus['checks'] = []
    let allHealthy = true

    for (const { name, check } of this.checks) {
      const start = Date.now()
      try {
        const result = await check()
        results.push({
          name,
          healthy: result.healthy,
          message: result.message,
          durationMs: Date.now() - start,
        })
        if (!result.healthy) allHealthy = false
      } catch (error) {
        results.push({
          name,
          healthy: false,
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - start,
        })
        allHealthy = false
      }
    }

    return {
      healthy: allHealthy,
      checks: results,
      timestamp: Date.now(),
    }
  }
}

const loggers = new Map<string, Logger>()
const tracers = new Map<string, Tracer>()
let metricsRegistry: MetricsRegistry | null = null
let alertManager: AlertManager | null = null
let healthChecker: HealthChecker | null = null

export function getLogger(service: string): Logger {
  let logger = loggers.get(service)
  if (!logger) {
    logger = new Logger(service)
    loggers.set(service, logger)
  }
  return logger
}

export function getTracer(service: string): Tracer {
  let tracer = tracers.get(service)
  if (!tracer) {
    tracer = new Tracer(service)
    tracers.set(service, tracer)
  }
  return tracer
}

export function getMetricsRegistry(): MetricsRegistry {
  if (!metricsRegistry) {
    metricsRegistry = new MetricsRegistry()

    // Register default metrics
    metricsRegistry.registerCounter(
      'http_requests_total',
      'Total HTTP requests',
      ['method', 'path', 'status'],
    )
    metricsRegistry.registerHistogram(
      'http_request_duration_seconds',
      'HTTP request duration',
      ['method', 'path'],
    )
    metricsRegistry.registerGauge('active_connections', 'Active connections', [
      'service',
    ])
    metricsRegistry.registerCounter('errors_total', 'Total errors', [
      'service',
      'type',
    ])
  }
  return metricsRegistry
}

export function getAlertManager(
  notifyCallback?: (alert: Alert) => Promise<void>,
): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager(notifyCallback)
  }
  return alertManager
}

export function getHealthChecker(): HealthChecker {
  if (!healthChecker) {
    healthChecker = new HealthChecker()
  }
  return healthChecker
}
