import { describe, it, expect } from 'bun:test';
import { ollamaPlugin } from './index';

describe('ollamaPlugin', () => {
  it('should export ollamaPlugin', () => {
    expect(ollamaPlugin).toBeDefined();
  });

  it('should have the correct name', () => {
    expect(ollamaPlugin.name).toBe('ollama');
  });

  it('should have an init method', () => {
    expect(ollamaPlugin.init).toBeDefined();
    expect(typeof ollamaPlugin.init).toBe('function');
  });

  it('should have a description', () => {
    expect(ollamaPlugin.description).toBeDefined();
    expect(typeof ollamaPlugin.description).toBe('string');
  });

  it('should have config', () => {
    expect(ollamaPlugin.config).toBeDefined();
    expect(typeof ollamaPlugin.config).toBe('object');
  });
});
