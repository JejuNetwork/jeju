/**
 * Test Types
 * 
 * Shared types for the test system to avoid circular dependencies.
 */

export type TestMode = 'unit' | 'integration' | 'e2e' | 'full' | 'infra' | 'smoke';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  skipped?: boolean;
  coverage?: number;
  output?: string;
}

export interface CoverageReport {
  lines: { total: number; covered: number; percent: number };
  functions: { total: number; covered: number; percent: number };
  branches: { total: number; covered: number; percent: number };
  deadCode?: string[];
}

