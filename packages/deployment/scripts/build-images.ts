#!/usr/bin/env bun
/**
 * Build and push Docker images to ECR
 * 
 * Usage:
 *   NETWORK=testnet bun run scripts/build-images.ts
 *   NETWORK=testnet bun run scripts/build-images.ts --push
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

const NETWORK = process.env.NETWORK || "testnet";
const PUSH = process.argv.includes("--push");
const PROJECT_ROOT = join(import.meta.dir, "../../..");

const APPS: Record<string, { dockerfile: string; context: string }> = {
  bazaar: { dockerfile: "apps/bazaar/Dockerfile", context: "apps/bazaar" },
  gateway: { dockerfile: "apps/gateway/Dockerfile", context: "apps/gateway" },
  leaderboard: { dockerfile: "apps/leaderboard/Dockerfile", context: "apps/leaderboard" },
  ipfs: { dockerfile: "apps/ipfs/Dockerfile", context: "apps/ipfs" },
  documentation: { dockerfile: "apps/documentation/Dockerfile", context: "." },
  indexer: { dockerfile: "apps/indexer/Dockerfile.k8s", context: "apps/indexer" }
};

async function getEcrRegistry(): Promise<string> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = await $`aws sts get-caller-identity --query Account --output text`.text();
  return `${accountId.trim()}.dkr.ecr.${region}.amazonaws.com`;
}

async function main() {
  console.log(`🐳 Building Docker images for ${NETWORK}\n`);

  const gitHash = await $`git rev-parse --short HEAD`.text().then(s => s.trim()).catch(() => "latest");
  const tag = `${NETWORK}-${gitHash}`;

  let registry = "";
  if (PUSH) {
    registry = await getEcrRegistry();
    console.log(`📦 ECR Registry: ${registry}\n`);
    
    // Login to ECR
    await $`aws ecr get-login-password --region ${process.env.AWS_REGION || "us-east-1"} | docker login --username AWS --password-stdin ${registry}`;
  }

  for (const [app, config] of Object.entries(APPS)) {
    const dockerfilePath = join(PROJECT_ROOT, config.dockerfile);
    
    if (!existsSync(dockerfilePath)) {
      console.log(`⏭️  Skipping ${app} (no Dockerfile)`);
      continue;
    }

    console.log(`\n🔨 Building ${app}...`);
    
    const imageName = PUSH ? `${registry}/jeju/${app}` : `jeju/${app}`;
    const fullTag = `${imageName}:${tag}`;
    const latestTag = `${imageName}:${NETWORK}-latest`;

    const buildResult = await $`docker build \
      -f ${dockerfilePath} \
      -t ${fullTag} \
      -t ${latestTag} \
      --platform linux/amd64 \
      --build-arg ENVIRONMENT=${NETWORK} \
      ${join(PROJECT_ROOT, config.context)}`.nothrow();

    if (buildResult.exitCode !== 0) {
      console.error(`❌ Build failed for ${app}`);
      process.exit(1);
    }

    if (PUSH) {
      console.log(`   Pushing ${app}...`);
      await $`docker push ${fullTag}`;
      await $`docker push ${latestTag}`;
    }

    console.log(`   ✅ ${app}`);
  }

  console.log(`\n✅ All images built${PUSH ? " and pushed" : ""}\n`);
}

main();

