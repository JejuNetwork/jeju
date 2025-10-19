import type { Plugin } from '@elizaos/core';
import { ExperienceService } from './service';
import { experienceProvider } from './providers/experienceProvider';
import { experienceEvaluator } from './evaluators/experienceEvaluator';
import { IAgentRuntime } from '@elizaos/core';
import { logger } from '@elizaos/core';
import './types'; // Ensure module augmentation is loaded

export const experiencePlugin: Plugin = {
  name: 'experience',
  description:
    'Self-learning experience system that records experiences and learns from agent interactions',

  services: [ExperienceService],

  providers: [experienceProvider],

  evaluators: [experienceEvaluator],

  init: async (config: Record<string, any>, runtime: IAgentRuntime) => {
    logger.info('[ExperiencePlugin] Initializing self-learning experience system');

    const maxExperiences = config.maxExperiences || 10000;
    const autoRecordThreshold = config.autoRecordThreshold || 0.7;

    logger.info(`[ExperiencePlugin] Configuration read:
    - Max experiences: ${maxExperiences}
    - Auto-record threshold: ${autoRecordThreshold}`);
  },
};

// Export individual components for testing
export { ExperienceService } from './service';
export * from './types';

export default experiencePlugin;
