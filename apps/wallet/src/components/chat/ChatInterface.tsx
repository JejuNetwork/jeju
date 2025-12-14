import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, Check, X, AlertTriangle, Shield, Wallet, ArrowLeftRight, HelpCircle, Sparkles, History, Zap } from 'lucide-react';
import { useWallet, useMultiChainBalances, formatUsd, formatTokenAmount } from '../../hooks/useWallet';
import { elizaClient, type Agent } from '../../lib/elizaClient';
import { socketManager, type MessageData } from '../../lib/socketManager';
import { useQuery } from '@tanstack/react-query';

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
  const [isConnected, setIsConnected] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { isConnected: walletConnected, address, chain, balance } = useWallet();
  const { aggregatedBalances, totalUsdValue, isLoading: balancesLoading } = useMultiChainBalances(address);

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const result = await elizaClient.agents.listAgents();
      return result.agents;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const agent = agentsData?.[0];

  useEffect(() => {
    if (!walletConnected || !address || !agent) return;

    const userId = address.toLowerCase();
    const socket = socketManager.connect(userId, `User-${address.slice(0, 6)}`);

    socket.on('connect', () => {
      setIsConnected(true);
      initializeChannel(userId, agent.id);
    });

    socket.on('disconnect', () => setIsConnected(false));

    return () => {
      socketManager.disconnect();
      setIsConnected(false);
    };
  }, [walletConnected, address, agent]);

  const initializeChannel = async (userId: string, agentId: string) => {
    try {
      try {
        await elizaClient.messaging.createServer({
          id: userId,
          name: `${userId.slice(0, 8)}'s Wallet`,
          sourceType: 'wallet',
          sourceId: userId,
          metadata: { createdBy: 'jeju-wallet', userId },
        });
        await elizaClient.messaging.addAgentToServer(userId, agentId);
      } catch { /* Server may exist */ }

      const { channels } = await elizaClient.messaging.getServerChannels(userId);
      if (channels.length > 0) {
        const latest = channels[0];
        setChannelId(latest.id);
        socketManager.joinChannel(latest.id, userId, { isDm: true });
        await loadMessages(latest.id, agentId);
      }
    } catch (error) {
      console.error('[Chat] Init failed:', error);
    }
  };

  const loadMessages = async (chId: string, agentId: string) => {
    try {
      const { messages: loaded } = await elizaClient.messaging.getChannelMessages(chId, { limit: 50 });
      const formatted = loaded.map((msg) => ({
        id: msg.id,
        content: msg.content,
        isAgent: msg.authorId === agentId,
        timestamp: typeof msg.createdAt === 'number' ? msg.createdAt : Date.parse(msg.createdAt as string),
        metadata: msg.metadata as Message['metadata'],
      }));
      setMessages(formatted.sort((a, b) => a.timestamp - b.timestamp));
    } catch (error) {
      console.error('[Chat] Load failed:', error);
    }
  };

  useEffect(() => {
    if (!channelId || !agent) return;

    const handleMessage = (data: MessageData) => {
      const newMsg: Message = {
        id: data.id || crypto.randomUUID(),
        content: data.content || data.text || data.message || '',
        isAgent: data.senderId === agent.id,
        timestamp: typeof data.createdAt === 'number' ? data.createdAt : Date.parse(data.createdAt as string),
        metadata: data.metadata as Message['metadata'],
      };

      setMessages((prev) => {
        if (prev.find((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg].sort((a, b) => a.timestamp - b.timestamp);
      });

      if (newMsg.isAgent) {
        setIsTyping(false);
        if (newMsg.metadata?.actions?.includes('MULTI_STEP_SUMMARY') && onActionCompleted) {
          onActionCompleted();
        }
      }
    };

    const unsubscribe = socketManager.onMessage(handleMessage);
    return () => unsubscribe();
  }, [channelId, agent, onActionCompleted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || isTyping) return;

    const content = inputValue.trim();
    setInputValue('');
    setIsTyping(true);

    if (!channelId && address && agent) {
      try {
        const titleResponse = await elizaClient.messaging.generateChannelTitle(content, agent.id);
        const newChannel = await elizaClient.messaging.createGroupChannel({
          name: titleResponse.title || content.slice(0, 50),
          participantIds: [address.toLowerCase(), agent.id],
          metadata: {
            server_id: address.toLowerCase(),
            type: 'DM',
            isDm: true,
            user1: address.toLowerCase(),
            user2: agent.id,
            forAgent: agent.id,
            createdAt: new Date().toISOString(),
          },
        });
        setChannelId(newChannel.id);
        socketManager.joinChannel(newChannel.id, address.toLowerCase(), { isDm: true });
        setTimeout(() => {
          socketManager.sendMessage(newChannel.id, content, address.toLowerCase(), {
            userId: address.toLowerCase(),
            isDm: true,
            targetUserId: agent.id,
          });
        }, 100);
      } catch (error) {
        console.error('[Chat] Create channel failed:', error);
        setIsTyping(false);
      }
      return;
    }

    if (channelId && address && agent) {
      socketManager.sendMessage(channelId, content, address.toLowerCase(), {
        userId: address.toLowerCase(),
        isDm: true,
        targetUserId: agent.id,
      });
    }
  }, [inputValue, isTyping, channelId, address, agent]);

  const processLocally = useCallback((input: string): string => {
    const cmd = input.toLowerCase().trim();
    
    if (cmd.includes('balance') || cmd.includes('portfolio')) {
      if (!walletConnected) return 'Please connect your wallet first.';
      if (balancesLoading) return 'Loading your portfolio...';
      if (aggregatedBalances.length === 0) {
        return `**Your Portfolio**\n\nTotal Value: ${formatUsd(totalUsdValue)}\n\nNo tokens found. Deposit some to get started.`;
      }
      return [
        `**Your Portfolio**\n`,
        `**Total Value:** ${formatUsd(totalUsdValue)}\n`,
        ...aggregatedBalances.map(a => 
          `• **${a.symbol}**: ${formatTokenAmount(a.totalBalance)} (${formatUsd(a.totalUsdValue)})`
        ),
      ].join('\n');
    }

    if (cmd === 'help' || cmd === '?' || cmd.includes('what can you')) {
      return `**I can help you with:**

• **Portfolio** - View your balances across all chains
• **Swap** - Exchange tokens on any supported chain  
• **Send** - Transfer tokens to any address
• **Bridge** - Move assets cross-chain seamlessly
• **Approvals** - Review and revoke token permissions
• **History** - See your recent transactions

Just tell me what you'd like to do.`;
    }

    if (cmd.includes('history') || cmd.includes('transaction')) {
      return `**Recent Activity**

Your transaction history is being loaded from the indexer. Check the Portfolio view for detailed history.`;
    }

    return `I understood: "${input}"

I'm connecting to the agent server. Try asking about your "portfolio" or type "help" for options.`;
  }, [walletConnected, balance, aggregatedBalances, balancesLoading, totalUsdValue]);

  const handleLocalSend = useCallback(() => {
    if (!inputValue.trim() || isTyping) return;
    
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      content: inputValue.trim(),
      isAgent: false,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    
    const response = processLocally(inputValue.trim());
    setInputValue('');
    
    setTimeout(() => {
      const agentMsg: Message = {
        id: `agent-${Date.now()}`,
        content: response,
        isAgent: true,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, agentMsg]);
    }, 300);
  }, [inputValue, isTyping, processLocally]);

  const handleConfirm = useCallback((message: Message) => {
    if (message.metadata?.actionType && message.metadata?.actionData) {
      onActionConfirmed?.(message.metadata.actionType, message.metadata.actionData);
    }
    setMessages(prev => [...prev, { id: `c-${Date.now()}`, content: 'Confirmed. Processing...', isAgent: true, timestamp: Date.now() }]);
  }, [onActionConfirmed]);

  const handleReject = useCallback((message: Message) => {
    if (message.metadata?.actionType) {
      onActionRejected?.(message.metadata.actionType);
    }
    setMessages(prev => [...prev, { id: `r-${Date.now()}`, content: 'Cancelled.', isAgent: true, timestamp: Date.now() }]);
  }, [onActionRejected]);

  const actuallyConnected = isConnected && channelId;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Connection Status */}
      <div className={`px-4 py-2 flex items-center gap-2 border-b ${actuallyConnected ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
        <div className={`w-2 h-2 rounded-full ${actuallyConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        <span className={`text-xs ${actuallyConnected ? 'text-emerald-500' : 'text-amber-500'}`}>
          {actuallyConnected ? `Connected to ${agent?.name || 'Jeju Agent'}` : 'Local mode'}
        </span>
        {actuallyConnected && <Zap className="w-3 h-3 text-emerald-500" />}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {walletConnected ? 'How can I help?' : 'Welcome to Jeju'}
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
              
              <div className={`text-xs mt-2 ${msg.isAgent ? 'text-muted-foreground' : 'text-white/70'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
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
                actuallyConnected ? handleSend() : handleLocalSend();
              }
            }}
            placeholder={walletConnected ? "Ask me anything..." : "Connect wallet to start"}
            disabled={isTyping || !walletConnected}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50 transition-all"
          />
          <button
            onClick={actuallyConnected ? handleSend : handleLocalSend}
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
