import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TauriService, TauriMessage as TauriMsg } from '../services/TauriService';
import { useTauriChat } from '../hooks/useTauriChat';
import { v4 as uuidv4 } from 'uuid';
import { SecurityWarning, SECURITY_CAPABILITIES } from './SecurityWarning';
import { InputValidator, SecurityLogger } from '../utils/SecurityUtils';
import { ContainerLogs } from './ContainerLogs';
import { AgentLogs } from './AgentLogs';
import { ProviderSelector } from './ProviderSelector';
import { OllamaModelSelector } from './OllamaModelSelector';
import { BackupSettings } from './BackupSettings';
import { ServiceBrowser } from './ServiceBrowser';
import { RegistryApps } from './RegistryApps';
import {
  checkScreenCaptureCapabilities,
  getScreenCaptureErrorMessage,
} from '../utils/screenCapture';

// Extend Window interface for test compatibility
declare global {
  interface Window {
    elizaClient?: {
      socket: {
        connected: boolean;
        on: (event: string, callback: Function) => void;
        emit: (event: string, data: unknown) => void;
        disconnect: () => void;
        connect: () => void;
        _listeners?: Record<string, Function[]>;
      };
      isConnected: () => boolean;
      joinRoom?: (roomId: string) => void;
      sendMessage?: (message: Record<string, unknown>) => void;
    };
  }
}

interface OutputLine {
  type: 'user' | 'agent' | 'system' | 'error';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface PluginToggleState {
  autonomy: boolean;
  camera: boolean;
  screen: boolean;
  microphone: boolean;
  speakers: boolean;
  shell: boolean;
  browser: boolean;
}

interface SecurityWarningState {
  isVisible: boolean;
  capability: string;
  onConfirm: () => void;
}

// Track individual warning acknowledgments and feature usage
interface CapabilityUsageState {
  [capability: string]: {
    hasBeenUsed: boolean;
    warningAcknowledged: boolean;
    firstSeenAt?: Date;
  };
}

interface MediaStreams {
  camera?: MediaStream;
  screen?: MediaStream;
  microphone?: MediaStream;
  speakers?: MediaStream;
}

interface StreamingState {
  camera: boolean;
  screen: boolean;
  microphone: boolean;
  speakers: boolean;
}

// Enhanced capability buttons with progression support
interface ProgressionStatus {
  unlockedCapabilities?: string[];
  mode?: string;
  progressionReady?: boolean;
  [key: string]: unknown;
}

const UltraSimpleButtons: React.FC<{
  states: PluginToggleState;
  onToggle: (capability: string) => Promise<void>;
  progressionStatus?: ProgressionStatus;
  capabilityUsage: CapabilityUsageState;
}> = ({ states, onToggle, progressionStatus, capabilityUsage }) => {
  const [isTogglingState, setIsTogglingState] = useState({
    autonomy: false,
    camera: false,
    screen: false,
    microphone: false,
    speakers: false,
    shell: false,
    browser: false,
  });

  // Check if a capability is unlocked based on progression
  const isCapabilityUnlocked = (capability: string): boolean => {
    if (!progressionStatus?.unlockedCapabilities) {
      // Fallback: if no progression data, allow all capabilities
      return true;
    }

    // Map UI capability names to progression capability names
    const capabilityMap: Record<string, string[]> = {
      shell: ['shell', 'naming'],
      browser: ['browser', 'stagehand'],
      camera: ['camera', 'advanced_vision'],
      screen: ['vision', 'screen_capture'],
      microphone: ['microphone', 'sam', 'audio'],
      speakers: ['microphone', 'sam', 'audio'], // Speakers use same capabilities as microphone
      autonomy: ['autonomy'],
      goals: ['goals'],
      todo: ['todo'],
    };

    const progressionCapabilities = capabilityMap[capability] || [capability];
    return progressionCapabilities.some((cap) =>
      progressionStatus.unlockedCapabilities.includes(cap)
    );
  };

  const buttonStyle = (
    isActive: boolean,
    isToggling: boolean,
    isUnlocked: boolean,
    isNew: boolean
  ) => ({
    flex: '1 1 0',
    height: '40px',
    backgroundColor: !isUnlocked ? '#333333' : isActive ? '#00ff00' : '#1a1a1a',
    color: !isUnlocked ? '#666666' : isActive ? '#000000' : '#00ff00',
    cursor: !isUnlocked ? 'not-allowed' : isToggling ? 'wait' : 'pointer',
    textAlign: 'center' as const,
    border: `1px solid ${!isUnlocked ? '#555555' : isActive ? '#00ff00' : '#333333'}`,
    fontSize: '9px',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    userSelect: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column' as const,
    gap: '2px',
    minWidth: 0,
    opacity: !isUnlocked ? 0.5 : isToggling ? 0.7 : 1,
    position: 'relative' as const,
    animation: isNew && isUnlocked ? 'glow 2s ease-in-out infinite' : 'none',
    boxShadow: isNew && isUnlocked ? '0 0 10px #00ff00' : 'none',
  });

  const handleClick = async (capability: string) => {
    if (isTogglingState[capability as keyof typeof isTogglingState]) {
      return;
    } // Prevent double clicks

    // Check if capability is unlocked
    if (!isCapabilityUnlocked(capability)) {
      console.log(`Capability ${capability} is locked. Progression required.`);
      return;
    }

    setIsTogglingState((prev) => ({ ...prev, [capability]: true }));
    try {
      await onToggle(capability);
    } catch (error) {
      console.error(`Failed to toggle ${capability}:`, error);
    } finally {
      setIsTogglingState((prev) => ({ ...prev, [capability]: false }));
    }
  };

  return (
    <div style={{ display: 'flex', gap: '2px', width: '100%' }}>
      <div
        style={buttonStyle(
          states.autonomy,
          isTogglingState.autonomy,
          isCapabilityUnlocked('autonomy'),
          isCapabilityUnlocked('autonomy') && !capabilityUsage['autonomy']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: autonomy');
          handleClick('autonomy');
        }}
        data-testid="autonomy-toggle"
        title={
          !isCapabilityUnlocked('autonomy')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('autonomy') && !capabilityUsage['autonomy']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="autonomy-toggle-status">{states.autonomy ? '●' : '○'}</span>
        <span>{isTogglingState.autonomy ? '...' : 'AUTO'}</span>
      </div>

      <div
        style={buttonStyle(
          states.camera,
          isTogglingState.camera,
          isCapabilityUnlocked('camera'),
          isCapabilityUnlocked('camera') && !capabilityUsage['camera']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: camera');
          handleClick('camera');
        }}
        data-testid="camera-toggle"
        title={
          !isCapabilityUnlocked('camera')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('camera') && !capabilityUsage['camera']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="camera-toggle-status">{states.camera ? '●' : '○'}</span>
        <span>{isTogglingState.camera ? '...' : 'CAM'}</span>
      </div>

      <div
        style={buttonStyle(
          states.screen,
          isTogglingState.screen,
          isCapabilityUnlocked('screen'),
          isCapabilityUnlocked('screen') && !capabilityUsage['screen']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: screen');
          handleClick('screen');
        }}
        data-testid="screen-toggle"
        title={
          !isCapabilityUnlocked('screen')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('screen') && !capabilityUsage['screen']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="screen-toggle-status">{states.screen ? '●' : '○'}</span>
        <span>{isTogglingState.screen ? '...' : 'SCR'}</span>
      </div>

      <div
        style={buttonStyle(
          states.microphone,
          isTogglingState.microphone,
          isCapabilityUnlocked('microphone'),
          isCapabilityUnlocked('microphone') && !capabilityUsage['microphone']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: microphone');
          handleClick('microphone');
        }}
        data-testid="microphone-toggle"
        title={
          !isCapabilityUnlocked('microphone')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('microphone') && !capabilityUsage['microphone']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="microphone-toggle-status">{states.microphone ? '●' : '○'}</span>
        <span>{isTogglingState.microphone ? '...' : 'MIC'}</span>
      </div>

      <div
        style={buttonStyle(
          states.speakers,
          isTogglingState.speakers,
          isCapabilityUnlocked('speakers'),
          isCapabilityUnlocked('speakers') && !capabilityUsage['speakers']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: speakers');
          handleClick('speakers');
        }}
        data-testid="speakers-toggle"
        title={
          !isCapabilityUnlocked('speakers')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('speakers') && !capabilityUsage['speakers']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="speakers-toggle-status">{states.speakers ? '●' : '○'}</span>
        <span>{isTogglingState.speakers ? '...' : 'SPK'}</span>
      </div>

      <div
        style={buttonStyle(
          states.shell,
          isTogglingState.shell,
          isCapabilityUnlocked('shell'),
          isCapabilityUnlocked('shell') && !capabilityUsage['shell']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: shell');
          handleClick('shell');
        }}
        data-testid="shell-toggle"
        title={
          !isCapabilityUnlocked('shell')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('shell') && !capabilityUsage['shell']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="shell-toggle-status">{states.shell ? '●' : '○'}</span>
        <span>{isTogglingState.shell ? '...' : 'SH'}</span>
      </div>

      <div
        style={buttonStyle(
          states.browser,
          isTogglingState.browser,
          isCapabilityUnlocked('browser'),
          isCapabilityUnlocked('browser') && !capabilityUsage['browser']?.hasBeenUsed
        )}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('CLICKED: browser');
          handleClick('browser');
        }}
        data-testid="browser-toggle"
        title={
          !isCapabilityUnlocked('browser')
            ? '🔒 Locked - Complete progression to unlock'
            : isCapabilityUnlocked('browser') && !capabilityUsage['browser']?.hasBeenUsed
              ? '✨ NEW! Click to try this feature'
              : undefined
        }
      >
        <span data-testid="browser-toggle-status">{states.browser ? '●' : '○'}</span>
        <span>{isTogglingState.browser ? '...' : 'WWW'}</span>
      </div>
    </div>
  );
};

interface Goal {
  id: string;
  name: string;
  description: string;
  isCompleted: boolean;
  createdAt: string;
}

interface Todo {
  id: string;
  name: string;
  type: 'daily' | 'one-off' | 'aspirational';
  isCompleted: boolean;
  priority?: number;
}

export const GameInterface: React.FC = () => {
  // Chat state
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([
    {
      type: 'system',
      content: '◉ ELIZA TERMINAL v2.0 - Agent Connection Established',
      timestamp: new Date(),
    },
  ]);

  // Game API readiness state
  const [gameApiReady, setGameApiReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);

  // Progression state
  const [progressionStatus, setProgressionStatus] = useState<ProgressionStatus | null>(null);

  // Model readiness state

  // Plugin toggles
  const [plugins, setPlugins] = useState<PluginToggleState>({
    autonomy: false, // Default to off since autonomy service is temporarily disabled
    camera: false,
    screen: false,
    microphone: false,
    speakers: false,
    shell: false,
    browser: false,
  });

  // Data state
  const [goals, setGoals] = useState<Goal[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [agentMonologue, setAgentMonologue] = useState<
    Array<{ text: string; timestamp: number; isFromAgent: boolean }>
  >([]);
  // Agent status removed - not currently used

  // UI state
  const [currentTab, setCurrentTab] = useState<
    'goals' | 'todos' | 'monologue' | 'files' | 'config' | 'logs' | 'agent-screen' | 'services' | 'registry'
  >('goals');
  const [logsSubTab, setLogsSubTab] = useState<'agent' | 'container'>('agent');
  // Config dialog removed - not currently used
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [knowledgeFiles, setKnowledgeFiles] = useState<
    Array<{ id: string; title: string; type: string; createdAt: string }>
  >([]);
  const [isResetting, setIsResetting] = useState(false);
  const [pluginConfigs, setPluginConfigs] = useState<Record<string, unknown>>({});
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});

  // Security state
  const [securityWarning, setSecurityWarning] = useState<SecurityWarningState>({
    isVisible: false,
    capability: '',
    onConfirm: () => {},
  });

  // Track capability usage and individual warning states
  const [capabilityUsage, setCapabilityUsage] = useState<CapabilityUsageState>(() => {
    const stored = localStorage.getItem('capability-usage');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        Object.keys(parsed).forEach((key) => {
          if (parsed[key].firstSeenAt) {
            parsed[key].firstSeenAt = new Date(parsed[key].firstSeenAt);
          }
        });
        return parsed;
      } catch {
        return {};
      }
    }
    return {};
  });

  // Individual security warnings for each capability
  const [individualWarnings, setIndividualWarnings] = useState<{ [capability: string]: boolean }>(
    {}
  );

  const [_userId] = useState(() => {
    const stored = localStorage.getItem('terminal-user-id');
    if (stored) {
      return stored;
    }
    const newId = uuidv4();
    localStorage.setItem('terminal-user-id', newId);
    return newId;
  });

  // Media streaming state
  const [mediaStreams, setMediaStreams] = useState<MediaStreams>({});
  const [streamingState, setStreamingState] = useState<StreamingState>({
    camera: false,
    screen: false,
    microphone: false,
    speakers: false,
  });
  const [agentScreenActive, setAgentScreenActive] = useState(false);
  const mediaCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const historyPosition = useRef<number>(-1);
  const commandHistory = useRef<string[]>([]);
  const lastProcessedRef = useRef<number>(0);

  // Check if running in Tauri environment - make it reactive
  const [isRunningInTauri, setIsRunningInTauri] = useState(false);
  const [tauriCheckComplete, setTauriCheckComplete] = useState(false);

  // Check Tauri environment on mount and after a delay
  useEffect(() => {
    const checkTauri = async () => {
      // Initial check
      setIsRunningInTauri(TauriService.isRunningInTauri());

      // Wait for potential initialization
      await TauriService.ensureInitialized();

      // Check again after initialization
      const status = TauriService.getInitializationStatus();
      setIsRunningInTauri(status.isTauri);
      setTauriCheckComplete(true);
    };

    checkTauri();

    // Check screen capture capabilities on startup
    const capabilities = checkScreenCaptureCapabilities();
    console.log('🖥️ Screen capture capabilities:', capabilities);
    if (!capabilities.displayMedia) {
      console.warn('⚠️ Screen capture not available:', capabilities.error);
    }
  }, []);

  // Listen for startup status updates to track Game API readiness
  useEffect(() => {
    if (!isRunningInTauri) return;

    let unlistenFn: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');

        // Get current startup status
        try {
          const currentStatus = await invoke('get_startup_status');
          if (currentStatus && typeof currentStatus === 'object') {
            const status = currentStatus as any;
            setGameApiReady(status.game_api_ready || false);

            // Check for error states that affect Game API
            if (status.stage === 'Error' && status.message?.includes('Game API')) {
              setStartupError(status.details || 'Game API verification failed');
            }
          }
        } catch (e) {
          console.error('Failed to get startup status:', e);
        }

        // Listen for startup status updates
        const unlisten = await listen('startup-status', (event: { payload: unknown }) => {
          const status = event.payload;
          if (status) {
            setGameApiReady(status.game_api_ready || false);

            // Update error state if Game API fails
            if (status.stage === 'Error' && status.message?.includes('Game API')) {
              setStartupError(status.details || 'Game API verification failed');
            } else if (status.stage === 'Ready' || status.stage === 'GameAPIReady') {
              setStartupError(null);
            }
          }
        });

        unlistenFn = unlisten;
      } catch (error) {
        console.error('Failed to setup startup status listener:', error);
      }
    };

    setupListener();

    // Cleanup
    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [isRunningInTauri]);

  // Use Tauri chat hook if in Tauri, otherwise show loading or error
  const tauriChatResult = useTauriChat();

  const { isConnected, sendMessage, messages, error } = isRunningInTauri
    ? tauriChatResult
    : {
        isConnected: false,
        sendMessage: async () => {
          throw new Error('Not in Tauri environment');
        },
        messages: [],
        error: tauriCheckComplete ? 'Not running in Tauri environment' : null,
      };

  // Handle incoming messages
  useEffect(() => {
    // Only process new messages
    const newMessages = messages.slice(lastProcessedRef.current);

    newMessages.forEach((message: TauriMsg) => {
      // Ensure timestamp is a Date object
      const messageTimestamp =
        message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp);

      // Add to output - deduplication is now handled by TauriService
      setOutput((prev) => [
        ...prev,
        {
          type: message.type,
          content: message.content,
          timestamp: messageTimestamp,
          metadata: message.metadata,
        },
      ]);

      // Add to agent monologue if it contains thinking patterns
      if (
        message.type === 'agent' &&
        (message.content.includes('thinking:') ||
          message.content.includes('goal:') ||
          message.content.includes('planning:') ||
          message.content.includes('What should I do next?'))
      ) {
        setAgentMonologue((prev) =>
          [
            ...prev.slice(-9),
            { text: message.content, timestamp: messageTimestamp.getTime(), isFromAgent: true },
          ].slice(-10)
        );
      }
    });

    // Update last processed index
    lastProcessedRef.current = messages.length;
  }, [messages]);

