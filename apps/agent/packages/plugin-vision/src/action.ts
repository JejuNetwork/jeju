// Vision actions for scene analysis and image capture
import {
  type Action,
  type ActionExample,
  ActionResult,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
  ContentType,
  type Media,
  createUniqueUuid,
} from '@elizaos/core';
import { VisionService } from './service';
import { VisionMode } from './types';

export const describeSceneAction: Action = {
  name: 'DESCRIBE_SCENE',
  similes: ['WHAT_DO_YOU_SEE', 'DESCRIBE_VIEW', 'ANALYZE_SCENE', 'TELL_ME_WHAT_YOU_SEE'],
  description:
    'Analyzes and describes the current visual scene from camera or screen. Provides detailed information about people, objects, and environment. Can be combined with CAPTURE_IMAGE for documentation.',
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if vision capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('[describeSceneAction] Vision capabilities disabled in settings.');
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
    const visionService = runtime.getService<VisionService>('VISION');

    if (!visionService || !visionService.isActive()) {
      const thought = 'Vision service is not available or no camera/screen is active.';
      const text = 'I cannot describe the scene right now. No visual input is available.';
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['DESCRIBE_SCENE'],
        });
      }
      return {
        success: false,
        text: 'Vision service unavailable - cannot describe scene',
        values: {
          success: false,
          visionAvailable: false,
          error: 'Vision service not available',
        },
        data: {
          actionName: 'DESCRIBE_SCENE',
          error: 'Vision service not available or no visual input active',
        },
      };
    }

    try {
      const scene = await visionService.getSceneDescription();

      if (!scene) {
        const thought = 'Unable to get scene description from vision service.';
        const text =
          'I cannot see anything at the moment. Please ensure the camera or screen capture is working.';
        if (callback) {
          await callback({
            thought,
            text,
            actions: ['DESCRIBE_SCENE'],
          });
        }
        return {
          success: false,
          text: 'Unable to get scene description',
          values: {
            success: false,
            visionAvailable: true,
            sceneAvailable: false,
          },
          data: {
            actionName: 'DESCRIBE_SCENE',
            error: 'Scene description not available',
          },
        };
      }

      // Build comprehensive scene description
      const descriptions: string[] = [];

      // Overall scene
      if (scene.description) {
        descriptions.push(scene.description);
      }

      // People in scene
      if (scene.people && scene.people.length > 0) {
        const peopleCount = scene.people.length;
        descriptions.push(
          `I can see ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} in the scene.`
        );

        scene.people.forEach((person, index) => {
          const desc = [`Person ${index + 1}:`];
          desc.push(`${person.pose} pose`);
          desc.push(`facing ${person.facing}`);
          desc.push(`(confidence: ${Math.round(person.confidence * 100)}%)`);
          descriptions.push(desc.join(' '));
        });
      }

      // Objects in scene
      if (scene.objects && scene.objects.length > 0) {
        descriptions.push(`\nObjects in view: ${scene.objects.map((obj) => obj.type).join(', ')}`);
      }

      // Environment details from enhanced scene
      const enhancedScene = scene as any; // Type assertion for potential enhanced properties
      if (enhancedScene.environment) {
        const envDetails: string[] = [];
        if (enhancedScene.environment.lighting)
          envDetails.push(`lighting: ${enhancedScene.environment.lighting}`);
        if (enhancedScene.environment.setting)
          envDetails.push(`setting: ${enhancedScene.environment.setting}`);
        if (enhancedScene.environment.timeOfDay)
          envDetails.push(`time: ${enhancedScene.environment.timeOfDay}`);
        if (envDetails.length > 0) {
          descriptions.push(`\nEnvironment: ${envDetails.join(', ')}`);
        }
      }

      const fullDescription = descriptions.join(' ');
      const thought = `Analyzed scene with ${scene.people?.length || 0} people and ${scene.objects?.length || 0} objects.`;

      if (callback) {
        await callback({
          thought,
          text: fullDescription,
          actions: ['DESCRIBE_SCENE'],
        });
      }

      return {
        success: true,
        text: fullDescription,
        values: {
          success: true,
          visionAvailable: true,
          sceneAvailable: true,
          peopleCount: scene.people?.length || 0,
          objectCount: scene.objects?.length || 0,
        },
        data: {
          actionName: 'DESCRIBE_SCENE',
          scene,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      logger.error('[describeSceneAction] Error describing scene:', error);
      const thought = 'An error occurred while trying to describe the scene.';
      const text = `Error describing scene: ${error.message}`;
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['DESCRIBE_SCENE'],
        });
      }

      return {
        success: false,
        text: 'Error describing scene',
        values: {
          success: false,
          visionAvailable: true,
          error: true,
          errorMessage: error.message,
        },
        data: {
          actionName: 'DESCRIBE_SCENE',
          error: error.message,
          errorType: 'scene_description_error',
        },
      };
    }
  },
  examples: [
    [
      { name: '{{user}}', content: { text: 'what do you see?' } },
      {
        name: '{{agent}}',
        content: {
          actions: ['DESCRIBE_SCENE'],
          thought: 'The user wants me to describe what I can see.',
          text: 'I can see 2 people in an office setting. Person 1: wearing a blue shirt, seated at a desk. Person 2: standing near the whiteboard, appears to be presenting. Objects in view: laptop, monitor, whiteboard, chairs. Environment: indoor office, bright lighting.',
        },
      },
    ],
    [
      { name: '{{user}}', content: { text: 'describe the scene' } },
      {
        name: '{{agent}}',
        content: {
          actions: ['DESCRIBE_SCENE'],
          thought: 'User is asking for a scene description.',
          text: 'The scene shows a modern conference room with 3 people having a meeting. The room has large windows with natural lighting.',
        },
      },
    ],
  ] as ActionExample[][],
};

