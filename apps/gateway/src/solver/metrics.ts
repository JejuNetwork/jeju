/**
 * Prometheus Metrics using prom-client
 * Replaces custom implementation with battle-tested library
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register: metricsRegistry });

// Define metric names
const METRICS = {
  INTENTS_RECEIVED: 'oif_intents_received_total',
  INTENTS_EVALUATED: 'oif_intents_evaluated_total',
  INTENTS_FILLED: 'oif_intents_filled_total',
  INTENTS_SKIPPED: 'oif_intents_skipped_total',
  FILL_DURATION_SECONDS: 'oif_fill_duration_seconds',
  FILL_GAS_USED: 'oif_fill_gas_used',
  SETTLEMENTS_PENDING: 'oif_settlements_pending',
  SETTLEMENTS_CLAIMED: 'oif_settlements_claimed_total',
  SETTLEMENTS_FAILED: 'oif_settlements_failed_total',
  SOLVER_PROFIT_WEI: 'oif_solver_profit_wei_total',
  LIQUIDITY_AVAILABLE: 'oif_liquidity_available_wei',
} as const;

// Counters
const intentsReceivedCounter = new Counter({
  name: METRICS.INTENTS_RECEIVED,
  help: 'Total number of intents received',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

const intentsEvaluatedCounter = new Counter({
  name: METRICS.INTENTS_EVALUATED,
  help: 'Total number of intents evaluated',
  labelNames: ['chain', 'profitable'],
  registers: [metricsRegistry],
});

const intentsFilledCounter = new Counter({
  name: METRICS.INTENTS_FILLED,
  help: 'Total number of intents filled',
  labelNames: ['source_chain', 'dest_chain'],
  registers: [metricsRegistry],
});

const intentsSkippedCounter = new Counter({
  name: METRICS.INTENTS_SKIPPED,
  help: 'Total number of intents skipped',
  labelNames: ['chain', 'reason'],
  registers: [metricsRegistry],
});

const fillGasUsedCounter = new Counter({
  name: METRICS.FILL_GAS_USED,
  help: 'Total gas used for fills',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

const settlementsClaimedCounter = new Counter({
  name: METRICS.SETTLEMENTS_CLAIMED,
  help: 'Total number of settlements claimed',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

const settlementsFailedCounter = new Counter({
  name: METRICS.SETTLEMENTS_FAILED,
  help: 'Total number of settlements failed',
  labelNames: ['chain', 'reason'],
  registers: [metricsRegistry],
});

const solverProfitCounter = new Counter({
  name: METRICS.SOLVER_PROFIT_WEI,
  help: 'Total solver profit in wei',
  labelNames: ['chain'],
  registers: [metricsRegistry],
});

// Histogram for fill duration
const fillDurationHistogram = new Histogram({
  name: METRICS.FILL_DURATION_SECONDS,
  help: 'Duration of intent fills in seconds',
  labelNames: ['source_chain', 'dest_chain'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

// Gauges
const settlementsPendingGauge = new Gauge({
  name: METRICS.SETTLEMENTS_PENDING,
  help: 'Number of pending settlements',
  registers: [metricsRegistry],
});

const liquidityGauges = new Map<number, Gauge<string>>();

function getLiquidityGauge(chainId: number): Gauge<string> {
  if (!liquidityGauges.has(chainId)) {
    const gauge = new Gauge({
      name: `${METRICS.LIQUIDITY_AVAILABLE}_${chainId}`,
      help: `Available liquidity in wei for chain ${chainId}`,
      registers: [metricsRegistry],
    });
    liquidityGauges.set(chainId, gauge);
  }
  return liquidityGauges.get(chainId)!;
}

// Export metric recording functions
export function recordIntentReceived(chainId: number): void {
  intentsReceivedCounter.inc({ chain: chainId.toString() });
}

export function recordIntentEvaluated(chainId: number, profitable: boolean): void {
  intentsEvaluatedCounter.inc({ 
    chain: chainId.toString(), 
    profitable: profitable.toString() 
  });
}

export function recordIntentFilled(sourceChain: number, destChain: number, durationMs: number, gasUsed: bigint): void {
  intentsFilledCounter.inc({ 
    source_chain: sourceChain.toString(),
    dest_chain: destChain.toString()
  });
  fillDurationHistogram.observe(
    { source_chain: sourceChain.toString(), dest_chain: destChain.toString() },
    durationMs / 1000
  );
  fillGasUsedCounter.inc({ chain: destChain.toString() }, Number(gasUsed));
}

export function recordIntentSkipped(chainId: number, reason: string): void {
  intentsSkippedCounter.inc({ 
    chain: chainId.toString(),
    reason
  });
}

export function recordSettlementClaimed(chainId: number, amountWei: bigint): void {
  settlementsClaimedCounter.inc({ chain: chainId.toString() });
  solverProfitCounter.inc({ chain: chainId.toString() }, Number(amountWei));
}

export function recordSettlementFailed(chainId: number, reason: string): void {
  settlementsFailedCounter.inc({ chain: chainId.toString(), reason });
}

export function updatePendingSettlements(count: number): void {
  settlementsPendingGauge.set(count);
}

export function updateLiquidity(chainId: number, _token: string, amountWei: bigint): void {
  getLiquidityGauge(chainId).set(Number(amountWei));
}

export async function getPrometheusMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

export async function getMetricsJson(): Promise<Record<string, unknown>> {
  const metrics = await metricsRegistry.getMetricsAsJSON();
  return { metrics };
}
