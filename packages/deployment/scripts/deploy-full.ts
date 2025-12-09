#!/usr/bin/env bun
/**
 * Full deployment pipeline for testnet/mainnet
 * 
 * Steps:
 * 1. Validate configurations
 * 2. Deploy infrastructure (Terraform)
 * 3. Build and push Docker images
 * 4. Deploy to Kubernetes (Helmfile)
 * 5. Verify deployment
 * 
 * Usage:
 *   NETWORK=testnet bun run scripts/deploy-full.ts
 *   NETWORK=mainnet bun run scripts/deploy-full.ts
 */

import { $ } from "bun";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const NETWORK = process.env.NETWORK || "testnet";

const STEPS = {
  VALIDATE: process.env.SKIP_VALIDATE !== "true",
  TERRAFORM: process.env.SKIP_TERRAFORM !== "true",
  IMAGES: process.env.SKIP_IMAGES !== "true",
  KUBERNETES: process.env.SKIP_KUBERNETES !== "true",
  VERIFY: process.env.SKIP_VERIFY !== "true"
};

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`📋 ${name}`);
  console.log("━".repeat(60) + "\n");
  await fn();
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 JEJU ${NETWORK.toUpperCase()} DEPLOYMENT                              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  if (NETWORK === "mainnet") {
    console.log("⚠️  MAINNET DEPLOYMENT - Proceeding with extra caution\n");
  }

  const startTime = Date.now();

  // Step 1: Validate
  if (STEPS.VALIDATE) {
    await step("Validating configurations", async () => {
      const result = await $`bun run ${join(ROOT, "scripts/validate.ts")}`.nothrow();
      if (result.exitCode !== 0) throw new Error("Validation failed");
    });
  }

  // Step 2: Terraform
  if (STEPS.TERRAFORM) {
    await step("Deploying infrastructure", async () => {
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, "scripts/terraform.ts")} plan`;
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, "scripts/terraform.ts")} apply`;
    });
  }

  // Step 3: Docker images
  if (STEPS.IMAGES) {
    await step("Building and pushing Docker images", async () => {
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, "scripts/build-images.ts")} --push`;
    });
  }

  // Step 4: Kubernetes
  if (STEPS.KUBERNETES) {
    await step("Deploying to Kubernetes", async () => {
      await $`NETWORK=${NETWORK} bun run ${join(ROOT, "scripts/helmfile.ts")} sync`;
    });
  }

  // Step 5: Verify
  if (STEPS.VERIFY) {
    await step("Verifying deployment", async () => {
      // Add health checks here
      console.log("Running health checks...");
      await $`kubectl get pods -n jeju-apps`.nothrow();
    });
  }

  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ✅ DEPLOYMENT COMPLETE                                      ║
║   Network: ${NETWORK.padEnd(47)}║
║   Duration: ${(duration + "s").padEnd(45)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main().catch(err => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});