export const captureImageAction: Action = {
  name: 'CAPTURE_IMAGE',
  similes: ['TAKE_PHOTO', 'SCREENSHOT', 'CAPTURE_FRAME', 'TAKE_PICTURE'],
  description:
    'Captures the current frame from the camera and saves it as an image attachment. Returns image data with camera info and timestamp for action chaining. Can be combined with DESCRIBE_SCENE for analysis or NAME_ENTITY for identification workflows.',
  // Note: This action is disabled by default - privacy-sensitive, can capture images
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if camera or screen capture capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('[captureImageAction] Vision capture capabilities disabled in settings.');
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
    const visionService = runtime.getService<VisionService>('VISION');

    if (!visionService || !visionService.isActive()) {
      const thought = 'Vision service is not available or no camera is connected.';
      const text = 'I cannot capture an image right now. No camera is available.';
      // await saveExecutionRecord(runtime, message, thought, text, ['CAPTURE_IMAGE']); // This line was removed
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['CAPTURE_IMAGE'],
        });
      }
      return {
        success: false,
        text: 'Vision service unavailable - cannot capture image',
        values: {
          success: false,
          visionAvailable: false,
          captureSuccess: false,
        },
        data: {
          actionName: 'CAPTURE_IMAGE',
          error: 'Vision service not available or no camera connected',
        },
      };
    }

    try {
      const imageBuffer = await visionService.captureImage();
      const cameraInfo = visionService.getCameraInfo();

      if (!imageBuffer) {
        const thought = 'Failed to capture image from camera.';
        const text = 'I could not capture an image from the camera. Please try again.';
        // await saveExecutionRecord(runtime, message, thought, text, ['CAPTURE_IMAGE']); // This line was removed
        if (callback) {
          await callback({
            thought,
            text,
            actions: ['CAPTURE_IMAGE'],
          });
        }
        return {
          success: false,
          text: 'Failed to capture image from camera',
          values: {
            success: false,
            visionAvailable: true,
            captureSuccess: false,
          },
          data: {
            actionName: 'CAPTURE_IMAGE',
            error: 'Camera capture failed',
            cameraInfo,
          },
        };
      }

      // Create image attachment
      const attachmentId = createUniqueUuid(runtime, `capture-${Date.now()}`);
      const timestamp = new Date().toISOString();

      const imageAttachment: Media = {
        id: attachmentId,
        title: `Camera Capture - ${timestamp}`,
        contentType: ContentType.IMAGE,
        source: `camera:${cameraInfo?.name || 'unknown'}`,
        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
      };

      const thought = `Captured an image from camera "${cameraInfo?.name}".`;
      const text = `I've captured an image from the camera at ${timestamp}.`;

      // await saveExecutionRecord( // This line was removed
      //   runtime,
      //   message,
      //   thought,
      //   text,
      //   ['CAPTURE_IMAGE'],
      //   [imageAttachment]
      // );

      if (callback) {
        await callback({
          thought,
          text,
          actions: ['CAPTURE_IMAGE'],
          attachments: [imageAttachment],
        });
      }

      return {
        success: true,
        text: `I've captured an image from the camera at ${timestamp}.`,
        values: {
          success: true,
          visionAvailable: true,
          captureSuccess: true,
          cameraName: cameraInfo?.name,
          timestamp,
        },
        data: {
          actionName: 'CAPTURE_IMAGE',
          imageAttachment,
          cameraInfo,
          timestamp,
        },
      };
    } catch (error: any) {
      logger.error('[captureImageAction] Error capturing image:', error);
      const thought = 'An error occurred while trying to capture an image.';
      const text = `Error capturing image: ${error.message}`;
      // await saveExecutionRecord(runtime, message, thought, text, ['CAPTURE_IMAGE']); // This line was removed
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['CAPTURE_IMAGE'],
        });
      }

      return {
        success: false,
        text: 'Error capturing image',
        values: {
          success: false,
          visionAvailable: true,
          error: true,
          errorMessage: error.message,
        },
        data: {
          actionName: 'CAPTURE_IMAGE',
          error: error.message,
          errorType: 'capture_error',
        },
      };
    }
  },
  examples: [
    // Multi-action: Describe scene then capture image
    [
      { name: '{{user}}', content: { text: 'describe what you see and take a photo' } },
      {
        name: '{{agent}}',
        content: {
          actions: ['DESCRIBE_SCENE', 'CAPTURE_IMAGE'],
          thought: 'User wants scene analysis followed by image capture.',
          text: 'I can see 3 people in an office setting. Let me capture this scene for you.',
        },
      },
    ],
    [
      { name: '{{user}}', content: { text: 'take a photo' } },
      {
        name: '{{agent}}',
        content: {
          actions: ['CAPTURE_IMAGE'],
          thought: 'The user wants me to capture an image from the camera.',
          text: "I've captured an image from the camera.",
        },
      },
    ],
    [
      { name: '{{user}}', content: { text: 'capture the current scene' } },
      {
        name: '{{agent}}',
        content: {
          actions: ['CAPTURE_IMAGE'],
        },
      },
    ],
  ] as ActionExample[][],
};

