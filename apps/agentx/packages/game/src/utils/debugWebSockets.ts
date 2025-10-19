import { TauriWindow } from '../types/shared';

// WebSocket debugging utility
export function debugWebSockets() {
  console.log('🔍 Starting WebSocket debugging...');

  // Store the original WebSocket
  const OriginalWebSocket = window.WebSocket;

  // Create a wrapper
  (window as unknown as TauriWindow & Record<string, unknown>).WebSocket = function (
    url: string,
    protocols?: string | string[]
  ) {
    console.log('🔌 New WebSocket connection:', url);

    const ws = new OriginalWebSocket(url, protocols);

    // Intercept send
    const originalSend = ws.send.bind(ws);
    ws.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      console.log('📤 WebSocket send:', data);

      // Check if this is the problematic message
      if (data && data.toString().includes('admin has opened')) {
        console.error('🚨 FOUND THE CULPRIT! Blocking message:', data);
        console.trace(); // This will show us the call stack
        return; // Block the message
      }

      return originalSend(data);
    };

    // Log events
    ws.addEventListener('open', () => console.log('✅ WebSocket opened:', url));
    ws.addEventListener('close', () => console.log('❌ WebSocket closed:', url));
    ws.addEventListener('message', (e: MessageEvent) =>
      console.log('📥 WebSocket received:', e.data)
    );
    ws.addEventListener('error', (e: Event) => console.error('⚠️ WebSocket error:', e));

    return ws;
  };

  console.log('✅ WebSocket debugging enabled');
}
