import { PipelineConfig } from "../src/lib/pipelines/pipelineConfig";

const openrouterApiKey = process.env.OPENROUTER_API_KEY;
if (!openrouterApiKey) {
  console.warn("OPENROUTER_API_KEY is not set");
}

/**
 * Contributor Analytics Pipeline Configuration
 */
export default {
  contributionStartDate: "2024-10-15",

  repositories: [
    { owner: "jejunetwork", name: "jeju", defaultBranch: "main" },
  ],

  walletAddresses: { enabled: true },

  botUsers: [
    "dependabot", "dependabot-preview", "renovate", "renovate-bot", "renovate[bot]",
    "github-actions", "github-actions[bot]", "github-bot", "codecov", "codecov-io",
    "stale[bot]", "semantic-release-bot", "copilot-pull-request-reviewer",
    "imgbot", "coderabbitai", "codefactor-io", "graphite-app",
    "google-labs-jules[bot]", "cursor", "claude",
  ],

  scoring: {
    pullRequest: {
      base: 4,
      merged: 16,
      perReview: 1.5,
      perApproval: 2,
      perComment: 0.2,
      descriptionMultiplier: 0.003,
      complexityMultiplier: 0.5,
      optimalSizeBonus: 5,
      maxPerDay: 10,
      closingIssueBonus: 5,
    },

    reaction: {
      diminishingReturns: 0.7,
      base: 0.5,
      received: 0.1,
      maxPerDay: 10,
      types: {
        thumbs_up: 1.2, thumbs_down: 0.5, laugh: 1.0, hooray: 1.5,
        confused: 0.5, heart: 1.5, rocket: 1.5, eyes: 1.2,
      },
    },

    issue: {
      base: 2,
      perComment: 0.1,
      withLabelsMultiplier: { bug: 1.8, enhancement: 1.4, documentation: 1.0 },
      closedBonus: 2,
      resolutionSpeedMultiplier: 1.0,
    },

    review: {
      base: 4,
      approved: 1,
      changesRequested: 2,
      commented: 0.5,
      detailedFeedbackMultiplier: 0.002,
      thoroughnessMultiplier: 1.3,
      maxPerDay: 8,
    },

    comment: {
      base: 0.2,
      substantiveMultiplier: 0.001,
      diminishingReturns: 0.7,
      maxPerThread: 3,
    },

    codeChange: {
      perLineAddition: 0.005,
      perLineDeletion: 0.01,
      perFile: 0.15,
      maxLines: 800,
      testCoverageBonus: 2.0,
    },
  },

  tags: {
    area: [
      { name: "core", category: "AREA", patterns: ["core/", "src/core", "packages/core"], weight: 2.5, description: "Core system components" },
      { name: "ui", category: "AREA", patterns: ["components/", "ui/", "src/components", "pages/"], weight: 1.8, description: "User interface" },
      { name: "docs", category: "AREA", patterns: ["docs/", "README", ".md"], weight: 1.5, description: "Documentation" },
      { name: "infra", category: "AREA", patterns: [".github/", "docker", "k8s", ".yml", ".yaml"], weight: 1.8, description: "Infrastructure" },
      { name: "tests", category: "AREA", patterns: ["test/", "tests/", ".spec.", ".test."], weight: 2.0, description: "Tests" },
    ],

    role: [
      { name: "architect", category: "ROLE", patterns: ["feat:", "refactor:", "breaking:"], weight: 2.5, description: "Architects features" },
      { name: "maintainer", category: "ROLE", patterns: ["fix:", "chore:", "bump:", "update:"], weight: 2.0, description: "Maintains codebase" },
      { name: "feature-dev", category: "ROLE", patterns: ["feat:", "feature:", "add:"], weight: 2.0, description: "Develops features" },
      { name: "bug-fixer", category: "ROLE", patterns: ["fix:", "bug:", "hotfix:"], weight: 2.2, description: "Fixes bugs" },
      { name: "docs-writer", category: "ROLE", patterns: ["docs:", "documentation:"], weight: 1.2, description: "Writes documentation" },
      { name: "reviewer", category: "ROLE", patterns: ["review:", "feedback:"], weight: 1.8, description: "Reviews code" },
      { name: "devops", category: "ROLE", patterns: ["ci:", "cd:", "deploy:", "build:"], weight: 2.2, description: "DevOps work" },
    ],

    tech: [
      { name: "typescript", category: "TECH", patterns: [".ts", ".tsx", "tsconfig"], weight: 1.5, description: "TypeScript" },
      { name: "react", category: "TECH", patterns: ["react", ".jsx", ".tsx", "component"], weight: 1.4, description: "React" },
      { name: "nextjs", category: "TECH", patterns: ["next.", "nextjs", "pages/", "app/"], weight: 1.6, description: "Next.js" },
      { name: "tailwind", category: "TECH", patterns: ["tailwind", "tw-", "className"], weight: 1.2, description: "Tailwind CSS" },
      { name: "database", category: "TECH", patterns: ["sql", "db", "database", "query", "schema"], weight: 1.7, description: "Database" },
      { name: "api", category: "TECH", patterns: ["api", "rest", "graphql", "endpoint"], weight: 1.6, description: "API" },
    ],
  },

  aiSummary: {
    enabled: true,
    defaultModel: "google/gemini-2.0-flash-001",
    models: {
      day: process.env.SMALL_MODEL || "google/gemini-2.5-flash",
      week: process.env.LARGE_MODEL || "google/gemini-2.5-pro",
      month: process.env.LARGE_MODEL || "google/gemini-2.5-pro",
    },
    temperature: 0.1,
    max_tokens: 2000,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: openrouterApiKey || "",
    projectContext: `Jeju Network builds decentralized blockchain infrastructure for Web3 applications, focusing on scalability, security, and developer experience.`,
  },
} as const satisfies PipelineConfig;