export const setVisionModeAction: Action = {
  name: 'SET_VISION_MODE',
  description: 'Set the vision mode to OFF, CAMERA, SCREEN, or BOTH',
  similes: [
    'change vision to {mode}',
    'set vision mode {mode}',
    'switch to {mode} vision',
    'turn vision {mode}',
    'use {mode} vision',
    'enable {mode} vision',
    'disable vision',
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if any vision capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('[setVisionModeAction] Vision capabilities disabled in settings.');
      return false;
    }

    const visionService = runtime.getService<VisionService>('VISION');
    return visionService !== null;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ): Promise<void> => {
    const visionService = runtime.getService<VisionService>('VISION');

    if (!visionService) {
      const thought = 'Vision service is not available.';
      const text = 'I cannot change vision mode because the vision service is not available.';
      // await saveExecutionRecord(runtime, message, thought, text, ['SET_VISION_MODE']); // This line was removed
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['SET_VISION_MODE'],
        });
      }
      return;
    }

    try {
      // Extract the desired mode from the message
      const messageText = message.content.text?.toLowerCase() || '';
      let newMode: VisionMode | null = null;

      if (messageText.includes('off') || messageText.includes('disable')) {
        newMode = VisionMode.OFF;
      } else if (messageText.includes('both')) {
        newMode = VisionMode.BOTH;
      } else if (messageText.includes('screen')) {
        newMode = VisionMode.SCREEN;
      } else if (messageText.includes('camera')) {
        newMode = VisionMode.CAMERA;
      }

      if (!newMode) {
        const thought = 'Could not determine the desired vision mode from the message.';
        const text = 'Please specify the vision mode: OFF, CAMERA, SCREEN, or BOTH.';
        // await saveExecutionRecord(runtime, message, thought, text, ['SET_VISION_MODE']); // This line was removed
        if (callback) {
          await callback({
            thought,
            text,
            actions: ['SET_VISION_MODE'],
          });
        }
        return;
      }

      const currentMode = visionService.getVisionMode();
      await visionService.setVisionMode(newMode);

      const thought = `Changed vision mode from ${currentMode} to ${newMode}.`;
      let text = '';

      switch (newMode) {
        case VisionMode.OFF:
          text = 'Vision has been disabled. I will no longer process visual input.';
          break;
        case VisionMode.CAMERA:
          text = 'Vision mode set to CAMERA only. I will process input from the camera.';
          break;
        case VisionMode.SCREEN:
          text = "Vision mode set to SCREEN only. I will analyze what's on your screen.";
          break;
        case VisionMode.BOTH:
          text = 'Vision mode set to BOTH. I will process input from both camera and screen.';
          break;
      }

      // await saveExecutionRecord(runtime, message, thought, text, ['SET_VISION_MODE']); // This line was removed
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['SET_VISION_MODE'],
        });
      }
    } catch (error: any) {
      logger.error('[setVisionModeAction] Error changing vision mode:', error);
      const thought = 'An error occurred while trying to change the vision mode.';
      const text = `Error changing vision mode: ${error.message}`;
      // await saveExecutionRecord(runtime, message, thought, text, ['SET_VISION_MODE']); // This line was removed
      if (callback) {
        await callback({
          thought,
          text,
          actions: ['SET_VISION_MODE'],
        });
      }
    }
  },
  examples: [
    [
      { name: 'user', content: { text: 'set vision mode to screen' } },
      {
        name: 'agent',
        content: {
          actions: ['SET_VISION_MODE'],
          thought: 'The user wants to switch to screen vision mode.',
          text: "Vision mode set to SCREEN only. I will analyze what's on your screen.",
        },
      },
    ],
    [
      { name: 'user', content: { text: 'enable both camera and screen vision' } },
      {
        name: 'agent',
        content: {
          actions: ['SET_VISION_MODE'],
          thought: 'The user wants to enable both vision inputs.',
          text: 'Vision mode set to BOTH. I will process input from both camera and screen.',
        },
      },
    ],
    [
      { name: 'user', content: { text: 'turn off vision' } },
      {
        name: 'agent',
        content: {
          actions: ['SET_VISION_MODE'],
          thought: 'The user wants to disable vision.',
          text: 'Vision has been disabled. I will no longer process visual input.',
        },
      },
    ],
  ],
};

