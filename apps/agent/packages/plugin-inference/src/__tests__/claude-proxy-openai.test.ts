import { describe, it, expect, beforeAll } from 'bun:test';
import { AgentRuntime, type IAgentRuntime, type UUID } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import { createClaudeHandler } from '../claude-proxy';
import { inferencePlugin } from '../index';
// @ts-ignore - workspace dependency
import { openaiPlugin } from '@elizaos/plugin-openai';
// @ts-ignore - workspace dependency
import sqlPlugin from '@elizaos/plugin-sql';

describe('Claude Proxy with OpenAI Fallback', () => {
  let runtime: IAgentRuntime;
  let claudeHandler: any;

  beforeAll(async () => {
    // Load environment variables from root .env
    const dotenv = require('dotenv');
    const path = require('path');
    const envPath = path.join(process.cwd(), '..', '..', '.env');
    dotenv.config({ path: envPath });

    // Initialize runtime WITHOUT Anthropic key to force OpenAI fallback
    runtime = new AgentRuntime({
      agentId: uuidv4() as UUID,
      character: {
        name: 'Test Agent',
        bio: ['Test agent for Claude proxy OpenAI fallback'],
        system: 'You are a helpful assistant',
        settings: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          // Explicitly NOT including ANTHROPIC_API_KEY to test fallback
        },
      },
      plugins: [sqlPlugin, openaiPlugin, inferencePlugin],
    });

    // Initialize plugins
    await runtime.initialize();

    // Create Claude handler
    claudeHandler = createClaudeHandler(runtime);
  });

  it('should fallback to OpenAI when Anthropic is not available', async () => {
    // Skip if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    console.log('Testing Claude proxy with OpenAI fallback...');
    console.log('OpenAI API Key present:', !!process.env.OPENAI_API_KEY);
    console.log('Anthropic API Key in runtime:', !!runtime.getSetting('ANTHROPIC_API_KEY'));

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Reply with exactly: "OpenAI fallback working"',
        },
      ],
      max_tokens: 50,
      temperature: 0.1,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    expect(response.type).toBe('message');
    expect(response.role).toBe('assistant');
    expect(response.content).toBeInstanceOf(Array);
    expect(response.content[0]).toHaveProperty('type', 'text');
    expect(response.content[0].text).toBeTruthy();

    console.log('OpenAI fallback response:', response.content[0].text);

    // Check that response is working
    const responseText = response.content[0].text?.toLowerCase() || '';
    expect(responseText).toContain('openai');
    expect(responseText).toContain('fallback');
  });

  it('should handle complex conversations through OpenAI', async () => {
    // Skip if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-opus-20240229',
      system: 'You are a helpful math tutor.',
      messages: [
        {
          role: 'user' as const,
          content: 'What is the square root of 144?',
        },
        {
          role: 'assistant' as const,
          content: 'The square root of 144 is 12.',
        },
        {
          role: 'user' as const,
          content: 'And what is 12 squared?',
        },
      ],
      max_tokens: 100,
      temperature: 0.1,
    };

    const response = await claudeHandler(claudeRequest);

    expect(response).toBeDefined();
    const responseText = response.content[0].text || '';

    console.log('Math conversation response:', responseText);

    // Should mention 144
    expect(responseText).toContain('144');
  });

  it('should properly format Claude response structure', async () => {
    // Skip if no OpenAI key
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping test - OPENAI_API_KEY not found');
      return;
    }

    const claudeRequest = {
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: 'user' as const,
          content: 'Say hello',
        },
      ],
      max_tokens: 20,
      temperature: 0.5,
    };

    const response = await claudeHandler(claudeRequest);

    // Verify Claude response structure
    expect(response).toHaveProperty('id');
    expect(response).toHaveProperty('type', 'message');
    expect(response).toHaveProperty('role', 'assistant');
    expect(response).toHaveProperty('model');
    expect(response).toHaveProperty('content');
    expect(response).toHaveProperty('stop_reason');
    expect(response).toHaveProperty('usage');

    expect(response.content).toBeInstanceOf(Array);
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.content[0]).toHaveProperty('type', 'text');
    expect(response.content[0]).toHaveProperty('text');

    expect(response.usage).toHaveProperty('input_tokens');
    expect(response.usage).toHaveProperty('output_tokens');

    console.log('Response structure verified:', {
      id: response.id,
      model: response.model,
      content_length: response.content.length,
      text_preview: response.content[0].text?.substring(0, 50),
    });
  });
});
