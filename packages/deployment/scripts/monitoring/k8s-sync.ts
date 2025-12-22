#!/usr/bin/env bun

/**
 * Kubernetes ConfigMap Sync Utility
 * 
 * Shared utility for syncing files to Kubernetes ConfigMaps.
 */

import { $ } from "bun";
import { readdirSync } from "fs";
import { join } from "path";

interface SyncConfig {
  sourceDir: string;
  filePattern: string;
  configMapName: string;
  namespace: string;
  label: string;
}

export async function syncToConfigMap(config: SyncConfig): Promise<void> {
  const { sourceDir, filePattern, configMapName, namespace, label } = config;

  console.log(`${label} Syncing to Kubernetes namespace: ${namespace}...\n`);

  const files = readdirSync(sourceDir).filter(f => f.endsWith(filePattern));

  if (files.length === 0) {
    console.log("No files found. Exiting.");
    process.exit(0);
  }

  console.log(`Found ${files.length} files:\n`);
  for (const file of files) {
    console.log(`  - ${file}`);
  }

  const fromFileArgs = files.map(file => `--from-file=${join(sourceDir, file)}`);

  console.log(`\n📝 Creating/updating ConfigMap '${configMapName}' in namespace '${namespace}'...`);

  const createResult = await $`kubectl create configmap ${configMapName} -n ${namespace} ${fromFileArgs}`.nothrow();

  if (createResult.exitCode !== 0) {
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

  console.log(`\n✅ ${label} synced successfully!`);
  console.log(`\n🔍 Verify with: kubectl get configmap ${configMapName} -n ${namespace} -o yaml`);
}
