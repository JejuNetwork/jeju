import { type TestSuite } from '@elizaos/core';
import basicFunctionalityTestSuite from './basic-functionality.test';
import codeGenerationE2ETestSuite from './code-generation.test';
import claudeCodeIntegrationTestSuite from './claude-code-integration.test';
import claudeCodeStressTestSuite from './claude-code-stress-test';

// Export all E2E test suites for the plugin
export const testSuites: TestSuite[] = [
  basicFunctionalityTestSuite,
  codeGenerationE2ETestSuite,
  claudeCodeIntegrationTestSuite,
  claudeCodeStressTestSuite,
];

export default testSuites;
