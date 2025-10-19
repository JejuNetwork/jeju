import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import {
  ProjectPlanningServiceInterface,
  isProjectPlanningService,
  type ProjectPlan,
} from '../types';

/**
 * Provider that exposes active projects context to the agent
 */
export const projectsProvider: Provider = {
  name: 'PROJECTS_CONTEXT',
  description: 'Provides context about active projects and their current status',
  dynamic: true, // Only called when needed

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<ProviderResult> => {
    const projectsService = runtime.getService('project-planning');
    if (!isProjectPlanningService(projectsService)) {
      return {
        text: 'Project planning service is not available.',
        values: {},
        data: {},
      };
    }

    // Get all projects
    const projects = await (projectsService as ProjectPlanningServiceInterface).listProjectPlans();

    if (projects.length === 0) {
      return {
        text: 'No projects found.',
        values: {},
        data: {},
      };
    }

    // Format projects for context
    let contextText = '[PROJECTS]\n';

    // Group projects by status
    const activeProjects = projects.filter(
      (p: ProjectPlan) =>
        p.status === 'planning' || p.status === 'generating' || p.status === 'testing'
    );
    const completedProjects = projects.filter((p: ProjectPlan) => p.status === 'completed');
    const failedProjects = projects.filter((p: ProjectPlan) => p.status === 'failed');

    if (activeProjects.length > 0) {
      contextText += '\nActive Projects:\n';
      activeProjects.forEach((project: ProjectPlan) => {
        contextText += `- ${project.name} (${project.type}): ${project.status}\n`;
        if (project.formId) {
          contextText += `  Form ID: ${project.formId}\n`;
        }
        if (project.details?.projectName) {
          contextText += `  Project Name: ${project.details.projectName}\n`;
        }
        if (project.error) {
          contextText += `  Error: ${project.error}\n`;
        }
      });
    }

    if (completedProjects.length > 0) {
      contextText += '\nCompleted Projects:\n';
      completedProjects.forEach((project: ProjectPlan) => {
        contextText += `- ${project.name} (${project.type})\n`;
        if (project.details?.projectName) {
          contextText += `  Project Name: ${project.details.projectName}\n`;
        }
        if (project.artifacts?.files) {
          contextText += `  Generated ${project.artifacts.files.length} files\n`;
        }
      });
    }

    if (failedProjects.length > 0) {
      contextText += '\nFailed Projects:\n';
      failedProjects.forEach((project: ProjectPlan) => {
        contextText += `- ${project.name} (${project.type})\n`;
        if (project.error) {
          contextText += `  Error: ${project.error}\n`;
        }
      });
    }

    return {
      text: contextText,
      values: {
        activeProjectsCount: activeProjects.length,
        completedProjectsCount: completedProjects.length,
        failedProjectsCount: failedProjects.length,
        totalProjectsCount: projects.length,
      },
      data: {
        projects,
        activeProjects,
        completedProjects,
        failedProjects,
      },
    };
  },
};