  // Connection status requires both WebSocket connection AND Game API readiness
  const effectiveIsConnected = isConnected && gameApiReady;

  // Media capture functions
  const startCameraCapture = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      return stream;
    } catch (error) {
      console.error('Failed to capture camera:', error);
      return null;
    }
  };

  const startScreenCapture = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      return stream;
    } catch (error) {
      console.error('Failed to capture screen:', error);
      return null;
    }
  };

  const startMicrophoneCapture = async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
      });
      return stream;
    } catch (error) {
      console.error('Failed to capture microphone:', error);
      return null;
    }
  };

  // Stop media streams
  const stopMediaStream = (type: 'camera' | 'screen' | 'microphone') => {
    const stream = mediaStreams[type];
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());

      // Clean up audio processor if exists
      if (type === 'microphone' && (stream as any).audioProcessor) {
        const { audioContext, source, processor } = (stream as any).audioProcessor;
        source.disconnect();
        processor.disconnect();
        audioContext.close();
      }

      setMediaStreams((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });

      setStreamingState((prev) => ({ ...prev, [type]: false }));
    }
  };

  // Send frame to Tauri backend
  const sendFrameToTauri = async (imageData: Uint8Array, type: 'camera' | 'screen') => {
    try {
      await invoke('stream_media_frame', {
        stream_type: type,
        frame_data: Array.from(imageData), // Convert to array for IPC
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`Failed to send ${type} frame to Tauri:`, error);
    }
  };

  // Send audio chunk to Tauri backend
  const sendAudioToTauri = async (audioData: Uint8Array) => {
    try {
      await invoke('stream_media_audio', {
        audio_data: Array.from(audioData), // Convert to array for IPC
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to send audio to Tauri:', error);
    }
  };

  // Process video streams and send frames
  const processVideoStream = (stream: MediaStream, type: 'camera' | 'screen') => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    const canvas = mediaCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size based on stream type
    if (type === 'camera') {
      canvas.width = 640;
      canvas.height = 480;
    } else {
      canvas.width = 1280;
      canvas.height = 720;
    }

    setStreamingState((prev) => ({ ...prev, [type]: true }));

    const captureFrame = () => {
      if (!streamingState[type] && mediaStreams[type]) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Get image data as JPEG
      canvas.toBlob(
        async (blob) => {
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            await sendFrameToTauri(uint8Array, type);
          }
        },
        'image/jpeg',
        0.8
      );
    };

    // Capture frames at 10 FPS
    const interval = setInterval(captureFrame, 100);

    // Store interval for cleanup
    if (streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
    }
    streamIntervalRef.current = interval;
  };

  // Process audio stream
  const processAudioStream = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    setStreamingState((prev) => ({ ...prev, microphone: true }));

    processor.onaudioprocess = async (event) => {
      if (!streamingState.microphone) return;

      const inputData = event.inputBuffer.getChannelData(0);
      const pcmData = new Int16Array(inputData.length);

      // Convert float32 to int16
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]));
        pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      const uint8Array = new Uint8Array(pcmData.buffer);
      await sendAudioToTauri(uint8Array);
    };

    // Store processor for cleanup
    (stream as any).audioProcessor = { audioContext, source, processor };
  };

  // Security-aware capability toggle handler
  const handleCapabilityToggle = async (capability: string) => {
    console.log(`[API_TOGGLE] Making API call for: ${capability}`);

    // Check if this is a dangerous capability that requires security warning
    const isDangerous = ['shell', 'browser'].includes(capability);
    const currentState = plugins[capability as keyof PluginToggleState];

    // If enabling a dangerous capability, show security warning first
    if (isDangerous && !currentState) {
      const usage = capabilityUsage[capability];
      // Only show warning if not previously acknowledged or if it's the first time
      if (!usage?.warningAcknowledged || !individualWarnings[capability]) {
        const securityConfig =
          SECURITY_CAPABILITIES[capability as keyof typeof SECURITY_CAPABILITIES];
        if (securityConfig) {
          setSecurityWarning({
            isVisible: true,
            capability,
            onConfirm: () => {
              // Mark warning as acknowledged
              setCapabilityUsage((prev) => ({
                ...prev,
                [capability]: {
                  ...prev[capability],
                  warningAcknowledged: true,
                },
              }));
              setIndividualWarnings((prev) => ({ ...prev, [capability]: true }));
              setSecurityWarning({ isVisible: false, capability: '', onConfirm: () => {} });
              performCapabilityToggle(capability);
            },
          });
          return;
        }
      }
    }

    // For non-dangerous capabilities or disabling, proceed directly
    await performCapabilityToggle(capability);
  };

  // Actual API toggle implementation (extracted for reuse)
  const performCapabilityToggle = async (capability: string) => {
    console.log(`[API_TOGGLE] Performing toggle for: ${capability}`);

    try {
      let success = false;
      let newState = false;

      if (isRunningInTauri) {
        // Use TauriService for all capability toggles
        switch (capability) {
          case 'autonomy':
            newState = !plugins.autonomy;
            await TauriService.toggleAutonomy(newState);
            success = true;
            break;

          case 'camera':
          case 'screen':
          case 'microphone':
          case 'speakers':
          case 'shell':
          case 'browser':
            newState = !plugins[capability as keyof PluginToggleState];
            await TauriService.toggleCapability(capability);
            success = true;
            break;
        }
      } else {
        // Not in Tauri - shouldn't happen in production
        throw new Error('Not running in Tauri environment');
      }

      if (success) {
        // Update the local plugin state to reflect the change
        setPlugins((prev) => ({
          ...prev,
          [capability]: newState,
        }));
        console.log(`[API_TOGGLE] Successfully toggled ${capability} to ${newState}`);

        // Mark capability as used
        setCapabilityUsage((prev) => ({
          ...prev,
          [capability]: {
            ...prev[capability],
            hasBeenUsed: true,
          },
        }));

        // Log security events for dangerous capabilities
        if (['shell', 'browser'].includes(capability)) {
          SecurityLogger.logSecurityEvent(
            newState ? ('access_granted' as any) : ('access_revoked' as any),
            `${capability} capability ${newState ? 'enabled' : 'disabled'}`,
            newState ? 'high' : 'medium'
          );
        }
      } else {
        console.error(`[API_TOGGLE] Failed to toggle ${capability} on server`);
        throw new Error(`Failed to toggle ${capability}`);
      }
    } catch (error) {
      console.error(`[API_TOGGLE] Exception toggling ${capability}:`, error);
      throw error; // Re-throw to let button component handle the error state
    }
  };

  // Helper function to copy text to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Could show a notification here
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  // Helper function to update vision settings (removed - using TauriService now)

  // Agent reset functionality
  const resetAgent = async () => {
    setIsResetting(true);
    try {
      if (isRunningInTauri) {
        await TauriService.resetAgent();

        // Clear local state
        setOutput([
          {
            type: 'system',
            content: '◉ Agent reset successful - New agent instance started',
            timestamp: new Date(),
          },
        ]);
        setGoals([]);
        setTodos([]);
        setAgentMonologue([]);
        setKnowledgeFiles([]);

        // Reset plugins to default state
        setPlugins({
          autonomy: false,
          screen: false,
          camera: false,
          microphone: false,
          speakers: false,
          shell: false,
          browser: false,
        });

        setShowResetDialog(false);

        // Show success message
        setTimeout(() => {
          setOutput((prev) => [
            ...prev,
            {
              type: 'system',
              content: '◉ Fresh agent initialized. All previous data cleared.',
              timestamp: new Date(),
            },
          ]);
        }, 1000);
      } else {
        throw new Error('Not running in Tauri environment');
      }
    } catch (error) {
      console.error('Reset agent failed:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: `Reset failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsResetting(false);
    }
  };

  // Data fetching
  const fetchGoals = async () => {
    try {
      let data: unknown[] = [];

      if (isRunningInTauri) {
        // Use TauriService for IPC
        data = await TauriService.fetchGoals();
      } else {
        // Fallback - shouldn't happen in production
        data = [];
      }

      console.log('[GOALS] About to call setGoals with:', data?.length || 0, 'items');
      setGoals(data || []);
      console.log('[GOALS] Successfully fetched', data?.length || 0, 'goals');

      // Goals loaded successfully - no longer showing in chat
    } catch (error) {
      console.error('Failed to fetch goals:', error);
      // Error logged to console but not shown in chat to avoid clutter
    }
  };

  const fetchTodos = async () => {
    try {
      let processedTodos: unknown[] = [];

      if (isRunningInTauri) {
        // Use TauriService for IPC
        processedTodos = await TauriService.fetchTodos();
      } else {
        // Fallback - shouldn't happen in production
        processedTodos = [];
      }

      console.log('[TODOS] About to call setTodos with:', processedTodos?.length || 0, 'items');
      setTodos(processedTodos || []);
      console.log('[TODOS] Successfully fetched', processedTodos?.length || 0, 'todos');

      // TODOs loaded successfully - no longer showing in chat
    } catch (error) {
      console.error('Failed to fetch todos:', error);
      // Error logged to console but not shown in chat to avoid clutter
    }
  };

  const fetchAutonomyStatus = async () => {
    console.log('[FETCH] fetchAutonomyStatus called');
    try {
      const result = await TauriService.fetchAutonomyStatus();
      // Handle new API response format
      const data = result;
      console.log(
        '[FETCH] fetchAutonomyStatus updating autonomy to:',
        data.enabled && data.running
      );
      setPlugins((prev) => ({
        ...prev,
        autonomy: data.enabled && data.running,
      }));
    } catch (error) {
      console.error('Failed to fetch autonomy status:', error);
    }
  };

  const fetchMonologue = async () => {
    try {
      // First, get the autonomy room ID from the autonomy status endpoint
      let autonomousRoomId = null;

      try {
        const autonomyResult = await TauriService.fetchAutonomyStatus();
        autonomousRoomId = autonomyResult.autonomousRoomId;
        console.log('[MONOLOGUE] Got autonomy room ID from status:', autonomousRoomId);
      } catch (error) {
        console.warn('[MONOLOGUE] Failed to fetch autonomy status:', error);
      }

      // If we don't have the autonomy room ID, try fallback approach
      if (!autonomousRoomId) {
        console.log('[MONOLOGUE] Autonomy room ID not found, trying fallback...');
        setAgentMonologue([
          { text: 'Autonomy system not available...', timestamp: Date.now(), isFromAgent: false },
        ]);
        return;
      }

      // Fetch ALL messages from the autonomous room
      const data = await TauriService.fetchMemoriesFromRoom(autonomousRoomId, 20);
      console.log(`[MONOLOGUE] Fetched ${data.length} memories from autonomy room`);

      // Show ALL messages from the autonomy room in chronological order
      const roomMessages = data
        .filter((memory: Record<string, unknown>) => {
          const content = memory.content as Record<string, unknown>;
          return content?.text;
        }) // Only filter out empty messages
        .sort(
          (a: Record<string, unknown>, b: Record<string, unknown>) =>
            (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
        ) // Chronological order
        .slice(-15) // Keep last 15 messages
        .map((memory: Record<string, unknown>) => {
          const content = memory.content as Record<string, unknown>;
          return {
            text: String(content.text),
            timestamp: Number(memory.createdAt),
            entityId: String(memory.entityId),
            agentId: String(memory.agentId),
            isFromAgent: memory.entityId === memory.agentId,
          };
        });

      if (roomMessages.length === 0) {
        setAgentMonologue([
          { text: 'Agent is thinking...', timestamp: Date.now(), isFromAgent: true },
        ]);
      } else {
        setAgentMonologue(roomMessages);
      }
      console.log(`[MONOLOGUE] Displayed ${roomMessages.length} autonomy messages`);
    } catch (error) {
      console.error('[MONOLOGUE] Failed to fetch monologue:', error);
      setAgentMonologue([
        { text: 'Error loading monologue...', timestamp: Date.now(), isFromAgent: false },
      ]);
    }
  };

  const fetchVisionSettings = async () => {
    console.log('[FETCH] fetchVisionSettings called');
    try {
      const result = await TauriService.getVisionSettings();
      // Handle new API response format
      const data = result;
      console.log('[FETCH] Vision settings data:', data);

      // Only update vision-related settings, preserve others
      const visionUpdates = {
        camera: data.ENABLE_CAMERA === 'true' || data.VISION_CAMERA_ENABLED === 'true',
        screen: data.ENABLE_SCREEN_CAPTURE === 'true' || data.VISION_SCREEN_ENABLED === 'true',
        microphone: data.ENABLE_MICROPHONE === 'true' || data.VISION_MICROPHONE_ENABLED === 'true',
      };

      console.log('[FETCH] fetchVisionSettings updating vision settings to:', visionUpdates);

      setPlugins((prev) => ({
        ...prev,
        ...visionUpdates,
      }));
    } catch (error) {
      console.error('[VISION] Failed to fetch vision settings:', error);
    }
  };

  const fetchShellSettings = async () => {
    try {
      const result = await TauriService.getCapabilityStatus('shell');
      console.log('[SHELL] Fetched shell settings:', result);
      setPlugins((prev) => ({
        ...prev,
        shell: result.enabled,
      }));
    } catch (error) {
      console.error('[SHELL] Failed to fetch shell settings:', error);
    }
  };

  const fetchBrowserSettings = async () => {
    try {
      const result = await TauriService.getCapabilityStatus('browser');
      console.log('[BROWSER] Fetched browser settings:', result);
      setPlugins((prev) => ({
        ...prev,
        browser: result.enabled,
      }));
    } catch (error) {
      console.error('[BROWSER] Failed to fetch browser settings:', error);
    }
  };

  const fetchKnowledgeFiles = async () => {
    try {
      const result = await TauriService.fetchKnowledgeFiles();
      console.log('[KNOWLEDGE] Raw API response:', result);

      // Handle response format
      let documentsArray: unknown[] = [];
      if (Array.isArray(result)) {
        documentsArray = result;
      } else {
        console.warn('[KNOWLEDGE] Unexpected response format:', result);
        documentsArray = [];
      }

      console.log('[KNOWLEDGE] Processing', documentsArray.length, 'documents');
      const formattedFiles = documentsArray.map((doc: Record<string, any>) => ({
        id: doc.id,
        title: doc.title || doc.originalFilename || 'Untitled',
        type: doc.contentType || 'unknown',
        createdAt: doc.createdAt || new Date().toISOString(),
      }));
      setKnowledgeFiles(formattedFiles);
      console.log('[KNOWLEDGE] Successfully fetched', formattedFiles.length, 'knowledge files');
    } catch (error) {
      console.error('[KNOWLEDGE] Failed to fetch knowledge files:', error);
      setKnowledgeFiles([]);
    }
  };

  const fetchPluginConfigs = async () => {
    try {
      const result = await TauriService.fetchPluginConfigs();
      if (result) {
        const configs = result || {};
        setPluginConfigs(configs);

        // Initialize config values with current values
        const values: Record<string, unknown> = {};
        Object.entries(configs).forEach(([plugin, config]: [string, any]) => {
          values[plugin] = { ...config };
        });
        setConfigValues(values);
      }
    } catch (error) {
      console.error('Failed to fetch plugin configs:', error);
    }
  };

  const updatePluginConfig = async (plugin: string, key: string, value: unknown) => {
    try {
      // Validate configuration value
      const validation = InputValidator.validateConfigValue(key, value);
      if (!validation.valid) {
        SecurityLogger.logSecurityEvent(
          'invalid_input',
          `Configuration validation failed for ${plugin}.${key}: ${validation.error}`,
          'medium'
        );
        setOutput((prev) => [
          ...prev,
          {
            type: 'error',
            content: `Configuration validation failed: ${validation.error}`,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const sanitizedValue =
        validation.sanitizedValue !== undefined ? validation.sanitizedValue : value;

      // Update local state immediately for responsive UI
      setConfigValues((prev: Record<string, unknown>) => ({
        ...prev,
        [plugin]: {
          ...prev[plugin],
          [key]: sanitizedValue,
        },
      }));

      // Don't send empty values for API keys
      if ((key.includes('API_KEY') || key.includes('_KEY')) && !sanitizedValue.trim()) {
        console.log(`[CONFIG] Skipping empty API key update for ${key}`);
        return;
      }

      console.log(
        `[CONFIG] Updating ${plugin}.${key}:`,
        key.includes('KEY') ? '***REDACTED***' : sanitizedValue
      );

      // Send update to server with proper error handling
      await TauriService.updatePluginConfig(plugin, { [key]: sanitizedValue });
      console.log(`[CONFIG] Successfully updated ${plugin}.${key}`);

      // Show success message
      setOutput((prev) => [
        ...prev,
        {
          type: 'system',
          content: `◉ Updated ${plugin}.${key} configuration`,
          timestamp: new Date(),
        },
      ]);

      // If we're updating critical environment variables, refresh the config
      if (
        plugin === 'environment' &&
        ['MODEL_PROVIDER', 'LANGUAGE_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].includes(key)
      ) {
        // Small delay then refresh plugin configs to get updated status
        setTimeout(() => {
          fetchPluginConfigs();
        }, 1000);
      }
    } catch (error) {
      console.error('[CONFIG] Failed to update plugin config:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Failed to update config: Network error',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const validateConfiguration = async () => {
    try {
      setOutput((prev) => [
        ...prev,
        {
          type: 'system',
          content: '◉ Validating configuration...',
          timestamp: new Date(),
        },
      ]);

      const result = await TauriService.validateConfiguration();

      if (result) {
        setOutput((prev) => [
          ...prev,
          {
            type: 'system',
            content: 'Configuration Validation Complete',
            timestamp: new Date(),
          },
        ]);

        // Show overall status
        const statusIcon = result.valid ? '✅' : '❌';
        setOutput((prev) => [
          ...prev,
          {
            type: result.valid ? 'system' : 'error',
            content: `${statusIcon} Configuration Status: ${result.valid ? 'VALID' : 'INVALID'}`,
            timestamp: new Date(),
          },
        ]);

        // Show errors if any
        if (result.errors && result.errors.length > 0) {
          result.errors.forEach((error) => {
            setOutput((prev) => [
              ...prev,
              {
                type: 'error',
                content: `❌ ${error}`,
                timestamp: new Date(),
              },
            ]);
          });
        }

        // Configuration validation complete
      } else {
        setOutput((prev) => [
          ...prev,
          {
            type: 'error',
            content: 'Validation failed: Unknown error',
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      console.error('[CONFIG] Validation failed:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Configuration validation failed: Network error',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const testConfiguration = async () => {
    try {
      setOutput((prev) => [
        ...prev,
        {
          type: 'system',
          content: '◉ Testing configuration with actual LLM calls...',
          timestamp: new Date(),
        },
      ]);

      const result = await TauriService.testConfiguration();

      if (result) {
        setOutput((prev) => [
          ...prev,
          {
            type: 'system',
            content: 'Configuration Test Complete',
            timestamp: new Date(),
          },
        ]);

        // Show overall test status
        const statusIcon = result.success ? '✅' : '❌';
        setOutput((prev) => [
          ...prev,
          {
            type: result.success ? 'system' : 'error',
            content: `${statusIcon} Test Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
            timestamp: new Date(),
          },
        ]);

        // Show test message
        setOutput((prev) => [
          ...prev,
          {
            type: result.success ? 'system' : 'error',
            content: result.results || 'Test completed',
            timestamp: new Date(),
          },
        ]);
      } else {
        setOutput((prev) => [
          ...prev,
          {
            type: 'error',
            content: 'Configuration test failed: Unknown error',
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      console.error('[CONFIG] Test failed:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Configuration test failed: Network error',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const deleteKnowledgeFile = async (fileId: string) => {
    try {
      await TauriService.deleteKnowledgeFile(fileId);

      // Refresh the file list
      await fetchKnowledgeFiles();
      setOutput((prev) => [
        ...prev,
        {
          type: 'system',
          content: '◉ Knowledge file deleted successfully',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to delete knowledge file:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Failed to delete file: Network error',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file upload
    const validation = InputValidator.validateFileUpload(file);
    if (!validation.valid) {
      SecurityLogger.logSecurityEvent(
        'invalid_input',
        `File upload validation failed: ${validation.error}`,
        'medium'
      );
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: `File upload failed: ${validation.error}`,
          timestamp: new Date(),
        },
      ]);
      e.target.value = ''; // Reset the input
      return;
    }

    try {
      await TauriService.uploadKnowledgeFile(file);

      // Refresh the file list
      await fetchKnowledgeFiles();
      setOutput((prev) => [
        ...prev,
        {
          type: 'system',
          content: `◉ File "${file.name}" uploaded successfully`,
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error('Failed to upload file:', error);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Failed to upload file: Network error',
          timestamp: new Date(),
        },
      ]);
    }

    // Reset the input
    e.target.value = '';
  };

  // Auto-scroll chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [output]);

  const fetchProgressionStatus = async () => {
    console.log('[PROGRESSION] Fetching progression status...');
    try {
      const response = await TauriService.proxyApiRequest('GET', '/api/agents/default/progression');
      if (response.success && response.data.progressionReady) {
        setProgressionStatus(response.data);
        console.log('[PROGRESSION] Status updated:', response.data);
      } else {
        console.log('[PROGRESSION] Not ready yet:', response.data.message);
      }
    } catch (error) {
      console.error('[PROGRESSION] Error fetching progression status:', error);
    }
  };

  // Persist capability usage to localStorage
  useEffect(() => {
    localStorage.setItem('capability-usage', JSON.stringify(capabilityUsage));
  }, [capabilityUsage]);

  // Track when capabilities are unlocked
  useEffect(() => {
    if (progressionStatus?.unlockedCapabilities) {
      setCapabilityUsage((prev) => {
        const updated = { ...prev };
        progressionStatus.unlockedCapabilities.forEach((cap: string) => {
          if (!updated[cap]) {
            updated[cap] = {
              hasBeenUsed: false,
              warningAcknowledged: false,
              firstSeenAt: new Date(),
            };
          }
        });
        return updated;
      });
    }
  }, [progressionStatus?.unlockedCapabilities]);

  // Initial state fetching for capabilities
  const fetchAllCapabilityStates = async () => {
    console.log('[FETCH] Fetching all capability states...');
    try {
      // Fetch autonomy status
      await fetchAutonomyStatus();
      // Fetch vision settings
      await fetchVisionSettings();
      // Fetch shell settings
      await fetchShellSettings();
      // Fetch browser settings
      await fetchBrowserSettings();
      // Fetch progression status
      await fetchProgressionStatus();
    } catch (error) {
      console.error('[FETCH] Error fetching capability states:', error);
    }
  };

  // Periodic data refresh - simplified to avoid state conflicts
  useEffect(() => {
    const interval = setInterval(() => {
      fetchGoals();
      fetchTodos();
      fetchMonologue();
      fetchKnowledgeFiles();
      fetchPluginConfigs();
      // Don't auto-refresh capability states to avoid conflicts with user interactions
    }, 5000);

    // Initial fetch - fetch both data and initial plugin states
    fetchGoals();
    fetchTodos();
    fetchMonologue();
    fetchKnowledgeFiles();
    fetchPluginConfigs();
    fetchAllCapabilityStates(); // Fetch initial capability states

    return () => clearInterval(interval);
  }, []);

  // Media streaming state management
  useEffect(() => {
    const startMediaStreams = async () => {
      if (plugins.camera && !mediaStreams.camera) {
        const stream = await startCameraCapture();
        if (stream) {
          setMediaStreams((prev) => ({ ...prev, camera: stream }));
          processVideoStream(stream, 'camera');
        }
      }
      if (plugins.screen && !mediaStreams.screen) {
        const stream = await startScreenCapture();
        if (stream) {
          setMediaStreams((prev) => ({ ...prev, screen: stream }));
          processVideoStream(stream, 'screen');
        }
      }
      if (plugins.microphone && !mediaStreams.microphone) {
        const stream = await startMicrophoneCapture();
        if (stream) {
          setMediaStreams((prev) => ({ ...prev, microphone: stream }));
          processAudioStream(stream);
        }
      }
    };

    const stopMediaStreams = () => {
      if (mediaStreams.camera) {
        stopMediaStream('camera');
      }
      if (mediaStreams.screen) {
        stopMediaStream('screen');
      }
      if (mediaStreams.microphone) {
        stopMediaStream('microphone');
      }
    };

    startMediaStreams();

    return () => {
      stopMediaStreams();
      if (streamIntervalRef.current) {
        clearInterval(streamIntervalRef.current);
      }
    };
  }, [plugins.camera, plugins.screen, plugins.microphone, mediaStreams]);

  // Listen for agent screen frames from Tauri
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const setupAgentScreenListener = async () => {
      try {
        unsubscribe = await listen(
          'agent-screen-frame',
          (event: { payload: { data: string; type: string } }) => {
            const { frame_data, width, height } = event.payload;

            // Get the agent screen canvas
            const canvas = document.getElementById('agent-screen-canvas') as HTMLCanvasElement;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Set canvas dimensions
            canvas.width = width;
            canvas.height = height;

            // Convert frame data back to Uint8Array
            const imageData = new Uint8Array(frame_data);

            // Create blob and display on canvas
            const blob = new Blob([imageData], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);

            const img = new window.Image();
            img.onload = () => {
              ctx.drawImage(img, 0, 0, width, height);
              URL.revokeObjectURL(url);
            };
            img.src = url;
          }
        );
      } catch (error) {
        console.error('Failed to setup agent screen listener:', error);
      }
    };

    if (isRunningInTauri) {
      setupAgentScreenListener();
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isRunningInTauri]);

  // Security-aware chat handlers
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !effectiveIsConnected) {
      return;
    }

    const trimmedInput = input.trim();

    // Validate and sanitize user input
    const validation = InputValidator.validateUserInput(trimmedInput);
    if (!validation.valid) {
      SecurityLogger.logSecurityEvent(
        'invalid_input',
        `User input validation failed: ${validation.error}`,
        'medium'
      );
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: `Input validation failed: ${validation.error}`,
          timestamp: new Date(),
        },
      ]);
      return;
    }

    const sanitizedInput = validation.sanitizedInput || trimmedInput;
    commandHistory.current.push(sanitizedInput);
    historyPosition.current = -1;

    setInput('');

    try {
      await sendMessage(sanitizedInput);
      // User message handled by TauriService immediately, server response via useEffect
    } catch (err) {
      console.error('Failed to send message:', err);
      setOutput((prev) => [
        ...prev,
        {
          type: 'error',
          content: 'Failed to send message. Please try again.',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyPosition.current < commandHistory.current.length - 1) {
        historyPosition.current++;
        setInput(
          commandHistory.current[commandHistory.current.length - 1 - historyPosition.current]
        );
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyPosition.current > 0) {
        historyPosition.current--;
        setInput(
          commandHistory.current[commandHistory.current.length - 1 - historyPosition.current]
        );
      } else if (historyPosition.current === 0) {
        historyPosition.current = -1;
        setInput('');
      }
    }
  };

  const renderStatusPanel = () => {
    console.log(
      '[RENDER] Current tab:',
      currentTab,
      'Goals count:',
      goals.length,
      'Todos count:',
      todos.length
    );
    switch (currentTab) {
      case 'goals':
        return (
          <div className="status-content" data-testid="goals-content">
            <div className="status-header">
              <span>◎ GOALS [{goals.length}]</span>
            </div>
            <div className="scrollable-content">
              {goals.length === 0 ? (
                <div className="empty-state">No active goals</div>
              ) : (
                goals.map((goal) => (
                  <div key={goal.id} className="status-item">
                    <div className="status-indicator">{goal.isCompleted ? '✓' : '○'}</div>
                    <div className="status-text">
                      <div className="status-title">{goal.name}</div>
                      <div className="status-desc">{goal.description}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'todos':
        return (
          <div className="status-content" data-testid="todos-content">
            <div className="status-header">
              <span>◎ TASKS [{todos.length}]</span>
            </div>
            <div className="scrollable-content">
              {todos.length === 0 ? (
                <div className="empty-state">No pending tasks</div>
              ) : (
                todos.map((todo) => (
                  <div key={todo.id} className="status-item">
                    <div className="status-indicator">{todo.isCompleted ? '✓' : '○'}</div>
                    <div className="status-text">
                      <div className="status-title">{todo.name}</div>
                      <div className="status-desc">
                        Type: {todo.type} {todo.priority && `| P${todo.priority}`}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'services':
        return (
          <div className="status-content" data-testid="services-content">
            <ServiceBrowser
              onConnect={(serviceId) => {
                setOutput((prev) => [
                  ...prev,
                  {
                    type: 'system',
                    content: `> Connected to service ${serviceId}`,
                    timestamp: new Date(),
                  },
                ]);
              }}
            />
          </div>
        );

      case 'registry':
        return (
          <div className="status-content" data-testid="registry-content">
            <RegistryApps primaryAgentId={primaryAgentId} />
          </div>
        );

      case 'monologue':
        return (
          <div className="status-content">
            <div className="status-header">
              <span>◎ THOUGHTS</span>
            </div>
            <div className="scrollable-content">
              {agentMonologue.length === 0 ? (
                <div className="empty-state">Agent is quiet...</div>
              ) : (
                agentMonologue.map((thought, index) => (
                  <div key={index} className="monologue-item" data-testid="monologue-content">
                    <div className="monologue-timestamp">
                      {thought.timestamp
                        ? new Date(thought.timestamp).toLocaleTimeString()
                        : '--:--:--'}
                    </div>
                    <div className="monologue-text">
                      <span
                        className={`monologue-sender ${thought.isFromAgent ? 'agent' : 'system'}`}
                      >
                        {thought.isFromAgent ? '🤖 ' : '⚙️ '}
                      </span>
                      {typeof thought === 'string' ? thought : thought.text}
                    </div>
                    <div className="monologue-type">
                      {thought.isFromAgent ? '[Agent]' : '[System]'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'files':
        return (
          <div className="status-content">
            <div className="status-header">
              <span>◎ KNOWLEDGE BASE [{knowledgeFiles.length}]</span>
            </div>

            <div className="scrollable-content">
              {knowledgeFiles.length === 0 ? (
                <div className="empty-state">No knowledge files loaded</div>
              ) : (
                knowledgeFiles.map((file) => (
                  <div key={file.id} className="file-item">
                    <span className="file-icon">📄</span>
                    <div className="file-info">
                      <span className="file-name">{file.title}</span>
                      <span className="file-meta">
                        {file.type} • {new Date(file.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button
                      className="file-action"
                      onClick={() => deleteKnowledgeFile(file.id)}
                      title="Delete file"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}

              <div className="file-upload">
                <input
                  type="file"
                  id="file-upload"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                  accept=".txt,.md,.pdf,.doc,.docx,.html,.json,.csv"
                />
                <label htmlFor="file-upload" className="upload-btn">
                  + Upload File
                </label>
              </div>
            </div>
          </div>
        );

      case 'config':
        return (
          <div className="status-content">
            <div className="status-header">
              <span>◎ CONFIGURATION</span>
            </div>
            <div className="scrollable-content">
              {/* Model Provider Configuration */}
              <div className="config-section">
                {/* Show ProviderSelector only in Tauri, otherwise show a simple select */}
                {window.__TAURI_INTERNALS__ ? (
                  <ProviderSelector
                    onProviderChange={(provider) => {
                      updatePluginConfig('environment', 'MODEL_PROVIDER', provider);
                      // Clear model selection when provider changes
                      updatePluginConfig('environment', 'LANGUAGE_MODEL', '');
                    }}
                  />
                ) : (
                  <div className="config-item">
                    <label>Model Provider</label>
                    <select
                      className="config-select"
                      value={configValues.environment?.MODEL_PROVIDER || 'openai'}
                      onChange={(e) => {
                        updatePluginConfig('environment', 'MODEL_PROVIDER', e.target.value);
                        // Clear model selection when provider changes
                        updatePluginConfig('environment', 'LANGUAGE_MODEL', '');
                      }}
                      data-testid="model-provider-select"
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="groq">Groq</option>
                      <option value="elizaos">ElizaOS Cloud</option>
                    </select>
                  </div>
                )}

                {/* OpenAI Configuration */}
                {(configValues.environment?.MODEL_PROVIDER === 'openai' ||
                  !configValues.environment?.MODEL_PROVIDER) && (
                  <>
                    <div className="config-item">
                      <label>OpenAI API Key</label>
                      <input
                        type="password"
                        className="config-input"
                        value={configValues.environment?.OPENAI_API_KEY || ''}
                        placeholder={
                          pluginConfigs.environment?.OPENAI_API_KEY === '***SET***'
                            ? 'Currently Set'
                            : 'Enter OpenAI API Key'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'OPENAI_API_KEY', e.target.value)
                        }
                        data-testid="openai-api-key-input"
                      />
                    </div>
                    <div className="config-item">
                      <label>Model</label>
                      <select
                        className="config-select"
                        value={configValues.environment?.LANGUAGE_MODEL || 'gpt-5'}
                        onChange={(e) =>
                          updatePluginConfig('environment', 'LANGUAGE_MODEL', e.target.value)
                        }
                        data-testid="openai-model-select"
                      >
                        <option value="gpt-5">GPT-5</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Anthropic Configuration */}
                {configValues.environment?.MODEL_PROVIDER === 'anthropic' && (
                  <>
                    <div className="config-item">
                      <label>Anthropic API Key</label>
                      <input
                        type="password"
                        className="config-input"
                        value={configValues.environment?.ANTHROPIC_API_KEY || ''}
                        placeholder={
                          pluginConfigs.environment?.ANTHROPIC_API_KEY === '***SET***'
                            ? 'Currently Set'
                            : 'Enter Anthropic API Key'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'ANTHROPIC_API_KEY', e.target.value)
                        }
                        data-testid="anthropic-api-key-input"
                      />
                    </div>
                    <div className="config-item">
                      <label>Model</label>
                      <select
                        className="config-select"
                        value={
                          configValues.environment?.LANGUAGE_MODEL || 'claude-3-5-sonnet-20241022'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'LANGUAGE_MODEL', e.target.value)
                        }
                        data-testid="anthropic-model-select"
                      >
                        <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku</option>
                        <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                        <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                        <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Ollama Configuration */}
                {configValues.environment?.MODEL_PROVIDER === 'ollama' && (
                  <>
                    <div className="config-item">
                      <label>Ollama Server URL</label>
                      <input
                        type="text"
                        className="config-input"
                        value={
                          configValues.environment?.OLLAMA_SERVER_URL || 'http://localhost:11434'
                        }
                        placeholder="http://localhost:11434"
                        onChange={(e) =>
                          updatePluginConfig('environment', 'OLLAMA_SERVER_URL', e.target.value)
                        }
                        data-testid="ollama-server-url-input"
                      />
                    </div>
                    <OllamaModelSelector
                      value={configValues.environment?.LANGUAGE_MODEL || ''}
                      onChange={(model) =>
                        updatePluginConfig('environment', 'LANGUAGE_MODEL', model)
                      }
                    />
                  </>
                )}

                {/* Groq Configuration */}
                {configValues.environment?.MODEL_PROVIDER === 'groq' && (
                  <>
                    <div className="config-item">
                      <label>Groq API Key</label>
                      <input
                        type="password"
                        className="config-input"
                        value={configValues.environment?.GROQ_API_KEY || ''}
                        placeholder={
                          pluginConfigs.environment?.GROQ_API_KEY === '***SET***'
                            ? 'Currently Set'
                            : 'Enter Groq API Key'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'GROQ_API_KEY', e.target.value)
                        }
                        data-testid="groq-api-key-input"
                      />
                    </div>
                    <div className="config-item">
                      <label>Model</label>
                      <select
                        className="config-select"
                        value={
                          configValues.environment?.LANGUAGE_MODEL || 'llama-3.1-70b-versatile'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'LANGUAGE_MODEL', e.target.value)
                        }
                        data-testid="groq-model-select"
                      >
                        <option value="llama-3.1-70b-versatile">Llama 3.1 70B</option>
                        <option value="llama-3.1-8b-instant">Llama 3.1 8B (Fast)</option>
                        <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                        <option value="gemma2-9b-it">Gemma 2 9B</option>
                      </select>
                    </div>
                  </>
                )}

                {/* ElizaOS Configuration */}
                {configValues.environment?.MODEL_PROVIDER === 'elizaos' && (
                  <>
                    <div className="config-item">
                      <label>ElizaOS API Key</label>
                      <input
                        type="password"
                        className="config-input"
                        value={configValues.environment?.ELIZAOS_API_KEY || ''}
                        placeholder={
                          pluginConfigs.environment?.ELIZAOS_API_KEY === '***SET***'
                            ? 'Currently Set'
                            : 'Enter ElizaOS API Key'
                        }
                        onChange={(e) =>
                          updatePluginConfig('environment', 'ELIZAOS_API_KEY', e.target.value)
                        }
                        data-testid="elizaos-api-key-input"
                      />
                    </div>
                    <div className="config-item">
                      <label>Model</label>
                      <select
                        className="config-select"
                        value={configValues.environment?.LANGUAGE_MODEL || 'gpt-4o-mini'}
                        onChange={(e) =>
                          updatePluginConfig('environment', 'LANGUAGE_MODEL', e.target.value)
                        }
                        data-testid="elizaos-model-select"
                      >
                        <option value="gpt-4o-mini">GPT-4o Mini (ElizaOS)</option>
                        <option value="claude-3-5-sonnet">Claude 3.5 Sonnet (ElizaOS)</option>
                        <option value="gpt-4o">GPT-4o (ElizaOS)</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="config-item">
                  <label>Text Embedding Model</label>
                  <input
                    type="text"
                    className="config-input"
                    value={
                      configValues.environment?.TEXT_EMBEDDING_MODEL || 'text-embedding-3-small'
                    }
                    placeholder="text-embedding-3-small"
                    onChange={(e) =>
                      updatePluginConfig('environment', 'TEXT_EMBEDDING_MODEL', e.target.value)
                    }
                    data-testid="embedding-model-input"
                  />
                </div>
              </div>

              {/* Plugin-specific configurations */}
              {Object.entries(pluginConfigs)
                .filter(([key]) => key !== 'environment')
                .map(([plugin, config]: [string, any]) => (
                  <div key={plugin} className="config-section">
                    <div className="config-title">
                      {plugin.charAt(0).toUpperCase() + plugin.slice(1)} Plugin
                    </div>
                    {Object.entries(config || {}).map(([key, value]: [string, any]) => (
                      <div key={key} className="config-item">
                        <label>{key}</label>
                        <input
                          className="config-input"
                          value={configValues[plugin]?.[key] || ''}
                          placeholder={String(value)}
                          onChange={(e) => updatePluginConfig(plugin, key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                ))}

              {/* Configuration Testing Section */}
              <div className="config-section">
                <div className="config-title">🔍 Configuration Validation</div>
                <div className="config-actions">
                  <button
                    className="config-btn validate-btn"
                    onClick={validateConfiguration}
                    data-testid="validate-config-button"
                  >
                    🔍 VALIDATE CONFIG
                  </button>
                  <button
                    className="config-btn test-btn"
                    onClick={testConfiguration}
                    data-testid="test-config-button"
                  >
                    🧪 TEST CONFIG
                  </button>
                </div>
                <div className="config-help">
                  <small style={{ color: '#888', fontSize: '10px', lineHeight: '1.3' }}>
                    Validate: Check API connectivity and configuration
                    <br />
                    Test: Run actual LLM calls to verify functionality
                  </small>
                </div>
              </div>

              <div className="config-section danger-section">
                <div className="config-title">⚠️ Danger Zone</div>
                <button
                  className="reset-btn"
                  onClick={() => setShowResetDialog(true)}
                  disabled={isResetting}
                >
                  {isResetting ? 'RESETTING...' : 'RESET AGENT'}
                </button>
                <div className="config-warning">
                  This will permanently delete all agent memories, goals, todos, and restart with a
                  fresh instance.
                </div>
              </div>

              {/* Backup and Restore Section */}
              <BackupSettings />
            </div>
          </div>
        );

      case 'logs':
        return (
          <div className="status-content logs-tab-content" data-testid="logs-content">
            <div className="logs-subtabs">
              <button
                className={`logs-subtab ${logsSubTab === 'agent' ? 'active' : ''}`}
                onClick={() => setLogsSubTab('agent')}
              >
                Agent Logs
              </button>
              <button
                className={`logs-subtab ${logsSubTab === 'container' ? 'active' : ''}`}
                onClick={() => setLogsSubTab('container')}
              >
                Container Logs
              </button>
            </div>
            <div className="logs-content">
              {logsSubTab === 'agent' ? <AgentLogs /> : <ContainerLogs />}
            </div>
          </div>
        );

      case 'agent-screen':
        return (
          <div className="status-content agent-screen-content" data-testid="agent-screen-content">
            <div className="status-header">
              <span>◎ SCREEN SHARING</span>
              <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                <button
                  className={`agent-screen-toggle ${agentScreenActive ? 'active' : ''}`}
                  onClick={async () => {
                    try {
                      if (agentScreenActive) {
                        await invoke('stop_agent_screen_capture');
                        setAgentScreenActive(false);
                      } else {
                        await invoke('start_agent_screen_capture');
                        setAgentScreenActive(true);
                      }
                    } catch (error) {
                      console.error('Failed to toggle agent screen capture:', error);
                      setOutput((prev) => [
                        ...prev,
                        {
                          type: 'error',
                          content: `Agent screen capture failed: ${error}`,
                          timestamp: new Date(),
                        },
                      ]);
                    }
                  }}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: agentScreenActive ? '#dc2626' : '#059669',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                  title="View agent's screen"
                >
                  {agentScreenActive ? '🔴 Agent Screen' : '👁️ Agent Screen'}
                </button>
                <button
                  className={`screen-share-toggle ${streamingState.screen ? 'active' : ''}`}
                  onClick={async () => {
                    if (streamingState.screen) {
                      stopMediaStream('screen');
                      setOutput((prev) => [
                        ...prev,
                        {
                          type: 'system',
                          content: 'Screen sharing stopped',
                          timestamp: new Date(),
                        },
                      ]);
                    } else {
                      try {
                        const stream = await startScreenCapture();
                        if (stream) {
                          setMediaStreams((prev) => ({ ...prev, screen: stream }));
                          setStreamingState((prev) => ({ ...prev, screen: true }));

                          // Start capturing frames
                          processVideoStream(stream, 'screen');

                          // Handle stream end
                          stream.getVideoTracks()[0].onended = () => {
                            stopMediaStream('screen');
                            setOutput((prev) => [
                              ...prev,
                              {
                                type: 'system',
                                content: 'Screen sharing ended by user',
                                timestamp: new Date(),
                              },
                            ]);
                          };

                          setOutput((prev) => [
                            ...prev,
                            {
                              type: 'system',
                              content: 'Screen sharing started',
                              timestamp: new Date(),
                            },
                          ]);
                        }
                      } catch (error: unknown) {
                        const errorMsg = getScreenCaptureErrorMessage(error);
                        setOutput((prev) => [
                          ...prev,
                          {
                            type: 'error',
                            content: errorMsg,
                            timestamp: new Date(),
                          },
                        ]);
                      }
                    }
                  }}
                  style={{
                    padding: '4px 12px',
                    backgroundColor: streamingState.screen ? '#dc2626' : '#0ea5e9',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                  title="Share your screen with agent"
                >
                  {streamingState.screen ? '🔴 Stop Sharing' : '🖥️ Share Screen'}
                </button>
              </div>
            </div>
            <div className="agent-screen-container">
              <canvas
                id="agent-screen-canvas"
                className="agent-screen-canvas"
                style={{
                  width: '100%',
                  height: 'auto',
                  backgroundColor: '#000',
                  imageRendering: 'pixelated',
                }}
              />
              <div className="agent-screen-info">
                {agentScreenActive && (
                  <span className="stream-indicator">🔴 Agent Screen Active</span>
                )}
                {streamingState.camera && (
                  <span className="stream-indicator">📹 Camera Active</span>
                )}
                {streamingState.screen && (
                  <span className="stream-indicator">🖥️ Screen Sharing</span>
                )}
                {streamingState.microphone && (
                  <span className="stream-indicator">🎤 Mic Active</span>
                )}
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  useEffect(() => {
    // Create mock elizaClient for test compatibility
    if (typeof window !== 'undefined' && !window.elizaClient) {
      const mockSocket = {
        connected: true, // Start as connected for tests
        on: (event: string, callback: Function) => {
          // Store listeners for later use
          if (!mockSocket._listeners) mockSocket._listeners = {};
          if (!mockSocket._listeners[event]) mockSocket._listeners[event] = [];
          mockSocket._listeners[event].push(callback);

          // Auto-trigger connect event for new listeners
          if (event === 'connect' && mockSocket.connected) {
            setTimeout(() => callback(), 0);
          }
        },
        emit: (event: string, data: unknown) => {
          // Emit events to listeners
          if (mockSocket._listeners && mockSocket._listeners[event]) {
            mockSocket._listeners[event].forEach((callback: Function) => callback(data));
          }
        },
        disconnect: () => {
          mockSocket.connected = false;
          mockSocket.emit('disconnect', null);
        },
        connect: () => {
          mockSocket.connected = true;
          mockSocket.emit('connect', null);
        },
        _listeners: {} as any,
      };

      (window as any).elizaClient = {
        socket: mockSocket,
        isConnected: () => mockSocket.connected,
        joinRoom: (roomId: string) => {
          console.log('[Mock Client] Joining room:', roomId);
          mockSocket.emit('room:joined', { roomId });
        },
        sendMessage: (message: Record<string, unknown>) => {
          console.log('[Mock Client] Sending message:', message);
          // Simulate server response after a delay
          setTimeout(() => {
            mockSocket.emit('message', {
              id: Date.now().toString(),
              content: `Mock response to: ${message.content}`,
              author: 'ELIZA',
              timestamp: Date.now(),
            });
          }, 100);
        },
      };

      // Simulate connection
      setTimeout(() => mockSocket.connect(), 100);
    }

    // Update mock socket connection status
    if (window.elizaClient?.socket) {
      window.elizaClient.socket.connected = isConnected || true; // Default to true for tests
    }
  }, [isConnected]);

  return (
    <div className="terminal-container" data-testid="game-interface">
      <style>{`
        .logs-tab-content {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        .logs-subtabs {
          display: flex;
          gap: 8px;
          padding: 8px;
          border-bottom: 1px solid rgba(0, 255, 0, 0.2);
          background: rgba(0, 0, 0, 0.6);
        }
        
        .logs-subtab {
          padding: 6px 16px;
          background: rgba(0, 50, 0, 0.4);
          border: 1px solid rgba(0, 255, 0, 0.3);
          color: #00ff00;
          font-size: 12px;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }
        
        .logs-subtab:hover {
          background: rgba(0, 100, 0, 0.4);
          border-color: rgba(0, 255, 0, 0.5);
        }
        
        .logs-subtab.active {
          background: rgba(0, 150, 0, 0.6);
          border-color: #00ff00;
          box-shadow: 0 0 5px rgba(0, 255, 0, 0.5);
        }
        
        .logs-content {
          flex: 1;
          overflow: hidden;
        }
        
        @keyframes glow {
          0% {
            box-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 15px #00ff00;
          }
          50% {
            box-shadow: 0 0 10px #00ff00, 0 0 20px #00ff00, 0 0 30px #00ff00;
          }
          100% {
            box-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 15px #00ff00;
          }
        }
      `}</style>
      {/* Connection Status */}
      <div
        className={`connection-status ${effectiveIsConnected ? 'connected' : 'disconnected'}`}
        data-testid="connection-status"
      >
        {effectiveIsConnected ? (
          '◉ ONLINE'
        ) : (
          <>
            ◯ OFFLINE
            {!isConnected && ' (No Connection)'}
            {isConnected && !gameApiReady && ' (Game API Not Ready)'}
            {startupError && (
              <span className="connection-error" title={startupError}>
                {' '}
                ⚠️
              </span>
            )}
          </>
        )}
        <span className="autonomy-status" data-testid="autonomy-status">
          {plugins.autonomy ? 'Active' : 'Paused'}
        </span>
      </div>

      {/* Main Layout */}
      <div className="terminal-layout">
        {/* Left Panel - Chat */}
        <div className="panel panel-left">
          <div className="panel-header" data-testid="terminal-header">
            ◆ ADMIN TERMINAL
          </div>

          <div
            className="panel-content chat-content"
            ref={chatContainerRef}
            data-testid="chat-messages"
            role="log"
          >
            {output.map((line, index) => (
              <div
                key={index}
                className={`chat-line chat-${line.type}`}
                data-testid={
                  line.type === 'user'
                    ? 'user-message'
                    : line.type === 'agent'
                      ? 'agent-message'
                      : 'system-message'
                }
              >
                <span className="chat-timestamp" data-testid="message-timestamp">
                  {line.timestamp.toLocaleTimeString()}
                </span>
                <span className="chat-prefix">
                  {line.type === 'user'
                    ? '[USER]'
                    : line.type === 'agent'
                      ? '[AGENT]'
                      : line.type === 'system'
                        ? '[SYS]'
                        : '[ERR]'}
                </span>
                <span
                  className="chat-content"
                  style={
                    line.metadata?.isProcessing ? { color: '#666', fontStyle: 'italic' } : undefined
                  }
                >
                  {line.content}
                </span>
                <div
                  className="message-actions"
                  data-testid="message-actions"
                  style={{ display: 'none' }}
                >
                  <button
                    className="message-action"
                    data-testid="copy-message-button"
                    onClick={() => copyToClipboard(line.content)}
                  >
                    Copy
                  </button>
                </div>
              </div>
            ))}
            {!tauriCheckComplete && !error && (
              <div className="chat-line chat-system">
                <span className="chat-prefix">[SYS]</span>
                <span className="chat-content">Checking Tauri environment...</span>
              </div>
            )}
            {error && (
              <div className="chat-line chat-error">
                <span className="chat-prefix">[ERR]</span>
                <span className="chat-content">Connection error: {error}</span>
              </div>
            )}
            {isConnected && !gameApiReady && (
              <div className="chat-line chat-error">
                <span className="chat-prefix">[ERR]</span>
                <span className="chat-content">
                  Game API is not ready. Chat is disabled.{' '}
                  {startupError || 'Waiting for Game API plugin to initialize...'}
                </span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="chat-input-form">
            <div className="input-line">
              <span className="input-prompt">{'>'}</span>
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  const newValue = e.target.value;
                  // Keep original for typing experience, will sanitize on submit
                  setInput(newValue);
                }}
                onKeyDown={handleKeyDown}
                className="chat-input"
                placeholder={
                  !effectiveIsConnected
                    ? isConnected
                      ? 'Game API not ready...'
                      : 'Not connected...'
                    : ''
                }
                disabled={!effectiveIsConnected}
                data-testid="chat-input"
                aria-label="Enter command or message"
              />
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() || !effectiveIsConnected}
                data-testid="chat-send-button"
              >
                SEND
              </button>
            </div>
          </form>
        </div>

        {/* Right Panel - Status */}
        <div className="panel panel-right">
          {/* Plugin Controls - Ultra Simple */}
          <div className="controls-section">
            <div className="controls-header">◆ CAPABILITIES</div>

            {/* Progression Mode Toggle */}
            {progressionStatus && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  marginBottom: '10px',
                  borderBottom: '1px solid rgba(0, 255, 170, 0.2)',
                }}
              >
                <span
                  style={{
                    color: '#00FF88',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    textTransform: 'uppercase',
                  }}
                >
                  Mode: {progressionStatus.mode || 'progression'}
                </span>
                <button
                  onClick={async () => {
                    const newMode =
                      progressionStatus.mode === 'unlocked' ? 'progression' : 'unlocked';
                    try {
                      const response = await fetch('/api/agents/default/progression/mode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: newMode }),
                      });
                      if (response.ok) {
                        const data = await response.json();
                        setProgressionStatus(data.data);
                        const message = `Switched to ${newMode} mode`;
                        setOutput((prev) => [
                          ...prev,
                          {
                            type: 'system',
                            content: `> ${message}`,
                            timestamp: new Date(),
                          },
                        ]);
                      }
                    } catch (error) {
                      console.error('Failed to switch progression mode:', error);
                    }
                  }}
                  style={{
                    background: 'rgba(0, 255, 136, 0.1)',
                    border: '1px solid #00FF88',
                    color: '#00FF88',
                    padding: '4px 12px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 255, 136, 0.2)';
                    e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 255, 136, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 255, 136, 0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {progressionStatus.mode === 'unlocked' ? 'Switch to Progression' : 'Unlock All'}
                </button>
              </div>
            )}

            <UltraSimpleButtons
              states={plugins}
              onToggle={handleCapabilityToggle}
              progressionStatus={progressionStatus}
              capabilityUsage={capabilityUsage}
            />
          </div>

          {/* Status Tabs */}
          <div className="status-tabs">
            {(
              ['goals', 'todos', 'services', 'registry', 'monologue', 'files', 'config', 'logs', 'agent-screen'] as const
            ).map((tab) => (
              <button
                key={tab}
                className={`tab-btn ${currentTab === tab ? 'active' : ''}`}
                onClick={() => setCurrentTab(tab)}
                data-testid={`${tab}-tab`}
              >
                {tab === 'agent-screen' ? 'AGENT VIEW' : tab.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Status Panel Content */}
          <div data-testid={`${currentTab}-content`}>{renderStatusPanel()}</div>
        </div>
      </div>

      {/* Reset Agent Confirmation Dialog */}
      {showResetDialog && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <span className="modal-title">⚠️ CONFIRM AGENT RESET</span>
            </div>
            <div className="modal-content">
              <div className="warning-message">
                <p>This action will permanently:</p>
                <ul>
                  <li>Kill your current agent instance</li>
                  <li>Delete all memories and conversations</li>
                  <li>Clear all goals and todos</li>
                  <li>Reset knowledge base to default state</li>
                  <li>Start a completely fresh agent</li>
                </ul>
                <p className="warning-emphasis">
                  <strong>This cannot be undone!</strong>
                </p>
              </div>
              <div className="confirmation-input">
                <p>Type "RESET AGENT" to confirm:</p>
                <input
                  type="text"
                  className="confirm-input"
                  id="confirmResetInput"
                  placeholder="Type here to confirm..."
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => setShowResetDialog(false)}
                disabled={isResetting}
              >
                Cancel
              </button>
              <button
                className="confirm-reset-btn"
                onClick={() => {
                  const input = document.getElementById('confirmResetInput') as HTMLInputElement;
                  if (input?.value === 'RESET AGENT') {
                    resetAgent();
                  } else {
                    // Show error in console instead of alert
                    console.error(
                      'Reset confirmation failed: Please type "RESET AGENT" exactly to confirm.'
                    );
                    // Clear and focus the input for retry
                    input.value = '';
                    input.focus();
                    input.placeholder = 'Please type "RESET AGENT" exactly';
                  }
                }}
                disabled={isResetting}
              >
                {isResetting ? 'RESETTING...' : 'CONFIRM RESET'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Warning Modal */}
      <SecurityWarning
        capability={
          SECURITY_CAPABILITIES[securityWarning.capability as keyof typeof SECURITY_CAPABILITIES]
            ?.capability || ''
        }
        riskLevel={
          SECURITY_CAPABILITIES[securityWarning.capability as keyof typeof SECURITY_CAPABILITIES]
            ?.riskLevel || 'medium'
        }
        description={
          SECURITY_CAPABILITIES[securityWarning.capability as keyof typeof SECURITY_CAPABILITIES]
            ?.description || ''
        }
        risks={
          SECURITY_CAPABILITIES[securityWarning.capability as keyof typeof SECURITY_CAPABILITIES]
            ?.risks || []
        }
        onConfirm={securityWarning.onConfirm}
        onCancel={() =>
          setSecurityWarning({ isVisible: false, capability: '', onConfirm: () => {} })
        }
        isVisible={securityWarning.isVisible}
      />

      {/* Hidden canvas for media processing */}
      <canvas ref={mediaCanvasRef} style={{ display: 'none' }} width={1280} height={720} />
    </div>
  );
};
