/**
 * OIF Solver Prometheus Metrics
 * 
 * Exposes metrics for monitoring solver performance:
 * - Intent fills (count, duration, gas)
 * - Settlement claims
 * - Liquidity tracking
 * - Error rates
 */

// Metric counters (in-memory for now, can be replaced with prom-client)
interface MetricCounter {
  labels: Record<string, string>;
  value: number;
}

interface MetricHistogram {
  labels: Record<string, string>;
  count: number;
  sum: number;
  buckets: Record<number, number>;
}

class MetricsRegistry {
  private counters = new Map<string, MetricCounter[]>();
  private histograms = new Map<string, MetricHistogram[]>();
  private gauges = new Map<string, number>();

  incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const metrics = this.counters.get(name) || [];
    const existing = metrics.find(m => this.labelsMatch(m.labels, labels));
    if (existing) {
      existing.value += value;
    } else {
      metrics.push({ labels, value });
      this.counters.set(name, metrics);
    }
  }

  observeHistogram(name: string, labels: Record<string, string>, value: number, buckets: number[] = []): void {
    const metrics = this.histograms.get(name) || [];
    let existing = metrics.find(m => this.labelsMatch(m.labels, labels));
    
    if (!existing) {
      existing = { labels, count: 0, sum: 0, buckets: {} };
      for (const b of buckets) existing.buckets[b] = 0;
      metrics.push(existing);
      this.histograms.set(name, metrics);
    }
    
    existing.count++;
    existing.sum += value;
    for (const b of Object.keys(existing.buckets).map(Number)) {
      if (value <= b) existing.buckets[b]++;
    }
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  getGauge(name: string): number {
    return this.gauges.get(name) || 0;
  }

  private labelsMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k, i) => k === keysB[i] && a[k] === b[k]);
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, metrics] of this.counters) {
      lines.push(`# HELP ${name} Counter metric`);
      lines.push(`# TYPE ${name} counter`);
      for (const m of metrics) {
        const labelStr = Object.entries(m.labels).map(([k, v]) => `${k}="${v}"`).join(',');
        lines.push(`${name}{${labelStr}} ${m.value}`);
      }
    }

    // Histograms
    for (const [name, metrics] of this.histograms) {
      lines.push(`# HELP ${name} Histogram metric`);
      lines.push(`# TYPE ${name} histogram`);
      for (const m of metrics) {
        const labelStr = Object.entries(m.labels).map(([k, v]) => `${k}="${v}"`).join(',');
        for (const [bucket, count] of Object.entries(m.buckets)) {
          lines.push(`${name}_bucket{${labelStr},le="${bucket}"} ${count}`);
        }
        lines.push(`${name}_bucket{${labelStr},le="+Inf"} ${m.count}`);
        lines.push(`${name}_sum{${labelStr}} ${m.sum}`);
        lines.push(`${name}_count{${labelStr}} ${m.count}`);
      }
    }

    // Gauges
    for (const [name, value] of this.gauges) {
      lines.push(`# HELP ${name} Gauge metric`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }

    return lines.join('\n');
  }

  getMetrics(): {
    counters: Record<string, MetricCounter[]>;
    histograms: Record<string, MetricHistogram[]>;
    gauges: Record<string, number>;
  } {
    return {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries(this.histograms),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}

// Global registry
const registry = new MetricsRegistry();

// Metric names
const METRICS = {
  // Intent processing
  INTENTS_RECEIVED: 'oif_intents_received_total',
  INTENTS_EVALUATED: 'oif_intents_evaluated_total',
  INTENTS_FILLED: 'oif_intents_filled_total',
  INTENTS_SKIPPED: 'oif_intents_skipped_total',
  
  // Fill performance
  FILL_DURATION_SECONDS: 'oif_fill_duration_seconds',
  FILL_GAS_USED: 'oif_fill_gas_used',
  
  // Settlements
  SETTLEMENTS_PENDING: 'oif_settlements_pending',
  SETTLEMENTS_CLAIMED: 'oif_settlements_claimed_total',
  SETTLEMENTS_FAILED: 'oif_settlements_failed_total',
  
  // Profit
  SOLVER_PROFIT_WEI: 'oif_solver_profit_wei_total',
  
  // Liquidity
  LIQUIDITY_AVAILABLE: 'oif_liquidity_available_wei',
} as const;

// Duration buckets in seconds
const DURATION_BUCKETS = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120];

// Helper functions
export function recordIntentReceived(chainId: number): void {
  registry.incrementCounter(METRICS.INTENTS_RECEIVED, { chain: chainId.toString() });
}

export function recordIntentEvaluated(chainId: number, profitable: boolean): void {
  registry.incrementCounter(METRICS.INTENTS_EVALUATED, { 
    chain: chainId.toString(), 
    profitable: profitable.toString() 
  });
}

export function recordIntentFilled(sourceChain: number, destChain: number, durationMs: number, gasUsed: bigint): void {
  registry.incrementCounter(METRICS.INTENTS_FILLED, { 
    source_chain: sourceChain.toString(),
    dest_chain: destChain.toString()
  });
  registry.observeHistogram(
    METRICS.FILL_DURATION_SECONDS, 
    { source_chain: sourceChain.toString(), dest_chain: destChain.toString() },
    durationMs / 1000,
    DURATION_BUCKETS
  );
  registry.incrementCounter(METRICS.FILL_GAS_USED, {
    chain: destChain.toString()
  }, Number(gasUsed));
}

export function recordIntentSkipped(chainId: number, reason: string): void {
  registry.incrementCounter(METRICS.INTENTS_SKIPPED, { 
    chain: chainId.toString(),
    reason
  });
}

export function recordSettlementClaimed(chainId: number, amountWei: bigint): void {
  registry.incrementCounter(METRICS.SETTLEMENTS_CLAIMED, { chain: chainId.toString() });
  registry.incrementCounter(METRICS.SOLVER_PROFIT_WEI, { chain: chainId.toString() }, Number(amountWei));
}

export function recordSettlementFailed(chainId: number, reason: string): void {
  registry.incrementCounter(METRICS.SETTLEMENTS_FAILED, { chain: chainId.toString(), reason });
}

export function updatePendingSettlements(count: number): void {
  registry.setGauge(METRICS.SETTLEMENTS_PENDING, count);
}

export function updateLiquidity(chainId: number, _token: string, amountWei: bigint): void {
  // Gauge keys are simple strings - use chain-specific gauge name
  registry.setGauge(`${METRICS.LIQUIDITY_AVAILABLE}_${chainId}`, Number(amountWei));
}

// Get metrics in Prometheus format
export function getPrometheusMetrics(): string {
  return registry.toPrometheusFormat();
}

// Get metrics as JSON (for API)
export function getMetricsJson(): ReturnType<MetricsRegistry['getMetrics']> {
  return registry.getMetrics();
}

// Export registry for testing
export const metricsRegistry = registry;
