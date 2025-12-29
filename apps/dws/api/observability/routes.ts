import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import {
  getAlertManager,
  getHealthChecker,
  getLogger,
  getMetricsRegistry,
  getTracer,
  type LogEntry,
  type LogLevel,
  type SpanStatus,
} from './index'

export function createObservabilityRoutes(serviceName = 'dws') {
  const logger = getLogger(serviceName)
  const metrics = getMetricsRegistry()
  const tracer = getTracer(serviceName)
  const alertManager = getAlertManager()
  const healthChecker = getHealthChecker()

  // Register default health checks
  healthChecker.register('database', async () => {
    // Would check database connectivity
    return { healthy: true, message: 'Database connection OK' }
  })

  healthChecker.register('storage', async () => {
    // Would check IPFS/storage connectivity
    return { healthy: true, message: 'Storage backend OK' }
  })

  return (
    new Elysia({ prefix: '/observability' })

      // =========================================================================
      // Health Check Routes
      // =========================================================================
      .get('/health', async () => {
        const status = await healthChecker.check()
        const statusCode = status.healthy ? 200 : 503

        return new Response(JSON.stringify(status), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      .get('/health/ready', async () => {
        const status = await healthChecker.check()
        return new Response(status.healthy ? 'OK' : 'NOT READY', {
          status: status.healthy ? 200 : 503,
        })
      })

      .get('/health/live', () => {
        return new Response('OK', { status: 200 })
      })

      // =========================================================================
      // Logs Routes
      // =========================================================================
      .group('/logs', (app) =>
        app
          // Query logs
          .get('/', ({ query }) => {
            const results = logger.query({
              service: query.service as string,
              level: query.level ? [query.level as LogLevel] : undefined,
              startTime: query.startTime
                ? parseInt(query.startTime as string, 10)
                : undefined,
              endTime: query.endTime
                ? parseInt(query.endTime as string, 10)
                : undefined,
              search: query.search as string,
              limit: query.limit ? parseInt(query.limit as string, 10) : 100,
            })

            return { logs: results }
          })

          // Write log entry (for external services)
          .post(
            '/',
            ({ body }) => {
              const level = body.level as LogLevel
              const message = body.message as string
              const attributes = (body.attributes ?? {}) as Record<
                string,
                unknown
              >

              let entry: LogEntry | undefined
              switch (level) {
                case 'debug':
                  entry = logger.debug(message, attributes)
                  break
                case 'info':
                  entry = logger.info(message, attributes)
                  break
                case 'warn':
                  entry = logger.warn(message, attributes)
                  break
                case 'error':
                  entry = logger.error(message, attributes)
                  break
                case 'fatal':
                  entry = logger.fatal(message, attributes)
                  break
                default:
                  entry = logger.info(message, attributes)
              }

              return { entry }
            },
            {
              body: t.Object({
                level: t.Union([
                  t.Literal('debug'),
                  t.Literal('info'),
                  t.Literal('warn'),
                  t.Literal('error'),
                  t.Literal('fatal'),
                ]),
                message: t.String(),
                attributes: t.Optional(t.Record(t.String(), t.Unknown())),
              }),
            },
          ),
      )

      // =========================================================================
      // Metrics Routes
      // =========================================================================
      .group('/metrics', (app) =>
        app
          // Prometheus-compatible metrics endpoint
          .get('/', () => {
            const metricsText = metrics.export()
            return new Response(metricsText, {
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          })

          // Record counter
          .post(
            '/counter',
            ({ body }) => {
              metrics.incCounter(body.name, body.labels ?? {}, body.value ?? 1)
              return { success: true }
            },
            {
              body: t.Object({
                name: t.String(),
                labels: t.Optional(t.Record(t.String(), t.String())),
                value: t.Optional(t.Number()),
              }),
            },
          )

          // Record gauge
          .post(
            '/gauge',
            ({ body }) => {
              if (body.action === 'set') {
                metrics.setGauge(body.name, body.labels ?? {}, body.value)
              } else if (body.action === 'inc') {
                metrics.incGauge(body.name, body.labels ?? {}, body.value)
              } else if (body.action === 'dec') {
                metrics.decGauge(body.name, body.labels ?? {}, body.value)
              }
              return { success: true }
            },
            {
              body: t.Object({
                name: t.String(),
                labels: t.Optional(t.Record(t.String(), t.String())),
                value: t.Number(),
                action: t.Union([
                  t.Literal('set'),
                  t.Literal('inc'),
                  t.Literal('dec'),
                ]),
              }),
            },
          )

          // Record histogram observation
          .post(
            '/histogram',
            ({ body }) => {
              metrics.observeHistogram(body.name, body.labels ?? {}, body.value)
              return { success: true }
            },
            {
              body: t.Object({
                name: t.String(),
                labels: t.Optional(t.Record(t.String(), t.String())),
                value: t.Number(),
              }),
            },
          )

          // Get single metric
          .get('/:name', ({ params, query }) => {
            const labels = query.labels
              ? JSON.parse(query.labels as string)
              : {}

            // Try histogram first
            const histogram = metrics.getHistogram(params.name, labels)
            if (histogram) {
              return { type: 'histogram', value: histogram }
            }

            // Try gauge
            const gauge = metrics.getGauge(params.name, labels)
            if (gauge !== 0) {
              return { type: 'gauge', value: gauge }
            }

            // Try counter
            const counter = metrics.getCounter(params.name, labels)
            return { type: 'counter', value: counter }
          }),
      )

      // =========================================================================
      // Traces Routes
      // =========================================================================
      .group('/traces', (app) =>
        app
          // Query traces
          .get('/', ({ query }) => {
            const spans = tracer.query({
              traceId: query.traceId as string,
              service: query.service as string,
              name: query.name as string,
              startTime: query.startTime
                ? parseInt(query.startTime as string, 10)
                : undefined,
              endTime: query.endTime
                ? parseInt(query.endTime as string, 10)
                : undefined,
              minDurationMs: query.minDurationMs
                ? parseInt(query.minDurationMs as string, 10)
                : undefined,
              status: query.status as SpanStatus,
              limit: query.limit ? parseInt(query.limit as string, 10) : 100,
            })

            return { spans }
          })

          // Get trace by ID
          .get('/:traceId', ({ params }) => {
            const spans = tracer.getTrace(params.traceId)
            return { traceId: params.traceId, spans }
          })

          // Start a new span
          .post(
            '/spans',
            ({ body }) => {
              const span = tracer.startSpan(body.name, {
                kind: body.kind,
                parentSpanId: body.parentSpanId,
                traceId: body.traceId,
                attributes: body.attributes,
              })

              return { span }
            },
            {
              body: t.Object({
                name: t.String(),
                kind: t.Optional(
                  t.Union([
                    t.Literal('internal'),
                    t.Literal('server'),
                    t.Literal('client'),
                    t.Literal('producer'),
                    t.Literal('consumer'),
                  ]),
                ),
                parentSpanId: t.Optional(t.String()),
                traceId: t.Optional(t.String()),
                attributes: t.Optional(
                  t.Record(
                    t.String(),
                    t.Union([t.String(), t.Number(), t.Boolean()]),
                  ),
                ),
              }),
            },
          )

          // End a span
          .post(
            '/spans/:spanId/end',
            ({ params, body }) => {
              tracer.endSpan(params.spanId, body.status)

              const span = tracer.getSpan(params.spanId)
              return { span }
            },
            {
              body: t.Object({
                status: t.Optional(
                  t.Union([
                    t.Literal('unset'),
                    t.Literal('ok'),
                    t.Literal('error'),
                  ]),
                ),
              }),
            },
          )

          // Add event to span
          .post(
            '/spans/:spanId/events',
            ({ params, body }) => {
              tracer.addEvent(params.spanId, body.name, body.attributes ?? {})
              return { success: true }
            },
            {
              body: t.Object({
                name: t.String(),
                attributes: t.Optional(
                  t.Record(
                    t.String(),
                    t.Union([t.String(), t.Number(), t.Boolean()]),
                  ),
                ),
              }),
            },
          )

          // Set span attribute
          .post(
            '/spans/:spanId/attributes',
            ({ params, body }) => {
              tracer.setAttribute(params.spanId, body.key, body.value)
              return { success: true }
            },
            {
              body: t.Object({
                key: t.String(),
                value: t.Union([t.String(), t.Number(), t.Boolean()]),
              }),
            },
          ),
      )

      // =========================================================================
      // Alerts Routes
      // =========================================================================
      .group('/alerts', (app) =>
        app
          // List alert rules
          .get('/rules', () => {
            return { rules: alertManager.listRules() }
          })

          // Create alert rule
          .post(
            '/rules',
            ({ body }) => {
              const rule = alertManager.addRule({
                name: body.name,
                expression: body.expression,
                duration: body.duration,
                severity: body.severity,
                labels: body.labels ?? {},
                annotations: {
                  summary: body.summary,
                  description: body.description,
                  runbook: body.runbook,
                },
                enabled: body.enabled ?? true,
              })

              return { rule }
            },
            {
              body: t.Object({
                name: t.String(),
                expression: t.String(),
                duration: t.Number(),
                severity: t.Union([
                  t.Literal('info'),
                  t.Literal('warning'),
                  t.Literal('critical'),
                ]),
                labels: t.Optional(t.Record(t.String(), t.String())),
                summary: t.String(),
                description: t.String(),
                runbook: t.Optional(t.String()),
                enabled: t.Optional(t.Boolean()),
              }),
            },
          )

          // Delete alert rule
          .delete('/rules/:ruleId', ({ params }) => {
            alertManager.removeRule(params.ruleId)
            return { success: true }
          })

          // Enable/disable alert rule
          .post(
            '/rules/:ruleId/toggle',
            ({ params, body }) => {
              if (body.enabled) {
                alertManager.enableRule(params.ruleId)
              } else {
                alertManager.disableRule(params.ruleId)
              }
              return { success: true }
            },
            {
              body: t.Object({
                enabled: t.Boolean(),
              }),
            },
          )

          // Get active alerts
          .get('/', () => {
            return { alerts: alertManager.getActiveAlerts() }
          })

          // Get all alerts (including resolved)
          .get('/all', () => {
            return { alerts: alertManager.getAllAlerts() }
          })

          // Get single alert
          .get('/:alertId', ({ params }) => {
            const alert = alertManager.getAlert(params.alertId)
            return { alert }
          })

          // Acknowledge alert
          .post('/:alertId/ack', ({ params, headers }) => {
            const address = headers['x-wallet-address'] as Address
            if (!address) {
              return { error: 'Unauthorized' }
            }

            alertManager.acknowledgeAlert(params.alertId, address)
            return { success: true }
          }),
      )

      // =========================================================================
      // Dashboard Data
      // =========================================================================
      .get('/dashboard', async () => {
        const health = await healthChecker.check()
        const activeAlerts = alertManager.getActiveAlerts()

        return {
          health,
          alerts: {
            active: activeAlerts.length,
            critical: activeAlerts.filter((a) => a.severity === 'critical')
              .length,
            warning: activeAlerts.filter((a) => a.severity === 'warning')
              .length,
          },
          metrics: {
            requestsTotal: metrics.getCounter('http_requests_total'),
            activeConnections: metrics.getGauge('active_connections', {}),
            errorsTotal: metrics.getCounter('errors_total'),
          },
        }
      })
  )
}
