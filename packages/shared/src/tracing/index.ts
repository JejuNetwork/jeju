/**
 * OpenTelemetry Distributed Tracing - Production Implementation
 *
 * Provides end-to-end request tracing with:
 * - Automatic instrumentation for HTTP, gRPC, Redis, PostgreSQL
 * - Context propagation across services
 * - Span attributes for debugging
 * - Export to Jaeger/OTLP collector
 * - Sampling configuration
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
} from '@opentelemetry/semantic-conventions';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  propagation,
  Span,
  Context,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { z } from 'zod';

// ============================================================================
// Configuration Schema
// ============================================================================

const TracingConfigSchema = z.object({
  serviceName: z.string(),
  serviceVersion: z.string().default('1.0.0'),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  collectorUrl: z.string().url().optional(),
  samplingRate: z.number().min(0).max(1).default(1),
  enableConsoleExport: z.boolean().default(false),
  enableMetrics: z.boolean().default(true),
  metricsIntervalMs: z.number().default(60000),
});

export type TracingConfig = z.infer<typeof TracingConfigSchema>;

// ============================================================================
// Tracer Instance
// ============================================================================

let sdk: NodeSDK | null = null;
let initialized = false;

/**
 * Initialize OpenTelemetry tracing
 */
export function initTracing(config: Partial<TracingConfig>): void {
  if (initialized) {
    console.warn('[Tracing] Already initialized');
    return;
  }

  const cfg = TracingConfigSchema.parse({
    serviceName: config.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'jeju-service',
    collectorUrl: config.collectorUrl ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    ...config,
  });

  // Create resource
  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: cfg.serviceName,
    [SEMRESATTRS_SERVICE_VERSION]: cfg.serviceVersion,
    [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: cfg.environment,
  });

  // Create exporters
  const exporters: BatchSpanProcessor[] = [];

  if (cfg.collectorUrl) {
    const traceExporter = new OTLPTraceExporter({
      url: `${cfg.collectorUrl}/v1/traces`,
    });
    exporters.push(new BatchSpanProcessor(traceExporter));
  }

  // Create metric reader if enabled
  let metricReader: PeriodicExportingMetricReader | undefined;
  if (cfg.enableMetrics && cfg.collectorUrl) {
    const metricExporter = new OTLPMetricExporter({
      url: `${cfg.collectorUrl}/v1/metrics`,
    });
    metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: cfg.metricsIntervalMs,
    });
  }

  // Initialize SDK
  sdk = new NodeSDK({
    resource,
    spanProcessors: exporters,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingPaths: ['/health', '/metrics', '/ready'],
        },
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  // Set up context propagation
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  // Start SDK
  sdk.start();
  initialized = true;

  console.log(`[Tracing] Initialized for ${cfg.serviceName}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => console.log('[Tracing] Shutdown complete'))
      .catch((err) => console.error('[Tracing] Shutdown error:', err));
  });
}

/**
 * Shutdown tracing
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = null;
    initialized = false;
    console.log('[Tracing] Shutdown');
  }
}

// ============================================================================
// Span Helpers
// ============================================================================

/**
 * Get tracer for a component
 */
export function getTracer(name: string) {
  return trace.getTracer(name);
}

/**
 * Start a new span
 */
export function startSpan(
  tracerName: string,
  spanName: string,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
    parentContext?: Context;
  }
): Span {
  const tracer = getTracer(tracerName);
  const ctx = options?.parentContext ?? context.active();

  return tracer.startSpan(
    spanName,
    {
      kind: options?.kind ?? SpanKind.INTERNAL,
      attributes: options?.attributes,
    },
    ctx
  );
}

/**
 * Execute function within a span
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): Promise<T> {
  const span = startSpan(tracerName, spanName, options);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error).message,
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute sync function within a span
 */
export function withSpanSync<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => T,
  options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
  }
): T {
  const span = startSpan(tracerName, spanName, options);

  try {
    const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: (error as Error).message,
    });
    span.recordException(error as Error);
    throw error;
  } finally {
    span.end();
  }
}

// ============================================================================
// Context Propagation
// ============================================================================

/**
 * Extract trace context from HTTP headers
 */
export function extractContext(headers: Record<string, string>): Context {
  return propagation.extract(context.active(), headers);
}

/**
 * Inject trace context into HTTP headers
 */
export function injectContext(headers: Record<string, string>): void {
  propagation.inject(context.active(), headers);
}

/**
 * Get current trace ID
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Get current span ID
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}

// ============================================================================
// Decorators for Service Methods
// ============================================================================

/**
 * Decorator to trace a method
 */
export function Traced(tracerName: string, spanName?: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const name = spanName ?? `${target.constructor.name}.${propertyKey}`;

    descriptor.value = async function (...args: unknown[]) {
      return withSpan(tracerName, name, async (span) => {
        span.setAttribute('method.name', propertyKey);
        span.setAttribute('method.args.count', args.length);
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}

// ============================================================================
// Middleware for HTTP Servers
// ============================================================================

/**
 * Express/Hono middleware for tracing
 */
export function tracingMiddleware(serviceName: string) {
  return async (
    req: { method: string; url: string; headers: Record<string, string> },
    res: { statusCode: number },
    next: () => Promise<void>
  ) => {
    const parentContext = extractContext(req.headers);

    await withSpan(
      serviceName,
      `${req.method} ${req.url}`,
      async (span) => {
        span.setAttribute('http.method', req.method);
        span.setAttribute('http.url', req.url);

        await next();

        span.setAttribute('http.status_code', res.statusCode);
      },
      { kind: SpanKind.SERVER, parentContext }
    );
  };
}

// ============================================================================
// Export Types
// ============================================================================

export { SpanKind, SpanStatusCode, Span, Context };
