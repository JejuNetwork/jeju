/**
 * Character Definition Tests
 */

import { describe, it, expect } from 'bun:test';
import {
  characters,
  getCharacter,
  listCharacters,
  projectManagerCharacter,
  communityManagerCharacter,
  devRelCharacter,
  liaisonCharacter,
  socialMediaManagerCharacter,
  redTeamCharacter,
  blueTeamCharacter,
} from '../characters';
import type { AgentCharacter } from '../types';

describe('Character Definitions', () => {
  describe('Character Registry', () => {
    it('should list all available characters', () => {
      const ids = listCharacters();
      
      expect(ids).toContain('project-manager');
      expect(ids).toContain('community-manager');
      expect(ids).toContain('devrel');
      expect(ids).toContain('liaison');
      expect(ids).toContain('social-media-manager');
      expect(ids).toContain('red-team');
      expect(ids).toContain('blue-team');
      expect(ids.length).toBe(7);
    });

    it('should get character by ID', () => {
      const character = getCharacter('project-manager');
      
      expect(character).toBeDefined();
      expect(character?.name).toBe('Jimmy');
    });

    it('should return null for unknown character', () => {
      const character = getCharacter('unknown-character');
      expect(character).toBeNull();
    });

    it('should have all characters in registry', () => {
      expect(Object.keys(characters).length).toBe(7);
    });
  });

  describe('Character Structure Validation', () => {
    const allCharacters: AgentCharacter[] = [
      projectManagerCharacter,
      communityManagerCharacter,
      devRelCharacter,
      liaisonCharacter,
      socialMediaManagerCharacter,
      redTeamCharacter,
      blueTeamCharacter,
    ];

    it.each(allCharacters)('character %s should have required fields', (character) => {
      expect(character.id).toBeDefined();
      expect(typeof character.id).toBe('string');
      expect(character.id.length).toBeGreaterThan(0);

      expect(character.name).toBeDefined();
      expect(typeof character.name).toBe('string');
      expect(character.name.length).toBeGreaterThan(0);

      expect(character.description).toBeDefined();
      expect(typeof character.description).toBe('string');

      expect(character.system).toBeDefined();
      expect(typeof character.system).toBe('string');
      expect(character.system.length).toBeGreaterThan(50);

      expect(Array.isArray(character.bio)).toBe(true);
      expect(character.bio.length).toBeGreaterThan(0);

      expect(Array.isArray(character.messageExamples)).toBe(true);

      expect(Array.isArray(character.topics)).toBe(true);
      expect(character.topics.length).toBeGreaterThan(0);

      expect(Array.isArray(character.adjectives)).toBe(true);
      expect(character.adjectives.length).toBeGreaterThan(0);

      expect(character.style).toBeDefined();
      expect(Array.isArray(character.style.all)).toBe(true);
      expect(Array.isArray(character.style.chat)).toBe(true);
      expect(Array.isArray(character.style.post)).toBe(true);
    });
  });

  describe('Project Manager (Jimmy)', () => {
    it('should have correct identity', () => {
      expect(projectManagerCharacter.id).toBe('project-manager');
      expect(projectManagerCharacter.name).toBe('Jimmy');
    });

    it('should focus on project management topics', () => {
      const topics = projectManagerCharacter.topics;
      
      expect(topics).toContain('project management');
      expect(topics).toContain('todo tracking');
      expect(topics).toContain('check-ins and standups');
    });

    it('should have MCP servers configured', () => {
      expect(projectManagerCharacter.mcpServers).toContain('org-tools');
    });
  });

  describe('Community Manager (Eli5)', () => {
    it('should have correct identity', () => {
      expect(communityManagerCharacter.id).toBe('community-manager');
      expect(communityManagerCharacter.name).toBe('Eli5');
    });

    it('should have warm personality adjectives', () => {
      const adjectives = communityManagerCharacter.adjectives;
      
      expect(adjectives).toContain('warm');
      expect(adjectives).toContain('approachable');
      expect(adjectives).toContain('empathetic');
    });
  });

  describe('Red Team (Phoenix)', () => {
    it('should have correct identity', () => {
      expect(redTeamCharacter.id).toBe('red-team');
      expect(redTeamCharacter.name).toBe('Phoenix');
    });

    it('should focus on security topics', () => {
      const topics = redTeamCharacter.topics;
      
      expect(topics).toContain('security testing');
      expect(topics).toContain('vulnerability assessment');
      expect(topics).toContain('adversarial thinking');
    });

    it('should have adversarial adjectives', () => {
      expect(redTeamCharacter.adjectives).toContain('adversarial');
      expect(redTeamCharacter.adjectives).toContain('relentless');
    });
  });

  describe('Blue Team (Shield)', () => {
    it('should have correct identity', () => {
      expect(blueTeamCharacter.id).toBe('blue-team');
      expect(blueTeamCharacter.name).toBe('Shield');
    });

    it('should focus on defensive topics', () => {
      const topics = blueTeamCharacter.topics;
      
      expect(topics).toContain('security defense');
      expect(topics).toContain('system protection');
      expect(topics).toContain('incident response');
    });

    it('should have defensive adjectives', () => {
      expect(blueTeamCharacter.adjectives).toContain('protective');
      expect(blueTeamCharacter.adjectives).toContain('resilient');
    });
  });

  describe('Model Preferences', () => {
    it('all characters should have model preferences', () => {
      const ids = listCharacters();
      
      for (const id of ids) {
        const character = getCharacter(id);
        expect(character?.modelPreferences).toBeDefined();
        expect(character?.modelPreferences?.small).toBeDefined();
        expect(character?.modelPreferences?.large).toBeDefined();
      }
    });
  });
});
