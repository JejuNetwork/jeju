#!/usr/bin/env bun

/**
 * Sync Grafana Dashboards
 * 
 * Uploads Grafana dashboards to a Kubernetes ConfigMap
 * 
 * Usage:
 *   bun run scripts/monitoring/sync-dashboards.ts --namespace monitoring
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

console.log(`📊 Syncing Grafana Dashboards to Kubernetes namespace: ${namespace}...\n`);

const dashboardsDir = join(process.cwd(), "monitoring", "grafana", "dashboards");
const dashboards = readdirSync(dashboardsDir).filter(f => f.endsWith('.json'));

if (dashboards.length === 0) {
  console.log("No dashboard files found. Exiting.");
  process.exit(0);
}

console.log(`Found ${dashboards.length} dashboards:\n`);
for (const dashboard of dashboards) {
  console.log(`  - ${dashboard}`);
}

const configMapName = "grafana-dashboards";
const fromFileArgs = dashboards.map(file => `--from-file=${join(dashboardsDir, file)}`);

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

console.log("\n✅ Grafana dashboards synced successfully!");
console.log(`\n🔍 Verify with: kubectl get configmap ${configMapName} -n ${namespace} -o yaml`);
console.log("\n💡 Note: Your Grafana instance must be configured to load dashboards from this ConfigMap.");
console.log("   This is often done by mounting the ConfigMap as a volume and configuring a dashboard provider.");


