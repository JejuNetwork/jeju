import { describe, it, expect, beforeEach } from 'bun:test';
import { transcribeAudioAction, toggleStreamingAudioAction } from '../action-audio';
import type { IAgentRuntime, Memory } from '@elizaos/core';

describe('Audio Actions', () => {
  let mockRuntime: IAgentRuntime;
  let mockVisionService: any;
  let mockAudioCapture: any;
  let mockStreamingAudioCapture: any;
  let mockSettings: Record<string, string>;

  let transcribeResult: any = null;
  let recordAndTranscribeCalled = false;

  beforeEach(() => {
    // Reset mocks
    transcribeResult = null;
    recordAndTranscribeCalled = false;

    // Mock audio capture services
    mockAudioCapture = {
      recordAndTranscribe: () => {
        recordAndTranscribeCalled = true;
        return Promise.resolve(transcribeResult);
      },
    };

    let startCalled = false;
    let stopCalled = false;
    mockStreamingAudioCapture = {
      isCapturing: false,
      start: () => {
        startCalled = true;
        mockStreamingAudioCapture.isCapturing = true;
        return Promise.resolve();
      },
      stop: () => {
        stopCalled = true;
        mockStreamingAudioCapture.isCapturing = false;
        return Promise.resolve();
      },
      get startCalled() {
        return startCalled;
      },
      get stopCalled() {
        return stopCalled;
      },
    };

    // Mock vision service
    mockVisionService = {
      isActive: () => true,
      audioCapture: mockAudioCapture,
      streamingAudioCapture: mockStreamingAudioCapture,
    };

    // Mock runtime
    mockSettings = {
      ENABLE_MICROPHONE: 'true',
      VISION_MICROPHONE_ENABLED: 'true',
      USE_STREAMING_AUDIO: 'true',
    };
    mockRuntime = {
      getSetting: (key: string) => mockSettings[key] || undefined,
      getService: (name: string) => {
        if (name === 'VISION') {
          return mockVisionService;
        }
        return null;
      },
    } as any;
  });

  describe('transcribeAudioAction', () => {
    it('should validate when microphone is enabled', async () => {
      const isValid = await transcribeAudioAction.validate(mockRuntime, {} as Memory);
      expect(isValid).toBe(true);
    });

    it('should not validate when microphone is disabled', async () => {
      mockSettings['ENABLE_MICROPHONE'] = 'false';
      mockSettings['VISION_MICROPHONE_ENABLED'] = 'false';
      const isValid = await transcribeAudioAction.validate(mockRuntime, {} as Memory);
      expect(isValid).toBe(false);
    });

    it('should successfully transcribe audio', async () => {
      const testTranscription = 'Hello, this is a test transcription';
      transcribeResult = testTranscription;

      const result = await transcribeAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.data).toEqual({
        transcription: testTranscription,
        timestamp: expect.any(String),
      });
      expect(recordAndTranscribeCalled).toBe(true);
    });

    it('should handle transcription failure', async () => {
      transcribeResult = null;

      const result = await transcribeAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe('No speech detected or transcription failed');
    });

    it('should handle missing audio capture service', async () => {
      mockVisionService.audioCapture = null;
      mockVisionService.streamingAudioCapture = null;

      const result = await transcribeAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe(
        'Audio capture not initialized. Please enable microphone in settings.'
      );
    });
  });

  describe('toggleStreamingAudioAction', () => {
    it('should validate when microphone and streaming are enabled', async () => {
      const isValid = await toggleStreamingAudioAction.validate(mockRuntime, {} as Memory);
      expect(isValid).toBe(true);
    });

    it('should not validate when streaming is disabled', async () => {
      mockSettings['USE_STREAMING_AUDIO'] = 'false';
      const isValid = await toggleStreamingAudioAction.validate(mockRuntime, {} as Memory);
      expect(isValid).toBe(false);
    });

    it('should start streaming when not capturing', async () => {
      mockStreamingAudioCapture.isCapturing = false;

      const result = await toggleStreamingAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.data).toEqual({
        streaming: true,
        message: 'Streaming audio capture started',
      });
      expect(mockStreamingAudioCapture.startCalled).toBe(true);
    });

    it('should stop streaming when capturing', async () => {
      mockStreamingAudioCapture.isCapturing = true;

      const result = await toggleStreamingAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.data).toEqual({
        streaming: false,
        message: 'Streaming audio capture stopped',
      });
      expect(mockStreamingAudioCapture.stopCalled).toBe(true);
    });

    it('should handle missing streaming audio service', async () => {
      mockVisionService.streamingAudioCapture = null;

      const result = await toggleStreamingAudioAction.handler(
        mockRuntime,
        {} as Memory,
        undefined,
        undefined,
        undefined
      );

      expect(result).toBeDefined();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe(
        'Streaming audio not initialized. Enable USE_STREAMING_AUDIO in settings.'
      );
    });
  });
});
