#!/usr/bin/env bun
/**
 * Validate all deployment configurations
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

interface ValidationResult {
  name: string;
  passed: boolean;
  message?: string;
}

const results: ValidationResult[] = [];

async function validateTerraform(env: string): Promise<void> {
  const tfDir = join(ROOT, "terraform/environments", env);
  
  if (!existsSync(tfDir)) {
    results.push({ name: `Terraform (${env})`, passed: false, message: "Directory not found" });
    return;
  }

  const init = await $`cd ${tfDir} && terraform init -backend=false`.quiet().nothrow();
  if (init.exitCode !== 0) {
    results.push({ name: `Terraform init (${env})`, passed: false, message: "Init failed" });
    return;
  }

  const validate = await $`cd ${tfDir} && terraform validate`.quiet().nothrow();
  results.push({
    name: `Terraform (${env})`,
    passed: validate.exitCode === 0,
    message: validate.exitCode !== 0 ? "Validation failed" : undefined
  });
}

async function validateHelm(): Promise<void> {
  const helmDir = join(ROOT, "kubernetes/helm");
  // Skip directories that only contain values overrides (no Chart.yaml)
  const result = await $`find ${helmDir} -mindepth 1 -maxdepth 1 -type d ! -name "cert-manager" ! -name "ingress-nginx" -exec helm lint {} \;`.quiet().nothrow();
  
  results.push({
    name: "Helm charts",
    passed: result.exitCode === 0,
    message: result.exitCode !== 0 ? "Lint failed" : undefined
  });
}

async function validateKurtosis(): Promise<void> {
  const kurtosisFile = join(ROOT, "kurtosis/main.star");
  
  if (!existsSync(kurtosisFile)) {
    results.push({ name: "Kurtosis", passed: false, message: "main.star not found" });
    return;
  }

  results.push({ name: "Kurtosis", passed: true });
}

async function main() {
  console.log("🔍 Validating deployment configurations...\n");

  await Promise.all([
    validateTerraform("testnet"),
    validateTerraform("mainnet"),
    validateHelm(),
    validateKurtosis()
  ]);

  console.log("━".repeat(50));
  
  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.name}${result.message ? `: ${result.message}` : ""}`);
    if (!result.passed) allPassed = false;
  }

  console.log("━".repeat(50));
  
  if (allPassed) {
    console.log("\n✅ All validations passed\n");
  } else {
    console.log("\n❌ Some validations failed\n");
    process.exit(1);
  }
}

main();

