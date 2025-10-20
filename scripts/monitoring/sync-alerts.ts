#!/usr/bin/env bun

/**
 * Sync Prometheus Alerts
 * 
 * Uploads Prometheus alert rules to Kubernetes ConfigMap
 * 
 * Usage:
 *   bun run scripts/monitoring/sync-alerts.ts --namespace monitoring
 */

import { $ } from "bun";
import { readdirSync } from "fs";
import { join } from "path";
import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    namespace: { type: "string", default: "monitoring" }
  }
});

const namespace = values.namespace;

console.log(`🚨 Syncing Prometheus Alerts to Kubernetes namespace: ${namespace}...\n`);

const alertsDir = join(process.cwd(), "monitoring", "prometheus", "alerts");
const alerts = readdirSync(alertsDir).filter(f => f.endsWith('.yaml'));

if (alerts.length === 0) {
  console.log("No alert files found. Exiting.");
  process.exit(0);
}

console.log(`Found ${alerts.length} alert rule files:\n`);
for (const alert of alerts) {
  console.log(`  - ${alert}`);
}

const configMapName = "prometheus-rules";
const fromFileArgs = alerts.map(file => `--from-file=${join(alertsDir, file)}`);

console.log(`\n📝 Creating/updating ConfigMap '${configMapName}' in namespace '${namespace}'...`);

// First, try to create the configmap. If it already exists, this will fail.
const createResult = await $`kubectl create configmap ${configMapName} -n ${namespace} ${fromFileArgs}`.nothrow();

if (createResult.exitCode !== 0) {
  // If creation failed, it might be because it already exists. Try replacing it.
  console.log(`   ConfigMap might already exist. Attempting to recreate...`);
  
  const deleteResult = await $`kubectl delete configmap ${configMapName} -n ${namespace} --ignore-not-found`.nothrow();
  if (deleteResult.exitCode !== 0) {
    console.error("\n❌ Failed to delete existing ConfigMap!");
    console.error(deleteResult.stderr.toString());
    process.exit(1);
  }

  const recreateResult = await $`kubectl create configmap ${configMapName} -n ${namespace} ${fromFileArgs}`.nothrow();
  if (recreateResult.exitCode !== 0) {
    console.error("\n❌ Failed to recreate ConfigMap!");
    console.error(recreateResult.stderr.toString());
    process.exit(1);
  }
}

console.log("\n✅ Prometheus alerts synced successfully!");
console.log(`\n🔍 Verify with: kubectl get configmap ${configMapName} -n ${namespace} -o yaml`);
console.log("\n💡 Note: Your Prometheus instance must be configured to load rules from this ConfigMap.");


