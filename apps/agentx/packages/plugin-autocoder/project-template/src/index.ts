import { type Project, type ProjectAgent } from '@elizaos/core';
import { character } from './character.ts';

export const projectAgent: ProjectAgent = {
  character,
};

const project: Project = {
  agents: [projectAgent],
};

export default project;
