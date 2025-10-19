import type { Plugin } from '@elizaos/core';
import { CodeGenerationService } from './services/CodeGenerationService';
import { SecretsManagerService } from './services/SecretsManagerService';
import { ProjectPlanningService } from './services/ProjectPlanningService';
import { ProjectStatusManager } from './services/ProjectStatusManager';
import { generateCodeAction } from './actions/generate-code';
import { createProjectAction } from './actions/create-project';
import { projectsProvider } from './providers/projects-provider';
import { currentProjectProvider } from './providers/current-project-provider';
import testSuites from './__tests__/e2e/index';

// Export types
export * from './types/index';

// Export services
export { CodeGenerationService } from './services/CodeGenerationService';
export { ProjectPlanningService } from './services/ProjectPlanningService';
export { SecretsManagerService } from './services/SecretsManagerService';
export { ProjectStatusManager } from './services/ProjectStatusManager';

// Export actions
export { generateCodeAction } from './actions/generate-code';
export { createProjectAction } from './actions/create-project';

// Export providers
export { projectsProvider } from './providers/projects-provider';
export { currentProjectProvider } from './providers/current-project-provider';

/**
 * AutoCoder Plugin for ElizaOS
 *
 * Advanced code generation system using Claude Code in E2B sandboxes.
 * Supports creating plugins, agents, workflows, MCP servers, and full-stack apps.
 *
 * Features:
 * - Claude Code integration for intelligent code generation
 * - E2B sandboxed execution environments
 * - Multi-step project planning with forms
 * - Automated QA with linting, type checking, and testing
 * - GitHub repository creation and deployment
 * - API key and secrets management
 * - Real-time code generation with quality assurance
 */
export const autocoderPlugin: Plugin = {
  name: '@elizaos/plugin-autocoder',
  description:
    'Advanced code generation plugin that enables autonomous plugin development. Searches registry, generates PRDs, and creates working plugins with validation.',

  services: [
    CodeGenerationService,
    ProjectPlanningService,
    SecretsManagerService,
    ProjectStatusManager,
  ],
  actions: [generateCodeAction, createProjectAction],
  providers: [projectsProvider, currentProjectProvider],

  // Dependencies - required for functionality
  dependencies: ['@elizaos/plugin-forms', '@elizaos/plugin-plugin-manager'],
  testDependencies: ['@elizaos/plugin-forms'],

  // E2E Test Suites - Real runtime integration tests
  tests: testSuites,
};

// Default export
export default autocoderPlugin;
