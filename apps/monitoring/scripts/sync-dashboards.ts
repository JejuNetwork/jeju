#!/usr/bin/env bun

/**
 * Sync Grafana Dashboards
 * 
 * Uploads Grafana dashboards to a Kubernetes ConfigMap.
 */

import { join } from "path";
import { parseArgs } from "util";
import { syncToConfigMap } from "./k8s-sync";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    namespace: { type: "string", default: "monitoring" }
  }
});

await syncToConfigMap({
  sourceDir: join(process.cwd(), "monitoring", "grafana", "dashboards"),
  filePattern: ".json",
  configMapName: "grafana-dashboards",
  namespace: values.namespace ?? "monitoring",
  label: "📊 Grafana Dashboards",
});

console.log("\n💡 Note: Your Grafana instance must be configured to load dashboards from this ConfigMap.");
console.log("   This is often done by mounting the ConfigMap as a volume and configuring a dashboard provider.");
