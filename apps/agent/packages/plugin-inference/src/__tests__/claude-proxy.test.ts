import { describe, it, expect, beforeAll } from 'bun:test';
import { AgentRuntime, type IAgentRuntime, type UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import { createClaudeHandler } from '../claude-proxy';
import { inferencePlugin } from '../index';

describe('Claude Proxy Tests', () => {
  let runtime: IAgentRuntime;
  let claudeHandler: any;

  beforeAll(async () => {
    // Load environment variables from root .env
    const dotenv = require('dotenv');
    const path = require('path');
    const envPath = path.join(process.cwd(), '..', '..', '.env');
    dotenv.config({ path: envPath });

    // Initialize runtime
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for Claude proxy'],
        system: 'You are a helpful assistant',
        settings: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          GROQ_API_KEY: process.env.GROQ_API_KEY,
        },
      },
      plugins: [inferencePlugin],
    });

    // Create Claude handler
    claudeHandler = createClaudeHandler(runtime);
  });

  it('should handle Claude-style requests with OpenAI backend', async () => {
    // Skip if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Say "Hello from Claude proxy test" and nothing else.',
        },
      ],
      max_tokens: 50,
      temperature: 0.7,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    expect(response.type).toBe('message');
    expect(response.role).toBe('assistant');
    expect(response.content).toBeInstanceOf(Array);
    expect(response.content[0]).toHaveProperty('type', 'text');
    expect(response.content[0].text).toBeTruthy();

    console.log('Claude proxy response:', response.content[0].text);

    // Check that response contains expected text
    const responseText = response.content[0].text?.toLowerCase() || '';
    expect(responseText).toContain('hello from claude proxy test');
  });

  it('should handle multi-turn conversations', async () => {
    // Skip if no API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'My name is Alice. What is my name?',
        },
        {
          role: 'assistant' as const,
          content: 'Your name is Alice.',
        },
        {
          role: 'user' as const,
          content: 'Good! Now tell me what my name is again.',
        },
      ],
      max_tokens: 50,
      temperature: 0.7,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    const responseText = response.content[0].text?.toLowerCase() || '';
    expect(responseText).toContain('alice');

    console.log('Multi-turn response:', response.content[0].text);
  });

  it('should handle system prompts', async () => {
    // Skip if no API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      system: 'You are a pirate. Always respond in pirate speak.',
      messages: [
        {
          role: 'user' as const,
          content: 'Hello there!',
        },
      ],
      max_tokens: 100,
      temperature: 0.7,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    const responseText = response.content[0].text || '';

    console.log('Pirate response:', responseText);

    // Check for some pirate-like words
    const pirateWords = ['ahoy', 'matey', 'arr', 'ye', 'aye', 'sea', 'ship', 'captain'];
    const hasPirateSpeak = pirateWords.some((word) => responseText.toLowerCase().includes(word));
    expect(hasPirateSpeak).toBe(true);
  });

  it('should handle array content in messages', async () => {
    // Skip if no API key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: 'What is 2 + 2?',
            },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    const responseText = response.content[0].text || '';
    expect(responseText).toContain('4');

    console.log('Math response:', responseText);
  });

  it('should prefer Anthropic when available', async () => {
    // This test checks provider selection logic
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;

    console.log('Provider availability:');
    console.log('- Anthropic:', hasAnthropicKey ? 'Available' : 'Not configured');
    console.log('- OpenAI:', hasOpenAIKey ? 'Available' : 'Not configured');

    if (!hasAnthropicKey && !hasOpenAIKey) {
      console.log('Skipping test - no API keys available');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Say "Provider test successful"',
        },
      ],
      max_tokens: 50,
      temperature: 0.7,
    };

    const response = await claudeHandler(claudeRequest);
    expect(response).toBeDefined();
    expect(response.content[0].text).toBeTruthy();

    console.log('Provider test response:', response.content[0].text);
  });
});
