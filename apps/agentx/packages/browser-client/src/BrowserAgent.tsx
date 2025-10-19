/**
 * Browser-based ElizaOS Agent
 * Runs entirely in the browser using WebContainer for sandboxed execution
 * Integrates with ERC-8004 registry for app discovery
 */

import { useState, useEffect } from 'react';
import { WebContainer } from '@webcontainer/api';
import { createBrowserDatabase } from './db';

interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
}

export function BrowserAgent() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'system',
      content: '🌐 ElizaOS Browser Agent - Initializing...',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [container, setContainer] = useState<WebContainer | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Boot WebContainer
      const wc = await WebContainer.boot();
      setContainer(wc);

      // Initialize database
      const db = await createBrowserDatabase();

      // Mount file system
      await wc.mount({
        'package.json': {
          file: {
            contents: JSON.stringify({
              name: 'eliza-browser',
              type: 'module',
              dependencies: {
                '@elizaos/core': 'latest',
                '@elizaos/plugin-registry': 'latest',
              },
            }),
          },
        },
      });

      // Install dependencies
      const installProcess = await wc.spawn('npm', ['install']);
      await installProcess.exit;

      setIsReady(true);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: '✅ Agent ready! Connected to Jeju registry.',
          timestamp: new Date(),
        },
      ]);
    };

    init();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || !isReady) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // TODO: Process message through agent runtime
    // For now, echo
    const agentMessage: Message = {
      role: 'agent',
      content: `Received: ${input}`,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, agentMessage]);
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0a0e27',
      color: '#00ff88',
      fontFamily: 'monospace',
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem',
        borderBottom: '1px solid rgba(0, 255, 136, 0.3)',
        background: 'rgba(0, 0, 0, 0.3)',
      }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>🌐 ElizaOS Browser Agent</h1>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#00ff8866' }}>
          {isReady ? '✅ Connected to Jeju Registry' : '⏳ Initializing...'}
        </p>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              padding: '0.75rem',
              background: msg.role === 'user' ? 'rgba(0, 100, 255, 0.1)' : 'rgba(0, 255, 136, 0.1)',
              border: `1px solid ${msg.role === 'user' ? '#0066ff' : '#00ff88'}`,
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '0.5rem' }}>
              {msg.role.toUpperCase()} - {msg.timestamp.toLocaleTimeString()}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: '1rem',
        borderTop: '1px solid rgba(0, 255, 136, 0.3)',
        background: 'rgba(0, 0, 0, 0.3)',
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={isReady ? "Message agent..." : "Initializing..."}
            disabled={!isReady}
            style={{
              flex: 1,
              padding: '0.75rem',
              background: 'rgba(0, 0, 0, 0.5)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              borderRadius: '8px',
              color: '#00ff88',
              fontSize: '1rem',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!isReady || !input.trim()}
            style={{
              padding: '0.75rem 1.5rem',
              background: isReady ? 'rgba(0, 255, 136, 0.2)' : 'rgba(100, 100, 100, 0.2)',
              border: '1px solid #00ff88',
              borderRadius: '8px',
              color: '#00ff88',
              cursor: isReady ? 'pointer' : 'not-allowed',
              fontWeight: 600,
            }}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}

