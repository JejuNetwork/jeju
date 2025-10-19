import { describe, it, expect } from 'bun:test';

describe('AgentServer', () => {
  it('should have basic health check', () => {
    // Basic smoke test to ensure test infrastructure works
    expect(true).toBe(true);
  });

  it('should export character configuration', async () => {
    const { character } = await import('../character');
    expect(character).toBeDefined();
    expect(character.name).toBe('ELIZA');
  });
});
