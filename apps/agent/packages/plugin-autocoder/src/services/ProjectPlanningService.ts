import {
  Service,
  elizaLogger,
  type IAgentRuntime,
  ServiceType,
  type ServiceTypeName,
} from '@elizaos/core';
import { FormsService } from '@elizaos/plugin-forms';

export interface ProjectPlan {
  id: string;
  name: string;
  description: string;
  type: 'plugin' | 'agent' | 'workflow' | 'mcp' | 'full-stack';
  status?: 'planning' | 'generating' | 'testing' | 'completed' | 'failed';
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
  architecture: {
    components: ComponentSpec[];
    dependencies: DependencySpec[];
    integrations: IntegrationSpec[];
  };
  requirements: RequirementSpec[];
  milestones: Milestone[];
  risks: Risk[];
  techStack: TechStackSpec;
  estimatedEffort: EffortEstimate;
  createdAt: Date;
  updatedAt: Date;
}

interface ComponentSpec {
  name: string;
  type: 'service' | 'action' | 'provider' | 'ui' | 'database' | 'api';
  description: string;
  responsibilities: string[];
  interfaces: string[];
  dependencies: string[];
}

interface DependencySpec {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer';
  purpose: string;
}

interface IntegrationSpec {
  service: string;
  type: 'api' | 'webhook' | 'database' | 'event';
  purpose: string;
  configuration: Record<string, any>;
}

interface RequirementSpec {
  id: string;
  type: 'functional' | 'non-functional' | 'technical';
  priority: 'must-have' | 'should-have' | 'nice-to-have';
  description: string;
  acceptanceCriteria: string[];
  status: 'pending' | 'in-progress' | 'completed';
}

interface Milestone {
  id: string;
  name: string;
  description: string;
  deliverables: string[];
  dueDate?: Date;
  status: 'pending' | 'in-progress' | 'completed';
  dependencies: string[];
}

interface Risk {
  id: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  likelihood: 'low' | 'medium' | 'high';
  mitigation: string;
}

interface TechStackSpec {
  language: string;
  framework?: string;
  database?: string;
  testing: string[];
  tools: string[];
}

interface EffortEstimate {
  development: number; // hours
  testing: number;
  documentation: number;
  total: number;
  confidence: 'low' | 'medium' | 'high';
}

export class ProjectPlanningService extends Service {
  static serviceName: string = 'project-planning';
  static serviceType: ServiceTypeName = ServiceType.UNKNOWN;

  protected runtime: IAgentRuntime;
  private formsService?: FormsService;
  private plans: Map<string, ProjectPlan> = new Map();

