/**
 * Subagent Types for Test Analysis and Generation
 */

export interface AppTestingInfo {
  name: string
  path: string
  manifestPath: string
  hasUnitTests: boolean
  hasIntegrationTests: boolean
  hasE2ETests: boolean
  hasSynpressTests: boolean
  hasPlaywrightConfig: boolean
  hasSynpressConfig: boolean
  testDirectories: string[]
  testFiles: TestFileInfo[]
  mocks: MockInfo[]
  coverage: CoverageInfo
  issues: TestIssue[]
}

export interface TestFileInfo {
  path: string
  type: 'unit' | 'integration' | 'e2e' | 'synpress' | 'playwright'
  testCount: number
  hasMocks: boolean
  hasRealChain: boolean
  isSkipped: boolean
}

export interface MockInfo {
  file: string
  line: number
  type: 'jest.mock' | 'vitest.mock' | 'manual' | 'stub' | 'fake'
  target: string
  canBeReplaced: boolean
  replacement?: string
}

export interface CoverageInfo {
  lines: number
  functions: number
  branches: number
  hasReport: boolean
}

export interface TestIssue {
  severity: 'error' | 'warning' | 'info'
  type:
    | 'missing_tests'
    | 'mock_usage'
    | 'no_chain'
    | 'popup_blocker'
    | 'config_missing'
    | 'outdated'
  message: string
  file?: string
  line?: number
  suggestion?: string
}

export interface PageInfo {
  path: string
  route: string
  component: string
  hasTest: boolean
  actions: PageAction[]
  forms: FormInfo[]
  walletInteractions: WalletInteraction[]
}

export interface PageAction {
  name: string
  selector: string
  type: 'click' | 'input' | 'submit' | 'navigate' | 'wallet'
  testCovered: boolean
}

export interface FormInfo {
  name: string
  fields: string[]
  submitAction: string
  validationRules: string[]
  testCovered: boolean
}

export interface WalletInteraction {
  type: 'connect' | 'sign' | 'transaction' | 'switch_network'
  description: string
  testCovered: boolean
}

export interface AnalysisResult {
  timestamp: string
  apps: AppTestingInfo[]
  packages: AppTestingInfo[]
  summary: AnalysisSummary
  recommendations: Recommendation[]
}

export interface AnalysisSummary {
  totalApps: number
  totalPackages: number
  appsWithTests: number
  packagesWithTests: number
  totalTestFiles: number
  totalMocks: number
  mocksReplaceable: number
  totalIssues: number
  issuesByType: Record<string, number>
  coverageAverage: number
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low'
  category: 'coverage' | 'mocks' | 'e2e' | 'cli' | 'ci' | 'infrastructure'
  title: string
  description: string
  affectedApps: string[]
  effort: 'small' | 'medium' | 'large'
  steps: string[]
}

export interface CLIIntegration {
  command: string
  implemented: boolean
  hasTests: boolean
  testFile?: string
  coverage: number
}

export interface SubagentConfig {
  rootDir: string
  targetApp?: string
  verbose?: boolean
  fix?: boolean
  dryRun?: boolean
}

