#!/usr/bin/env bun

/**
 * Sync Prometheus Alerts
 * 
 * Uploads Prometheus alert rules to a Kubernetes ConfigMap.
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
  sourceDir: join(process.cwd(), "monitoring", "prometheus", "alerts"),
  filePattern: ".yaml",
  configMapName: "prometheus-rules",
  namespace: values.namespace ?? "monitoring",
  label: "🚨 Prometheus Alerts",
});

console.log("\n💡 Note: Your Prometheus instance must be configured to load rules from this ConfigMap.");