  /**
   * Static method to start the service
   */
  static async start(runtime: IAgentRuntime): Promise<Service> {
    elizaLogger.info('Starting ProjectPlanningService...');
    const service = new ProjectPlanningService(runtime);
    await service.start();
    return service;
  }

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
  }

  get capabilityDescription(): string {
    return 'Plans and architects software projects with detailed specifications';
  }

  async start(): Promise<void> {
    elizaLogger.info('Starting ProjectPlanningService');

    // Get forms service for interactive planning
    this.formsService = this.runtime.getService('forms') as FormsService;
    if (!this.formsService) {
      elizaLogger.warn('Forms service not available, interactive planning will be limited');
    }

    elizaLogger.info('ProjectPlanningService started successfully');
  }

  async stop(): Promise<void> {
    elizaLogger.info('Stopping ProjectPlanningService');
    this.plans.clear();
  }

  /**
   * Create a comprehensive project plan
   */
  async createProjectPlan(request: {
    name: string;
    description: string;
    type: 'plugin' | 'agent' | 'workflow' | 'mcp' | 'full-stack';
    requirements: string[];
    constraints?: string[];
  }): Promise<ProjectPlan> {
    elizaLogger.info(`Creating project plan for ${request.name}`);

    // Analyze project requirements
    const analysis = await this.analyzeRequirements(request);

    // Generate architecture
    const architecture = await this.generateArchitecture(request, analysis);

    // Create detailed requirements
    const requirements = await this.generateRequirements(request, analysis);

    // Plan milestones
    const milestones = await this.planMilestones(request, requirements);

    // Identify risks
    const risks = await this.identifyRisks(request, architecture);

    // Determine tech stack
    const techStack = await this.selectTechStack(request, architecture);

    // Estimate effort
    const estimatedEffort = await this.estimateEffort(requirements, architecture);

    const plan: ProjectPlan = {
      id: `plan-${Date.now()}`,
      name: request.name,
      description: request.description,
      type: request.type,
      architecture,
      requirements,
      milestones,
      risks,
      techStack,
      estimatedEffort,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.plans.set(plan.id, plan);
    elizaLogger.info(`Created project plan ${plan.id}`);

    return plan;
  }

  /**
   * Analyze project requirements using AI
   */
  private async analyzeRequirements(request: any): Promise<any> {
    const prompt = `Analyze these project requirements:
Name: ${request.name}
Type: ${request.type}
Description: ${request.description}
Requirements: ${request.requirements.join(', ')}
Constraints: ${request.constraints?.join(', ') || 'None'}

Identify:
1. Core functionality needed
2. Technical challenges
3. Integration points
4. Performance requirements
5. Security considerations

Return analysis as JSON.`;

    const response = await this.runtime.useModel('text_large', {
      prompt,
      temperature: 0.3,
      max_tokens: 1500,
    });

    const jsonText = this.extractJSON(response);
    return JSON.parse(jsonText);
  }

  /**
   * Generate system architecture
   */
  private async generateArchitecture(request: any, analysis: any): Promise<any> {
    const prompt = `Design system architecture for:
Project: ${request.name} (${request.type})
Description: ${request.description}
Analysis: ${JSON.stringify(analysis, null, 2)}

Create architecture with:
1. Components (services, actions, providers, etc.)
2. Dependencies between components
3. External integrations
4. Data flow

Return as JSON with components, dependencies, and integrations arrays.`;

    const response = await this.runtime.useModel('text_large', {
      prompt,
      temperature: 0.4,
      max_tokens: 2000,
    });

    const jsonText = this.extractJSON(response);
    return JSON.parse(jsonText);
  }

  /**
   * Generate detailed requirements
   */
  private async generateRequirements(request: any, analysis: any): Promise<RequirementSpec[]> {
    const requirements: RequirementSpec[] = [];
    let idCounter = 1;

    // Convert high-level requirements to detailed specs
    for (const req of request.requirements) {
      requirements.push({
        id: `REQ-${idCounter++}`,
        type: 'functional',
        priority: 'must-have',
        description: req,
        acceptanceCriteria: await this.generateAcceptanceCriteria(req),
        status: 'pending',
      });
    }

    // Add technical requirements from analysis
    if (analysis.performanceRequirements) {
      for (const perfReq of analysis.performanceRequirements) {
        requirements.push({
          id: `REQ-${idCounter++}`,
          type: 'non-functional',
          priority: 'should-have',
          description: perfReq,
          acceptanceCriteria: [],
          status: 'pending',
        });
      }
    }

    return requirements;
  }

  /**
   * Generate acceptance criteria for a requirement
   */
  private async generateAcceptanceCriteria(requirement: string): Promise<string[]> {
    const prompt = `Generate 3-5 specific acceptance criteria for this requirement:
"${requirement}"

Each criterion should be testable and measurable.
Return as JSON array of strings.`;

    const response = await this.runtime.useModel('text_large', {
      prompt,
      temperature: 0.3,
      max_tokens: 500,
    });

    const jsonText = this.extractJSON(response);
    const criteria = JSON.parse(jsonText);
    return Array.isArray(criteria) ? criteria : [];
  }

  /**
   * Plan project milestones
   */
  private async planMilestones(
    request: any,
    requirements: RequirementSpec[]
  ): Promise<Milestone[]> {
    const prompt = `Plan milestones for project:
Name: ${request.name}
Type: ${request.type}
Requirements: ${requirements.length} total

Create 3-5 milestones with:
- Name and description
- Deliverables
- Dependencies between milestones

Return as JSON array.`;

    const response = await this.runtime.useModel('text_large', {
      prompt,
      temperature: 0.4,
      max_tokens: 1000,
    });

    const jsonText = this.extractJSON(response);
    const milestones = JSON.parse(jsonText);

    return milestones.map((m: any, index: number) => ({
      id: `M${index + 1}`,
      name: m.name || `Milestone ${index + 1}`,
      description: m.description || '',
      deliverables: m.deliverables || [],
      status: 'pending',
      dependencies: m.dependencies || [],
    }));
  }

  /**
   * Identify project risks
   */
  private async identifyRisks(request: any, architecture: any): Promise<Risk[]> {
    const prompt = `Identify risks for project:
Name: ${request.name}
Type: ${request.type}
Architecture: ${JSON.stringify(architecture, null, 2)}

List technical and project risks with:
- Description
- Impact (low/medium/high)
- Likelihood (low/medium/high)
- Mitigation strategy

Return as JSON array.`;

    const response = await this.runtime.useModel('text_large', {
      prompt,
      temperature: 0.4,
      max_tokens: 1000,
    });

    const jsonText = this.extractJSON(response);
    const risks = JSON.parse(jsonText);

    return risks.map((r: any, index: number) => ({
      id: `RISK-${index + 1}`,
      description: r.description || 'Unknown risk',
      impact: r.impact || 'medium',
      likelihood: r.likelihood || 'medium',
      mitigation: r.mitigation || 'Monitor and address as needed',
    }));
  }

  /**
   * Select appropriate tech stack
   */
  private async selectTechStack(request: any, _architecture: any): Promise<TechStackSpec> {
    const typeToStack: Record<string, TechStackSpec> = {
      plugin: {
        language: 'TypeScript',
        framework: 'ElizaOS Plugin Framework',
        testing: ['Jest', 'ElizaOS Test Framework'],
        tools: ['ESLint', 'Prettier', 'TypeScript Compiler'],
      },
      agent: {
        language: 'TypeScript',
        framework: 'ElizaOS Agent Runtime',
        database: 'SQLite',
        testing: ['Jest', 'Integration Tests'],
        tools: ['Docker', 'ESLint', 'Prettier'],
      },
      workflow: {
        language: 'TypeScript',
        framework: 'ElizaOS Workflow Engine',
        testing: ['Jest', 'E2E Tests'],
        tools: ['Workflow Designer', 'ESLint'],
      },
      mcp: {
        language: 'TypeScript',
        framework: 'Model Context Protocol',
        testing: ['Jest', 'MCP Test Suite'],
        tools: ['MCP CLI', 'TypeScript Compiler'],
      },
      'full-stack': {
        language: 'TypeScript',
        framework: 'Next.js',
        database: 'PostgreSQL',
        testing: ['Jest', 'Cypress', 'React Testing Library'],
        tools: ['ESLint', 'Prettier', 'Docker', 'Webpack'],
      },
    };

    return typeToStack[request.type] || typeToStack.plugin;
  }

  /**
   * Estimate project effort
   */
  private async estimateEffort(
    requirements: RequirementSpec[],
    architecture: any
  ): Promise<EffortEstimate> {
    const componentCount = architecture.components?.length || 1;
    const requirementCount = requirements.length;

    // Base estimates
    const hoursPerComponent = 8;
    const hoursPerRequirement = 4;

    const development = componentCount * hoursPerComponent + requirementCount * hoursPerRequirement;
    const testing = development * 0.4; // 40% of dev time
    const documentation = development * 0.2; // 20% of dev time

    return {
      development: Math.round(development),
      testing: Math.round(testing),
      documentation: Math.round(documentation),
      total: Math.round(development + testing + documentation),
      confidence: requirementCount > 10 ? 'low' : requirementCount > 5 ? 'medium' : 'high',
    };
  }

  /**
   * Get project plan by ID
   */
  async getProjectPlan(planId: string): Promise<ProjectPlan | undefined> {
    return this.plans.get(planId);
  }

  /**
   * Update project plan
   */
  async updateProjectPlan(
    planId: string,
    updates: Partial<ProjectPlan>
  ): Promise<ProjectPlan | undefined> {
    const plan = this.plans.get(planId);
    if (!plan) {
      return undefined;
    }

    const updatedPlan = {
      ...plan,
      ...updates,
      updatedAt: new Date(),
    };

    this.plans.set(planId, updatedPlan);
    return updatedPlan;
  }

  /**
   * List all project plans
   */
  async listProjectPlans(): Promise<ProjectPlan[]> {
    return Array.from(this.plans.values());
  }

  /**
   * Extract JSON from LLM response
   */
  private extractJSON(response: string): string {
    if (typeof response !== 'string') {
      return JSON.stringify(response);
    }

    // Remove markdown code blocks
    const jsonText = response.replace(/```json\s*|\s*```/g, '').trim();

    // Try to find JSON object or array
    const objectMatch = jsonText.match(/\{[\s\S]*\}/);
    const arrayMatch = jsonText.match(/\[[\s\S]*\]/);

    if (objectMatch) {
      return objectMatch[0];
    } else if (arrayMatch) {
      return arrayMatch[0];
    }

    return jsonText;
  }
}
