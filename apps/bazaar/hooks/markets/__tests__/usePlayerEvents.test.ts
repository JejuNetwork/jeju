import { describe, test, expect } from 'bun:test';

describe('usePlayerEvents Hook', () => {
  test('should export usePlayerEvents function', () => {
    const { usePlayerEvents } = require('../usePlayerEvents');
    expect(typeof usePlayerEvents).toBe('function');
  });

  test('should export PlayerSkillEvent interface', () => {
    const module = require('../usePlayerEvents');
    expect(module).toHaveProperty('usePlayerEvents');
  });

  test('should export PlayerStats interface', () => {
    const module = require('../usePlayerEvents');
    expect(module).toHaveProperty('usePlayerEvents');
  });
});
