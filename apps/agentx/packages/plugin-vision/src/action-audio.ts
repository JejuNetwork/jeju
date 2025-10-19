// Audio capture actions for the vision plugin
import {
  type Action,
  type ActionExample,
  ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import { VisionService } from './service';

export const transcribeAudioAction: Action = {
  name: 'TRANSCRIBE_AUDIO',
  similes: ['LISTEN', 'HEAR_AUDIO', 'CAPTURE_AUDIO', 'RECORD_AUDIO'],
  description:
    'Captures audio from the microphone and transcribes it to text. Useful for voice commands, dictation, or understanding spoken content.',
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if microphone is enabled in runtime settings
    const microphoneEnabled =
      runtime.getSetting('ENABLE_MICROPHONE') === 'true' ||
      runtime.getSetting('VISION_MICROPHONE_ENABLED') === 'true';

    if (!microphoneEnabled) {
      logger.debug('[transcribeAudioAction] Microphone disabled in settings.');
      return false;
    }

    const visionService = runtime.getService<VisionService>('VISION');
    return !!visionService && visionService.isActive();
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const visionService = runtime.getService<VisionService>('VISION');
      if (!visionService) {
        logger.error('[transcribeAudioAction] VisionService not found');
        return {
          success: false,
          error: 'Vision service not available',
        };
      }

      // Check if audio capture is available
      const audioCapture = (visionService as any).audioCapture;
      const streamingAudioCapture = (visionService as any).streamingAudioCapture;

      if (!audioCapture && !streamingAudioCapture) {
        logger.error('[transcribeAudioAction] No audio capture service available');
        return {
          success: false,
          error: 'Audio capture not initialized. Please enable microphone in settings.',
        };
      }

      logger.info('[transcribeAudioAction] Starting audio transcription...');

      // Use batch audio capture for a single transcription
      if (audioCapture) {
        const transcription = await audioCapture.recordAndTranscribe();

        if (transcription) {
          logger.info(`[transcribeAudioAction] Transcribed: "${transcription}"`);

          if (callback) {
            await callback({
              text: `I heard you say: "${transcription}"`,
              source: 'transcribeAudioAction',
            });
          }

          return {
            success: true,
            data: {
              transcription,
              timestamp: new Date().toISOString(),
            },
          };
        } else {
          return {
            success: false,
            error: 'No speech detected or transcription failed',
          };
        }
      }

      return {
        success: false,
        error: 'Audio capture service not properly initialized',
      };
    } catch (error) {
      logger.error('[transcribeAudioAction] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
  examples: [
    [
      {
        name: 'elizaos',
        content: {
          text: 'Listen to what I have to say',
          action: 'TRANSCRIBE_AUDIO',
        },
      },
    ],
    [
      {
        name: 'elizaos',
        content: {
          text: 'Can you hear me?',
          action: 'LISTEN',
        },
      },
    ],
    [
      {
        name: 'elizaos',
        content: {
          text: 'Record audio and tell me what you hear',
          action: 'CAPTURE_AUDIO',
        },
      },
    ],
  ] as ActionExample[][],
};

export const toggleStreamingAudioAction: Action = {
  name: 'TOGGLE_STREAMING_AUDIO',
  similes: ['START_LISTENING', 'STOP_LISTENING', 'CONTINUOUS_LISTENING'],
  description:
    'Toggles continuous audio streaming with voice activity detection. When enabled, the agent will continuously listen and transcribe speech.',
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    const microphoneEnabled =
      runtime.getSetting('ENABLE_MICROPHONE') === 'true' ||
      runtime.getSetting('VISION_MICROPHONE_ENABLED') === 'true';

    const streamingEnabled = runtime.getSetting('USE_STREAMING_AUDIO') === 'true';

    return microphoneEnabled && streamingEnabled;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<ActionResult> => {
    try {
      const visionService = runtime.getService<VisionService>('VISION');
      if (!visionService) {
        return {
          success: false,
          error: 'Vision service not available',
        };
      }

      const streamingAudioCapture = (visionService as any).streamingAudioCapture;
      if (!streamingAudioCapture) {
        return {
          success: false,
          error: 'Streaming audio not initialized. Enable USE_STREAMING_AUDIO in settings.',
        };
      }

      const isCapturing = streamingAudioCapture.isCapturing;

      if (isCapturing) {
        await streamingAudioCapture.stop();
        logger.info('[toggleStreamingAudioAction] Stopped streaming audio capture');

        if (callback) {
          await callback({
            text: 'I have stopped listening continuously.',
            source: 'toggleStreamingAudioAction',
          });
        }

        return {
          success: true,
          data: {
            streaming: false,
            message: 'Streaming audio capture stopped',
          },
        };
      } else {
        await streamingAudioCapture.start();
        logger.info('[toggleStreamingAudioAction] Started streaming audio capture');

        if (callback) {
          await callback({
            text: 'I am now listening continuously. I will transcribe everything I hear.',
            source: 'toggleStreamingAudioAction',
          });
        }

        return {
          success: true,
          data: {
            streaming: true,
            message: 'Streaming audio capture started',
          },
        };
      }
    } catch (error) {
      logger.error('[toggleStreamingAudioAction] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
  examples: [
    [
      {
        name: 'elizaos',
        content: {
          text: 'Start listening continuously',
          action: 'START_LISTENING',
        },
      },
    ],
    [
      {
        name: 'elizaos',
        content: {
          text: 'Stop continuous listening',
          action: 'STOP_LISTENING',
        },
      },
    ],
  ] as ActionExample[][],
};
