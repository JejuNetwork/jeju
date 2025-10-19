import { WebSocketMessage } from '../types/shared';

// Block old WebSocket messages
export function blockOldMessages() {
  console.log('🛡️ Installing WebSocket message blocker...');

  // Intercept WebSocket send method
  const originalSend = WebSocket.prototype.send;

  WebSocket.prototype.send = function (data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    // Try to parse and check the message
    
      let message: WebSocketMessage | null = null;
      if (typeof data === 'string') {
        message = JSON.parse(data) as WebSocketMessage;
      }

      // Block specific message types or content
      if (message && message.type === 'send_message') {
        const messageText = message.message?.text || message.message?.content || '';
        if (messageText.includes('admin has opened the terminal')) {
          console.error('🚫 BLOCKED problematic message!', message);
          console.trace();
          return; // Don't send it
        }
      }
    

    // Allow other messages
    return originalSend.apply(this, [data]);
  };

  console.log('✅ WebSocket message blocker installed');
}
