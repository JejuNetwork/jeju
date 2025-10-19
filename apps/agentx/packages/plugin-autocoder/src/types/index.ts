import type { Service, UUID } from '@elizaos/core';
import type { Socket } from 'socket.io';

/**
 * Core types for Plugin Autocoder
 */

/**
 * Project type enumeration
 */
export type ProjectType = 'plugin' | 'agent' | 'workflow' | 'mcp' | 'full-stack';

/**
 * Project status
 */
export type ProjectStatus = 'planning' | 'generating' | 'testing' | 'completed' | 'failed';

/**
 * WebSocket-related types
 */
export interface AutocoderSocket extends Socket {
  // Extend with autocoder-specific events if needed
}

/**
 * Autocoder WebSocket message types
 */
export interface AutocoderWebSocketMessage {
  type: 'PROJECT_UPDATE' | 'PROJECT_COMPLETE' | 'PROJECT_ERROR' | 'STATUS_UPDATE';
  data: ProjectUpdateData | ProjectCompleteData | ProjectErrorData | StatusUpdateData;
  timestamp?: number;
}

export interface ProjectUpdateData {
  projectId: string;
  status: ProjectStatus;
  progress?: number;
  message?: string;
  currentStep?: string;
}

export interface ProjectCompleteData {
  projectId: string;
  files: Array<{ path: string; content: string }>;
  summary: string;
}

export interface ProjectErrorData {
  projectId: string;
  error: string;
  details?: string;
}

export interface StatusUpdateData {
  activeProjects: number;
  completedProjects: number;
  failedProjects: number;
}

/**
 * Project metadata
 */
export interface ProjectMetadata {
  id: UUID;
  name: string;
  description: string;
  type: ProjectType;
  status: ProjectStatus;
  formId?: UUID; // Associated form ID during planning phase
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;

  // Project details collected from form
  details?: {
    // Basic info
    projectName?: string;
    projectDescription?: string;
    projectType?: ProjectType;

    // Technical requirements
    primaryFunction?: string;
    targetUsers?: string;
    keyFeatures?: string[];

    // Integration requirements
    requiredPlugins?: string[];
    externalServices?: string[];

    // Additional metadata
    complexity?: 'simple' | 'moderate' | 'complex';
    estimatedTime?: string;
  };

  // Generated artifacts
  artifacts?: {
    files?: Array<{
      path: string;
      content: string;
    }>;
    testResults?: {
      passed: boolean;
      summary: string;
      details: Record<string, unknown>;
    };
  };
}

/**
 * Project planning service interface
 */
export interface IProjectPlanningService {
  createProject(type: ProjectType, initialData?: Record<string, unknown>): Promise<ProjectMetadata>;
  updateProject(projectId: UUID, updates: Partial<ProjectMetadata>): Promise<ProjectMetadata>;
  getProject(projectId: UUID): Promise<ProjectMetadata | null>;
  listProjects(status?: ProjectStatus): Promise<ProjectMetadata[]>;
  generateProject(projectId: UUID): Promise<void>;
}

/**
 * Form step completion data
 */
export interface StepCompletionData {
  stepId: string;
  formData: Record<string, unknown>;
  projectId: UUID;
}

/**
 * Service type guards and utility types
 */
export interface CodeGenerationRequest {
  projectName: string;
  description: string;
  targetType: ProjectType;
  requirements: string[];
  apis: string[];
  testScenarios?: string[];
  githubRepo?: string;
}

export interface GenerationResult {
  success: boolean;
  projectPath?: string;
  githubUrl?: string;
  files?: Array<{ path: string; content: string }>;
  errors?: string[];
  warnings?: string[];
  executionResults?: ExecutionResults;
}

export interface ExecutionResults {
  testsPass?: boolean;
  lintPass?: boolean;
  typesPass?: boolean;
  buildPass?: boolean;
  buildSuccess?: boolean;
  securityPass?: boolean;
}

export interface ProjectStatusUpdate {
  projectId: string;
  projectName: string;
  type: ProjectType;
  status: ProjectStatus;
  currentStep?: string;
  progress?: number; // 0-100
  message?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  files?: Array<{ path: string; status: 'pending' | 'generating' | 'complete' | 'error' }>;
  validationResults?: ValidationResults;
}

export interface ValidationResults {
  lint: { passed: boolean; errors?: string[] };
  typeCheck: { passed: boolean; errors?: string[] };
  tests: { passed: boolean; errors?: string[] };
  build: { passed: boolean; errors?: string[] };
}

export interface ProjectHistory {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  filesGenerated?: number;
  error?: string;
}

/**
 * Service type guards
 */
export function isCodeGenerationService(
  service: Service | null | undefined
): service is CodeGenerationService {
  return service !== null && service !== undefined && 'generateCode' in service;
}

export function isProjectPlanningService(
  service: Service | null | undefined
): service is ProjectPlanningServiceInterface {
  return service !== null && service !== undefined && 'createProjectPlan' in service;
}

export function isProjectStatusManager(
  service: Service | null | undefined
): service is ProjectStatusManagerInterface {
  return service !== null && service !== undefined && 'createProject' in service;
}

// Forward declarations for service interfaces
export interface CodeGenerationService extends Service {
  generateCode(request: CodeGenerationRequest): Promise<GenerationResult>;
}

export interface ProjectPlanningServiceInterface extends Service {
  createProjectPlan(request: {
    name: string;
    description: string;
    type: ProjectType;
    requirements: string[];
    constraints?: string[];
  }): Promise<ProjectPlan>;
  listProjectPlans(): Promise<ProjectPlan[]>;
}

export interface ProjectStatusManagerInterface extends Service {
  createProject(name: string, type: ProjectType): string;
  updateStatus(projectId: string, updates: Partial<ProjectStatusUpdate>): void;
  updateStep(projectId: string, step: string, message?: string): void;
  updateValidation(
    projectId: string,
    type: 'lint' | 'typeCheck' | 'tests' | 'build',
    passed: boolean,
    errors?: string[]
  ): void;
}

export interface ProjectPlan {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  status?: ProjectStatus;
  formId?: string;
  details?: {
    projectName?: string;
  };
  error?: string;
  artifacts?: {
    files?: Array<{
      path: string;
      content: string;
    }>;
  };
}
