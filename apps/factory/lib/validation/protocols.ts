/**
 * Protocol Validation Schemas
 * 
 * Validation for A2A and MCP protocol messages.
 * 
 * Note: z.unknown() is used intentionally for protocol data fields that can 
 * contain arbitrary structures defined by external protocol specs (A2A, MCP).
 */

import { z } from 'zod';

// A2A Protocol Schemas - data field allows arbitrary JSON per A2A spec
export const a2aRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.object({
    message: z.object({
      messageId: z.string(),
      parts: z.array(z.object({
        kind: z.string(),
        text: z.string().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })),
    }).optional(),
  }).optional(),
  id: z.union([z.string(), z.number()]),
});

export type A2ARequest = z.infer<typeof a2aRequestSchema>;

// MCP Protocol Schemas - arguments field allows arbitrary JSON per MCP spec
export const mcpResourceReadSchema = z.object({
  uri: z.string().min(1, 'URI is required'),
});

export const mcpToolCallSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  arguments: z.record(z.string(), z.unknown()),
});

export const mcpPromptGetSchema = z.object({
  name: z.string().min(1, 'Prompt name is required'),
  arguments: z.record(z.string(), z.string()),
});
