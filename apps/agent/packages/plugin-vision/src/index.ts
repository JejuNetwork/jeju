// Vision plugin -- gives an agent visual perception through camera integration
import { Plugin } from '@elizaos/core';
import { VisionService } from './service';
import { visionProvider } from './provider';
import {
  describeSceneAction,
  captureImageAction,
  setVisionModeAction,
  nameEntityAction,
  identifyPersonAction,
  trackEntityAction,
} from './action';
import { transcribeAudioAction, toggleStreamingAudioAction } from './action-audio';
import { testSuites } from './tests/e2e';

export const visionPlugin: Plugin = {
  name: 'vision',
  description:
    'Provides visual perception through camera integration, scene analysis, and audio capture',
  services: [VisionService],
  providers: [visionProvider],
  actions: [
    // Scene analysis enabled for informational purposes
    describeSceneAction,
    // Image capture disabled by default (privacy-sensitive)
    captureImageAction,
    // Vision mode setting enabled for configuration
    setVisionModeAction,
    // Entity naming enabled for scene understanding
    nameEntityAction,
    // Person identification disabled by default (privacy-sensitive)
    identifyPersonAction,
    // Entity tracking disabled by default (privacy-sensitive)
    trackEntityAction,
    // Audio transcription actions
    transcribeAudioAction,
    toggleStreamingAudioAction,
  ],
  tests: testSuites,
  init: async (_config, _runtime) => {
    // Plugin initialization
    // The VisionService will be automatically registered and started by the runtime
    // Additional initialization logic can be added here if needed
  },
};

export default visionPlugin;

// Export service for external use
export { VisionService } from './service';
