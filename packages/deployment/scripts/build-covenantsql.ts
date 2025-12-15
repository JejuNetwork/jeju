#!/usr/bin/env bun
/**
 * Build and push multi-arch CovenantSQL Docker image
 *
 * Usage:
 *   bun run scripts/build-covenantsql.ts              # Build locally
 *   bun run scripts/build-covenantsql.ts --push       # Build and push to ECR
 *   bun run scripts/build-covenantsql.ts --arm-only   # Build ARM64 only
 *   bun run scripts/build-covenantsql.ts --x86-only   # Build x86_64 only
 */

import { $ } from "bun";
import { join } from "path";

const PUSH = process.argv.includes("--push");
const ARM_ONLY = process.argv.includes("--arm-only");
const X86_ONLY = process.argv.includes("--x86-only");
const NETWORK = process.env.NETWORK || "testnet";

const SCRIPT_DIR = import.meta.dir;
const DOCKER_DIR = join(SCRIPT_DIR, "../docker/covenantsql");

function getPlatforms(): string {
  if (ARM_ONLY) return "linux/arm64";
  if (X86_ONLY) return "linux/amd64";
  return "linux/amd64,linux/arm64";
}

async function getEcrRegistry(): Promise<string> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = await $`aws sts get-caller-identity --query Account --output text`
    .text()
    .then((s) => s.trim());
  return `${accountId}.dkr.ecr.${region}.amazonaws.com`;
}

async function setupBuildx(): Promise<string> {
  console.log("🔧 Setting up Docker buildx...\n");

  const platforms = getPlatforms();
  const requiredPlatforms = platforms.split(",");

  // List current builders and find one that supports our platforms
  const buildersOutput = await $`docker buildx ls`.text();
  const lines = buildersOutput.split("\n");

  // Check if desktop-linux or default supports our platforms (preferred for stability)
  for (const preferredBuilder of ["desktop-linux", "default"]) {
    for (const line of lines) {
      if (line.startsWith(preferredBuilder) || line.includes(`\\_ ${preferredBuilder}`)) {
        // Check platform support by looking at the line
        const hasAllPlatforms = requiredPlatforms.every(
          (p) => buildersOutput.includes(p.replace("linux/", ""))
        );
        if (hasAllPlatforms) {
          console.log(`   Using builder: ${preferredBuilder}\n`);
          await $`docker buildx use ${preferredBuilder}`.quiet().nothrow();
          return preferredBuilder;
        }
      }
    }
  }

  // Fall back to creating jeju-multiarch builder
  const hasJejuBuilder = buildersOutput.includes("jeju-multiarch");

  if (hasJejuBuilder) {
    // Remove stale builder and recreate
    console.log("   Removing stale jeju-multiarch builder...\n");
    await $`docker buildx rm jeju-multiarch`.quiet().nothrow();
  }

  console.log("   Creating jeju-multiarch builder...\n");
  await $`docker buildx create --name jeju-multiarch --driver docker-container --bootstrap`;
  await $`docker buildx use jeju-multiarch`;
  return "jeju-multiarch";
}

async function main() {
  console.log("🐳 Building CovenantSQL multi-arch image\n");
  console.log(`   Platforms: ${getPlatforms()}`);
  console.log(`   Push: ${PUSH}`);
  console.log(`   Network: ${NETWORK}\n`);

  const builder = await setupBuildx();
  console.log(`   Builder: ${builder}\n`);

  const gitHash = await $`git rev-parse --short HEAD`
    .text()
    .then((s) => s.trim())
    .catch(() => "latest");
  const tag = `${NETWORK}-${gitHash}`;

  let imageName = "jeju/covenantsql";
  if (PUSH) {
    const registry = await getEcrRegistry();
    console.log(`📦 ECR Registry: ${registry}\n`);

    // Login to ECR
    const region = process.env.AWS_REGION || "us-east-1";
    await $`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`;

    imageName = `${registry}/jeju/covenantsql`;
  }

  const fullTag = `${imageName}:${tag}`;
  const latestTag = `${imageName}:${NETWORK}-latest`;

  console.log(`🔨 Building ${fullTag}...\n`);

  const buildPlatforms = getPlatforms();
  const isMultiPlatform = buildPlatforms.includes(",");

  const buildArgs = [
    "docker",
    "buildx",
    "build",
    "--platform",
    buildPlatforms,
    "-t",
    fullTag,
    "-t",
    latestTag,
    "-f",
    join(DOCKER_DIR, "Dockerfile"),
  ];

  if (PUSH) {
    buildArgs.push("--push");
  } else if (!isMultiPlatform) {
    // Can only --load single platform images
    buildArgs.push("--load");
  }
  // For local multi-platform builds, we just build without loading
  // (validates the build but doesn't save locally)

  buildArgs.push(DOCKER_DIR);

  const result = await $`${buildArgs}`.nothrow();

  if (result.exitCode !== 0) {
    console.error("❌ Build failed");
    process.exit(1);
  }

  console.log(`\n✅ CovenantSQL image built successfully`);
  console.log(`   Tag: ${fullTag}`);
  console.log(`   Latest: ${latestTag}`);

  if (PUSH) {
    console.log(`\n📤 Image pushed to ECR`);
  } else if (isMultiPlatform) {
    console.log(`\n⚠️  Multi-platform build complete (not loaded locally)`);
    console.log(`   Use --push to push to ECR, or --arm-only/--x86-only to load locally`);
  } else {
    console.log(`\n💡 Image loaded locally. Use --push to push to ECR`);
  }
}

main();
