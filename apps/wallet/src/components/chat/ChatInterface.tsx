/**
 * Chat Interface - ElizaOS Agent Chat
 * 
 * The Network Wallet agent is an ElizaOS agent.
 * Connects to ElizaOS server when available, falls back to inference gateway.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, Check, X, AlertTriangle, Shield, Wallet, ArrowLeftRight, HelpCircle, Sparkles, History, Zap, Cpu, Bot } from 'lucide-react';
import { useWallet, useMultiChainBalances, formatUsd, formatTokenAmount } from '../../hooks/useWallet';
import { inferenceClient, type ChatResponse, type StreamChunk } from '../../lib/inferenceClient';
import { elizaClient } from '../../lib/elizaClient';
import type { Address } from 'viem';

interface Message {
  id: string;
  content: string;
  isAgent: boolean;
  timestamp: number;
  metadata?: {
    requiresConfirmation?: boolean;
    actionType?: string;
    actionData?: Record<string, unknown>;
    riskLevel?: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    actions?: string[];
    tokensUsed?: number;
    latencyMs?: number;
    provider?: string;
  };
}

interface ChatInterfaceProps {
  onActionConfirmed?: (actionType: string, actionData: Record<string, unknown>) => void;
  onActionRejected?: (actionType: string) => void;
  onActionCompleted?: () => void;
}

const QUICK_ACTIONS = [
  { label: 'Portfolio', prompt: 'Show my portfolio', icon: Wallet, color: 'text-emerald-400' },
  { label: 'Swap', prompt: 'I want to swap tokens', icon: ArrowLeftRight, color: 'text-blue-400' },
  { label: 'History', prompt: 'Show my recent transactions', icon: History, color: 'text-purple-400' },
  { label: 'Help', prompt: 'What can you do?', icon: HelpCircle, color: 'text-amber-400' },
];

export function ChatInterface({ onActionConfirmed, onActionRejected, onActionCompleted }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [agentStatus, setAgentStatus] = useState<'eliza' | 'inference' | 'connecting' | 'offline'>('connecting');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { isConnected: walletConnected, address } = useWallet();
  const { aggregatedBalances, totalUsdValue, isLoading: balancesLoading } = useMultiChainBalances(address);

  // Initialize and check available agent backends
  useEffect(() => {
    if (address) {
      inferenceClient.setWalletAddress(address as Address);
    }

    // Check which backend is available: ElizaOS first, then inference gateway
    const checkBackends = async () => {
      // Try ElizaOS first
      const elizaAvailable = await elizaClient.isAvailable();
      if (elizaAvailable) {
        setAgentStatus('eliza');
        return;
      }

      // Fall back to inference gateway
      try {
        const models = await inferenceClient.getModels();
        if (models.length > 0) {
          setAgentStatus('inference');
          return;
        }
      } catch {
        // Inference not available
      }

      setAgentStatus('offline');
    };

    checkBackends();
  }, [address]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Inject wallet context into messages
  const getWalletContext = useCallback((): string => {
    if (!walletConnected || !address) return '';
    if (balancesLoading) return '';

    let context = `\n\nCurrent wallet state:\n- Address: ${address}`;
    context += `\n- Total Portfolio: ${formatUsd(totalUsdValue)}`;
    
    if (aggregatedBalances.length > 0) {
      context += '\n- Holdings:';
      for (const b of aggregatedBalances.slice(0, 5)) {
        context += `\n  • ${b.symbol}: ${formatTokenAmount(b.totalBalance)} (${formatUsd(b.totalUsdValue)})`;
      }
      if (aggregatedBalances.length > 5) {
        context += `\n  • ...and ${aggregatedBalances.length - 5} more`;
      }
    }

    return context;
  }, [walletConnected, address, aggregatedBalances, totalUsdValue, balancesLoading]);

  // Handle sending messages - tries ElizaOS first, then inference gateway
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isTyping) return;

    const userContent = inputValue.trim();
    setInputValue('');
    setIsTyping(true);
    setStreamingContent('');

    // Add user message
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      content: userContent,
      isAgent: false,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Append wallet context to user message for AI
    const contextualContent = userContent + getWalletContext();

    try {
      // Try ElizaOS agent first if available
      if (agentStatus === 'eliza') {
        const walletContext = { address: address || undefined, connected: walletConnected };
        const elizaResponse = await elizaClient.chat(userContent, walletContext);
        const actionData = parseActionFromResponse(elizaResponse.content);
        const agentMsg: Message = {
          id: elizaResponse.id,
          content: elizaResponse.content,
          isAgent: true,
          timestamp: Date.now(),
          metadata: { provider: 'eliza', ...actionData },
        };
        setMessages(prev => [...prev, agentMsg]);
        setIsTyping(false);
        return;
      }

      // Fall back to inference gateway (streaming)
      let fullContent = '';
      let responseData: Partial<ChatResponse> = {};

      for await (const chunk of inferenceClient.chatStream({
        messages: [{ role: 'user', content: contextualContent }],
        temperature: 0.7,
        maxTokens: 2048,
      })) {
        if (chunk.done) {
          responseData.id = chunk.id;
          break;
        }
        fullContent += chunk.content;
        setStreamingContent(fullContent);
      }

      // Clear streaming and add final message
      setStreamingContent('');

      // Check for action triggers in response
      const actionData = parseActionFromResponse(fullContent);

      const agentMsg: Message = {
        id: responseData.id || `agent-${Date.now()}`,
        content: fullContent,
        isAgent: true,
        timestamp: Date.now(),
        metadata: {
          provider: 'inference',
          ...actionData,
        },
      };
      setMessages(prev => [...prev, agentMsg]);

      if (actionData?.actions?.includes('MULTI_STEP_SUMMARY') && onActionCompleted) {
        onActionCompleted();
      }
    } catch (error) {
      console.error('[Chat] Inference error:', error);
      
      // Fallback to local processing
      const fallbackResponse = processLocally(userContent);
      setStreamingContent('');

      const agentMsg: Message = {
        id: `agent-${Date.now()}`,
        content: fallbackResponse,
        isAgent: true,
        timestamp: Date.now(),
        metadata: { provider: 'local' },
      };
      setMessages(prev => [...prev, agentMsg]);
    } finally {
      setIsTyping(false);
    }
  }, [inputValue, isTyping, getWalletContext, onActionCompleted, agentStatus, address, walletConnected]);

  // Parse actions from AI response (swap, send, etc.)
  const parseActionFromResponse = (content: string): Message['metadata'] => {
    const lowerContent = content.toLowerCase();

    // Detect confirmation requests
    if (lowerContent.includes('confirm') && (
      lowerContent.includes('swap') || 
      lowerContent.includes('send') || 
      lowerContent.includes('transfer') ||
      lowerContent.includes('approve')
    )) {
      // Extract action type
      let actionType = 'unknown';
      if (lowerContent.includes('swap')) actionType = 'swap';
      else if (lowerContent.includes('send') || lowerContent.includes('transfer')) actionType = 'send';
      else if (lowerContent.includes('approve')) actionType = 'approve';

      // Basic risk assessment
      let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (lowerContent.includes('unlimited') || lowerContent.includes('all')) riskLevel = 'high';
      if (lowerContent.includes('unknown') || lowerContent.includes('unverified')) riskLevel = 'high';

      return {
        requiresConfirmation: true,
        actionType,
        riskLevel,
        actionData: {},
      };
    }

    return undefined;
  };

  // Fallback when inference API is unavailable - no fake AI responses
  const processLocally = useCallback((_input: string): string => {
    return `**AI Service Unavailable**

The inference server is not responding. To enable AI chat:

1. Set an API key: OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY
2. Start the inference server: \`jeju compute start\`

**You can still use the wallet directly:**
Use the sidebar navigation to access Portfolio, Pools, Perps, Launchpad, Names, and Security features.

Groq offers a free tier at https://console.groq.com/keys`;
  }, []);

  // Handle action confirmation
  const handleConfirm = useCallback((message: Message) => {
    if (message.metadata?.actionType && message.metadata?.actionData) {
      onActionConfirmed?.(message.metadata.actionType, message.metadata.actionData);
    }
    setMessages(prev => [...prev, { 
      id: `c-${Date.now()}`, 
      content: 'Confirmed. Processing your request...', 
      isAgent: true, 
      timestamp: Date.now() 
    }]);
  }, [onActionConfirmed]);

  // Handle action rejection
  const handleReject = useCallback((message: Message) => {
    if (message.metadata?.actionType) {
      onActionRejected?.(message.metadata.actionType);
    }
    setMessages(prev => [...prev, { 
      id: `r-${Date.now()}`, 
      content: 'Cancelled. Let me know if you need anything else.', 
      isAgent: true, 
      timestamp: Date.now() 
    }]);
  }, [onActionRejected]);

  // Clear chat history
  const clearChat = useCallback(() => {
    setMessages([]);
    inferenceClient.clearHistory();
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Status Bar */}
      <div className={`px-4 py-2 flex items-center justify-between border-b ${
        agentStatus === 'eliza' ? 'bg-purple-500/5 border-purple-500/20' :
        agentStatus === 'inference' ? 'bg-emerald-500/5 border-emerald-500/20' : 
        agentStatus === 'connecting' ? 'bg-amber-500/5 border-amber-500/20' :
        'bg-red-500/5 border-red-500/20'
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            agentStatus === 'eliza' ? 'bg-purple-500' :
            agentStatus === 'inference' ? 'bg-emerald-500' : 
            agentStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className={`text-xs ${
            agentStatus === 'eliza' ? 'text-purple-500' :
            agentStatus === 'inference' ? 'text-emerald-500' : 
            agentStatus === 'connecting' ? 'text-amber-500' :
            'text-red-500'
          }`}>
            {agentStatus === 'eliza' ? 'ElizaOS Agent' : 
             agentStatus === 'inference' ? 'Decentralized AI' :
             agentStatus === 'connecting' ? 'Connecting to agent...' :
             'Offline mode (local processing)'}
          </span>
          {agentStatus === 'eliza' && <Bot className="w-3 h-3 text-purple-500" />}
          {agentStatus === 'inference' && <Cpu className="w-3 h-3 text-emerald-500" />}
        </div>
        {messages.length > 0 && (
          <button 
            onClick={clearChat}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {walletConnected ? 'How can I help?' : 'Welcome to the network'}
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              {walletConnected 
                ? 'Ask me anything about your portfolio, swap tokens, or manage your assets.'
                : 'Connect your wallet to get started with your AI-powered wallet assistant.'
              }
            </p>
            
            {walletConnected && (
              <div className="grid grid-cols-2 gap-3 max-w-sm">
                {QUICK_ACTIONS.map(({ label, prompt, icon: Icon, color }) => (
                  <button
                    key={label}
                    onClick={() => { setInputValue(prompt); inputRef.current?.focus(); }}
                    className="flex items-center gap-2 px-4 py-3 bg-card border border-border hover:border-primary/50 rounded-xl transition-all hover:shadow-md"
                  >
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="w-3 h-3" />
              <span>Powered by Network Decentralized Compute</span>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.isAgent ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
              msg.isAgent 
                ? 'bg-card border border-border' 
                : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white'
            }`}>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>
              
              {msg.metadata?.requiresConfirmation && (
                <div className={`mt-4 p-4 rounded-xl border-2 ${
                  msg.metadata.riskLevel === 'high' || msg.metadata.riskLevel === 'critical' 
                    ? 'border-red-500/50 bg-red-500/10' 
                    : 'border-emerald-500/50 bg-emerald-500/10'
                }`}>
                  <div className="flex items-center gap-2 mb-3">
                    {msg.metadata.riskLevel === 'high' || msg.metadata.riskLevel === 'critical'
                      ? <AlertTriangle className="w-5 h-5 text-red-500" />
                      : <Shield className="w-5 h-5 text-emerald-500" />}
                    <span className="font-semibold capitalize text-sm">{msg.metadata.riskLevel || 'safe'} Risk</span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleConfirm(msg)} 
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-sm transition-colors"
                    >
                      <Check className="w-4 h-4" /> Confirm
                    </button>
                    <button 
                      onClick={() => handleReject(msg)} 
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 font-medium text-sm transition-colors"
                    >
                      <X className="w-4 h-4" /> Cancel
                    </button>
                  </div>
                </div>
              )}
              
              <div className={`flex items-center gap-2 text-xs mt-2 ${msg.isAgent ? 'text-muted-foreground' : 'text-white/70'}`}>
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {msg.metadata?.provider && msg.metadata.provider !== 'local' && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {msg.metadata.provider}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-card border border-border">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{streamingContent}</div>
              <div className="flex items-center gap-1 mt-2 text-xs text-emerald-500">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Generating...</span>
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isTyping && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                <span className="text-sm text-muted-foreground">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-4 bg-card/50">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={walletConnected ? "Ask me anything..." : "Connect wallet to start"}
            disabled={isTyping || !walletConnected}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isTyping || !walletConnected}
            className="w-12 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white disabled:opacity-50 hover:shadow-lg hover:shadow-emerald-500/20 flex items-center justify-center transition-all"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatInterface;