// Enhanced actions for entity tracking and face recognition
export const nameEntityAction: Action = {
  name: 'NAME_ENTITY',
  description: 'Assign a name to a person or object currently visible in the camera view',
  similes: [
    'call the person {name}',
    'the person in front is {name}',
    'name the person {name}',
    'that person is {name}',
    'the object is a {name}',
    'call that {name}',
  ],
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'The person wearing the blue shirt is named Alice',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I've identified the person in the blue shirt as Alice. I'll remember them for future interactions.",
          actions: ['NAME_ENTITY'],
        },
      },
    ],
    [
      {
        name: 'user',
        content: {
          text: 'Call the person on the left Bob',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I've named the person on the left as Bob. Their face profile has been updated.",
          actions: ['NAME_ENTITY'],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if vision capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('Vision capabilities disabled in settings.');
      return false;
    }

    const visionService = runtime.getService<VisionService>('VISION');
    return visionService?.isActive() || false;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      const visionService = runtime.getService<VisionService>('VISION');

      if (!visionService) {
        const thought = 'Vision service is not available.';
        const text = 'I cannot name entities because the vision service is not available.';
        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['NAME_ENTITY'] });
        }
        return;
      }

      const scene = await visionService.getSceneDescription();

      if (!scene || scene.people.length === 0) {
        const thought = 'No people visible to name.';
        const text = "I don't see any people in the current scene to name.";
        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['NAME_ENTITY'] });
        }
        return;
      }

      // Extract name from message
      const text = message.content.text?.toLowerCase() || '';
      const nameMatch = text.match(/(?:named?|call(?:ed)?|is)\s+(\w+)/i);

      if (!nameMatch) {
        const thought = 'Could not extract name from message.';
        const text =
          'I couldn\'t understand what name to assign. Please say something like "The person is named Alice".';
        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['NAME_ENTITY'] });
        }
        return;
      }

      const name = nameMatch[1];

      // Get entity tracker
      const _worldId = message.worldId || 'default-world';
      const entityTracker = visionService.getEntityTracker();

      // Update entities
      await entityTracker.updateEntities(scene.objects, scene.people, undefined, runtime);
      const activeEntities = entityTracker.getActiveEntities();
      const people = activeEntities.filter((e) => e.entityType === 'person');

      if (people.length === 0) {
        const thought = 'No tracked people found.';
        const text =
          "I can see someone but haven't established tracking yet. Please try again in a moment.";
        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['NAME_ENTITY'] });
        }
        return;
      }

      // For now, assign to the most prominent person (largest bounding box)
      let targetPerson = people[0];
      if (people.length > 1) {
        targetPerson = people.reduce((prev, curr) => {
          const prevArea = prev.lastPosition.width * prev.lastPosition.height;
          const currArea = curr.lastPosition.width * curr.lastPosition.height;
          return currArea > prevArea ? curr : prev;
        });
      }

      // Assign the name
      const success = entityTracker.assignNameToEntity(targetPerson.id, name);

      if (success) {
        // Success response
        const thought = `Named entity "${name}" and associated with person in scene.`;
        const text = `I've identified the person as ${name}. I'll remember them for future interactions.`;

        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY'], undefined); // This line was removed

        if (callback) {
          await callback({
            thought,
            text,
            actions: ['NAME_ENTITY'],
            data: { entityId: targetPerson.id, name },
          });
        }

        logger.info(`[NameEntityAction] Assigned name "${name}" to entity ${targetPerson.id}`);
      } else {
        const thought = 'Failed to assign name to entity.';
        const text = 'There was an error assigning the name. Please try again.';
        // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['NAME_ENTITY'] });
        }
      }
    } catch (error) {
      logger.error('[NameEntityAction] Error:', error);
      const thought = 'Failed to name entity.';
      const text = `Sorry, I couldn't name the entity: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // await saveExecutionRecord(runtime, message, thought, text, ['NAME_ENTITY']); // This line was removed
      if (callback) {
        await callback({ thought, text, actions: ['NAME_ENTITY'] });
      }
    }
  },
};

export const identifyPersonAction: Action = {
  name: 'IDENTIFY_PERSON',
  description: 'Identify a person in view if they have been seen before',
  // Note: This action is disabled by default - privacy-sensitive, can identify and recognize people
  similes: [
    'who is that',
    'who is the person',
    'identify the person',
    'do you recognize them',
    'have you seen them before',
  ],
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Who is the person in front of you?',
        },
      },
      {
        name: 'agent',
        content: {
          text: "That's Alice. I last saw her about 5 minutes ago. She's been here for the past 20 minutes.",
          actions: ['IDENTIFY_PERSON'],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if vision capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('Vision capabilities disabled in settings.');
      return false;
    }

    const visionService = runtime.getService<VisionService>('VISION');
    return visionService?.isActive() || false;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      const visionService = runtime.getService<VisionService>('VISION');

      if (!visionService) {
        const thought = 'Vision service is not available.';
        const text = 'I cannot identify people because the vision service is not available.';
        // await saveExecutionRecord(runtime, message, thought, text, ['IDENTIFY_PERSON']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['IDENTIFY_PERSON'] });
        }
        return;
      }

      const scene = await visionService.getSceneDescription();

      if (!scene || scene.people.length === 0) {
        const thought = 'No people visible to identify.';
        const text = "I don't see any people in the current scene.";
        // await saveExecutionRecord(runtime, message, thought, text, ['IDENTIFY_PERSON']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['IDENTIFY_PERSON'] });
        }
        return;
      }

      // Get entity tracker
      const _worldId = message.worldId || 'default-world';
      const entityTracker = visionService.getEntityTracker();

      // Update entities
      await entityTracker.updateEntities(scene.objects, scene.people, undefined, runtime);
      const activeEntities = entityTracker.getActiveEntities();
      const people = activeEntities.filter((e) => e.entityType === 'person');

      if (people.length === 0) {
        const thought = 'No tracked people found.';
        const text = "I can see someone but I'm still processing their identity.";
        // await saveExecutionRecord(runtime, message, thought, text, ['IDENTIFY_PERSON']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['IDENTIFY_PERSON'] });
        }
        return;
      }

      // Build response about visible people
      const _responseText = '';
      let recognizedCount = 0;
      let unknownCount = 0;
      const identifications: string[] = [];

      for (const person of people) {
        const name = person.attributes.name;
        const duration = Date.now() - person.firstSeen;
        const durationStr =
          duration < 60000
            ? `${Math.round(duration / 1000)} seconds`
            : `${Math.round(duration / 60000)} minutes`;

        if (name) {
          recognizedCount++;
          const personInfo = `I can see ${name}. They've been here for ${durationStr}.`;
          identifications.push(personInfo);

          // Add more context if available
          if (person.appearances.length > 5) {
            identifications.push("I've been tracking them consistently.");
          }
        } else {
          unknownCount++;
          const personInfo = `I see an unidentified person who has been here for ${durationStr}.`;
          identifications.push(personInfo);

          if (person.attributes.faceId) {
            identifications.push(
              "I've captured their face profile but they haven't been named yet."
            );
          }
        }
      }

      // Check for recently departed people
      const recentlyLeft = entityTracker.getRecentlyLeft();
      if (recentlyLeft.length > 0) {
        identifications.push('\nRecently departed:');
        for (const { entity, leftAt } of recentlyLeft) {
          if (entity.entityType === 'person' && entity.attributes.name) {
            const timeAgo = Date.now() - leftAt;
            const timeStr =
              timeAgo < 60000
                ? `${Math.round(timeAgo / 1000)} seconds ago`
                : `${Math.round(timeAgo / 60000)} minutes ago`;
            identifications.push(`${entity.attributes.name} left ${timeStr}.`);
          }
        }
      }

      const thought = `Identified ${recognizedCount} known people and ${unknownCount} unknown people.`;
      const text = identifications.join(' ');

      // await saveExecutionRecord(runtime, message, thought, text, ['IDENTIFY_PERSON']); // This line was removed

      if (callback) {
        await callback({
          thought,
          text,
          actions: ['IDENTIFY_PERSON'],
          data: { identifications: people },
        });
      }
    } catch (error) {
      logger.error('[identifyPersonAction] Error:', error);
      const thought = 'Failed to identify people.';
      const text = `Sorry, I couldn't identify people: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // await saveExecutionRecord(runtime, message, thought, text, ['IDENTIFY_PERSON']); // This line was removed
      if (callback) {
        await callback({ thought, text, actions: ['IDENTIFY_PERSON'] });
      }
    }
  },
};

export const trackEntityAction: Action = {
  name: 'TRACK_ENTITY',
  description: 'Start tracking a specific person or object in view',
  // Note: This action is disabled by default - privacy-sensitive, can track and monitor people
  similes: [
    'track the {description}',
    'follow the {description}',
    'keep an eye on the {description}',
    'watch the {description}',
  ],
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Track the person wearing the red shirt',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I'm now tracking the person in the red shirt. I'll notify you of any significant movements or if they leave the scene.",
          actions: ['TRACK_ENTITY'],
        },
      },
    ],
  ],

  validate: async (runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Check if vision capabilities are enabled in runtime settings
    const cameraEnabled =
      runtime.getSetting('ENABLE_CAMERA') === 'true' ||
      runtime.getSetting('VISION_CAMERA_ENABLED') === 'true';
    const screenEnabled =
      runtime.getSetting('ENABLE_SCREEN_CAPTURE') === 'true' ||
      runtime.getSetting('VISION_SCREEN_ENABLED') === 'true';

    if (!cameraEnabled && !screenEnabled) {
      logger.debug('Vision capabilities disabled in settings.');
      return false;
    }

    const visionService = runtime.getService<VisionService>('VISION');
    return visionService?.isActive() || false;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback
  ): Promise<void> => {
    try {
      const visionService = runtime.getService<VisionService>('VISION');

      if (!visionService) {
        const thought = 'Vision service is not available.';
        const text = 'I cannot track entities because the vision service is not available.';
        // await saveExecutionRecord(runtime, message, thought, text, ['TRACK_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['TRACK_ENTITY'] });
        }
        return;
      }

      const scene = await visionService.getSceneDescription();

      if (!scene) {
        const thought = 'No scene available for tracking.';
        const text = 'I need a moment to process the visual scene before I can track entities.';
        // await saveExecutionRecord(runtime, message, thought, text, ['TRACK_ENTITY']); // This line was removed
        if (callback) {
          await callback({ thought, text, actions: ['TRACK_ENTITY'] });
        }
        return;
      }

      const _text = message.content.text?.toLowerCase() || '';

      // Get entity tracker
      const _worldId = message.worldId || 'default-world';
      const entityTracker = visionService.getEntityTracker();

      // Update entities
      await entityTracker.updateEntities(scene.objects, scene.people, undefined, runtime);
      const stats = entityTracker.getStatistics();

      const thought = `Tracking ${stats.activeEntities} entities in the scene.`;
      const summary = [
        `I'm now tracking ${stats.activeEntities} entities in the scene`,
        `(${stats.people} people, ${stats.objects} objects).`,
        'The visual tracking system will maintain persistent IDs for all entities',
        'and notify you of significant changes.',
      ];
      const responseText = summary.join(' ');

      // await saveExecutionRecord(runtime, message, thought, responseText, ['TRACK_ENTITY']); // This line was removed

      if (callback) {
        await callback({
          thought,
          text: responseText,
          actions: ['TRACK_ENTITY'],
          data: { entities: stats.activeEntities },
        });
      }

      logger.info(`[TrackEntityAction] Tracking ${stats.activeEntities} entities`);
    } catch (error) {
      logger.error('[trackEntityAction] Error:', error);
      const thought = 'Failed to track entities.';
      const text = `Sorry, I couldn't track entities: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // await saveExecutionRecord(runtime, message, thought, text, ['TRACK_ENTITY']); // This line was removed
      if (callback) {
        await callback({ thought, text, actions: ['TRACK_ENTITY'] });
      }
    }
  },
};
