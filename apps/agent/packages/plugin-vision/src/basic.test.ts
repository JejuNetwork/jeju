import { describe, it, expect } from 'bun:test';
import { visionPlugin } from './index';

describe('Vision Plugin', () => {
  it('should export a valid plugin', () => {
    expect(visionPlugin).toBeDefined();
    expect(visionPlugin.name).toBe('vision');
    expect(visionPlugin.description).toBeDefined();
  });

  it('should have actions', () => {
    expect(visionPlugin.actions).toBeDefined();
    expect(Array.isArray(visionPlugin.actions)).toBe(true);
    expect(visionPlugin.actions?.length || 0).toBeGreaterThan(0);
  });

  it('should have providers', () => {
    expect(visionPlugin.providers).toBeDefined();
    expect(Array.isArray(visionPlugin.providers)).toBe(true);
    expect(visionPlugin.providers?.length || 0).toBeGreaterThan(0);
  });

  it('should have services', () => {
    expect(visionPlugin.services).toBeDefined();
    expect(Array.isArray(visionPlugin.services)).toBe(true);
    expect(visionPlugin.services?.length || 0).toBeGreaterThan(0);
  });

  it('should have init function', () => {
    expect(visionPlugin.init).toBeDefined();
    expect(typeof visionPlugin.init).toBe('function');
  });
});
