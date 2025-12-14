/**
 * Oracle Network Node
 * Registers as operator, fetches prices, submits reports, exposes Prometheus metrics
 */

import { OracleNode, createNodeConfig } from './node';
import { MetricsExporter } from './metrics';

export { OracleNode, createNodeConfig } from './node';
export { PriceFetcher } from './price-fetcher';
export { MetricsExporter } from './metrics';
export * from './types';
export * from './abis';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const USAGE = `
Required environment variables:
  FEED_REGISTRY_ADDRESS      - FeedRegistry contract address
  REPORT_VERIFIER_ADDRESS    - ReportVerifier contract address
  COMMITTEE_MANAGER_ADDRESS  - CommitteeManager contract address
  NETWORK_CONNECTOR_ADDRESS  - OracleNetworkConnector address
  OPERATOR_PRIVATE_KEY       - Operator account private key
  WORKER_PRIVATE_KEY         - Worker key for signing reports
  RPC_URL                    - RPC endpoint URL

Optional:
  POLL_INTERVAL_MS           - Price polling interval (default: 60000)
  HEARTBEAT_INTERVAL_MS      - Heartbeat interval (default: 300000)
  METRICS_PORT               - Prometheus metrics port (default: 9090)
`;

async function main(): Promise<void> {
  console.log('Oracle Network Node v0.1.0\n');

  const config = createNodeConfig();

  if (config.feedRegistry === ZERO_ADDRESS) {
    console.error('ERROR: FEED_REGISTRY_ADDRESS not set\n' + USAGE);
    process.exit(1);
  }

  console.log(`RPC: ${config.rpcUrl} | Chain: ${config.chainId}`);
  console.log(`Contracts: Registry=${config.feedRegistry.slice(0, 10)}...`);
  console.log(`Intervals: Poll=${config.pollIntervalMs}ms, Heartbeat=${config.heartbeatIntervalMs}ms\n`);

  const node = new OracleNode(config);
  const metricsExporter = new MetricsExporter(config);

  const metricsUpdateInterval = setInterval(() => {
    metricsExporter.setNodeMetrics(node.getMetrics());
  }, 5000);

  const shutdown = async () => {
    console.log('\nShutting down...');
    clearInterval(metricsUpdateInterval);
    await node.stop();
    metricsExporter.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await metricsExporter.start();
  await node.start();

  console.log(`\nRunning! Metrics at http://localhost:${config.metricsPort}/metrics`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

