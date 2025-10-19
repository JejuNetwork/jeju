import { useState, useEffect } from 'react';
import { TauriService, TauriMessage } from '../services/TauriService';

interface UseTauriChatReturn {
  isConnected: boolean;
  sendMessage: (content: string) => Promise<void>;
  messages: TauriMessage[];
  error: string | null;
  isLoading: boolean;
}

// Hook for using Tauri-based chat functionality
export function useTauriChat(): UseTauriChatReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<TauriMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      setIsLoading(true);

      // Give TauriService a moment to detect Tauri environment
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Initialize Tauri service
      await TauriService.initialize();

      // Check if we're in Tauri environment
      if (TauriService.isRunningInTauri()) {
        setIsConnected(true);

        // Load initial messages if any
        const initialMessages = await TauriService.fetchMemories();
        setMessages(initialMessages);

        // Auto-send greeting message after confirming services are ready
        setTimeout(async () => {
          try {
            console.log('[AUTO-GREETING] Checking if agent and Ollama are ready...');

            // Check agent health
            const agentHealth = await TauriService.checkAgentHealth();
            console.log('[AUTO-GREETING] Agent health:', agentHealth);

            // If agent is healthy, send greeting
            if (agentHealth && (agentHealth.status === 'healthy' || agentHealth.success)) {
              console.log('[AUTO-GREETING] Sending hello message to Eliza...');
              await TauriService.sendMessage('hello eliza');
              console.log('[AUTO-GREETING] Greeting sent successfully');
            } else {
              console.log('[AUTO-GREETING] Agent not ready, skipping auto-greeting');
            }
          } catch (error) {
            console.warn('[AUTO-GREETING] Failed to send auto-greeting:', error);
          }
        }, 2000); // Wait 2 seconds for services to be fully ready
      } else {
        setError('Not running in Tauri environment');
      }

      setIsLoading(false);
    };

    initialize();

    // Set up message listener
    const unsubscribe = TauriService.onMessage((message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const sendMessage = async (content: string) => {
    await TauriService.sendMessage(content);
  };

  return {
    isConnected,
    sendMessage,
    messages,
    error,
    isLoading,
  };
}
