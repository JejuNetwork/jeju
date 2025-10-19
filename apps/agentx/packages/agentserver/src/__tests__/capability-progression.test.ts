import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentRuntime, type Character, stringToUuid } from '@elizaos/core';
import { CapabilityProgressionService } from '../services/capabilityProgressionService';

describe('Capability Progression System E2E Tests', () => {
  let runtime: any;
  let progressionService: CapabilityProgressionService;

  beforeEach(async () => {
    // Create a minimal test character
    const character: Character = {
      id: stringToUuid('TestAgent'),
      name: 'TestAgent',
      system: 'You are a test agent for capability progression.',
      bio: ['Test agent for progression system'],
      messageExamples: [],
      postExamples: [],
      topics: [],
      knowledge: [],
      style: { all: [], chat: [], post: [] },
      adjectives: [],
      settings: {
        MODEL_PROVIDER: 'test',
        ENABLE_AUTONOMY: 'false',
      },
    };

    runtime = new AgentRuntime({
      character,
      agentId: stringToUuid('TestAgent'),
      plugins: [], // Start with no plugins
    });

    // Mock setSetting for runtime
    runtime.setSetting = () => {};

    // Initialize the progression service
    progressionService = new CapabilityProgressionService(runtime);
  });

  it('should start with only basic capabilities unlocked', async () => {
    // GIVEN: A new agent with progression service
    // WHEN: Checking initial state
    const currentLevel = progressionService.getCurrentLevel();
    const unlockedCapabilities = progressionService.getUnlockedCapabilities();
    const progressionState = progressionService.getProgressionState();

    // THEN: Only level 0 should be unlocked with basic capabilities
    expect(currentLevel).toBe(0);
    expect(unlockedCapabilities).toEqual(['shell', 'naming']);
    expect(progressionState.agentNamed).toBe(false);
    expect(progressionState.completedActions).toEqual([]);
    expect(progressionState.unlockedLevels).toEqual([]);
  });

  it('should not unlock browser capabilities until agent is named AND shell is used', async () => {
    // GIVEN: Agent at level 0
    const initialLevel = progressionService.getCurrentLevel();
    expect(initialLevel).toBe(0);

    // WHEN: Agent is named but shell not used
    await progressionService.recordAgentNamed('TestBot');

    // THEN: Should not progress to level 1
    expect(progressionService.getCurrentLevel()).toBe(0);
    expect(progressionService.isCapabilityUnlocked('browser')).toBe(false);
    expect(progressionService.isCapabilityUnlocked('stagehand')).toBe(false);

    // WHEN: Shell is used but agent not named (reset state first)
    progressionService = new CapabilityProgressionService(runtime);
    await progressionService.recordCapabilityUsed('shell');

    // THEN: Should still not progress to level 1
    expect(progressionService.getCurrentLevel()).toBe(0);
    expect(progressionService.isCapabilityUnlocked('browser')).toBe(false);
  });

  it('should unlock browser capabilities when both naming and shell conditions are met', async () => {
    // GIVEN: Agent at level 0
    expect(progressionService.getCurrentLevel()).toBe(0);

    // WHEN: Agent chooses a name
    await progressionService.recordAgentNamed('WebExplorer');

    // AND: Agent uses shell capability
    await progressionService.recordCapabilityUsed('shell');

    // THEN: Should progress to level 1 with browser capabilities
    expect(progressionService.getCurrentLevel()).toBe(1);
    expect(progressionService.isCapabilityUnlocked('browser')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('stagehand')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('shell')).toBe(true); // Should retain previous capabilities
    expect(progressionService.isCapabilityUnlocked('naming')).toBe(true);

    const progressionState = progressionService.getProgressionState();
    expect(progressionState.unlockedLevels).toContain('level_1_browser');
    expect(progressionState.lastUnlockTime).not.toBeNull();
  });

  it('should unlock vision capabilities when browser is used AND form is submitted', async () => {
    // GIVEN: Agent has unlocked browser capabilities
    await progressionService.recordAgentNamed('VisualAgent');
    await progressionService.recordCapabilityUsed('shell');
    expect(progressionService.getCurrentLevel()).toBe(1);

    // WHEN: Agent uses browser but hasn't submitted form
    await progressionService.recordCapabilityUsed('browser');

    // THEN: Should not progress to level 2 yet
    expect(progressionService.getCurrentLevel()).toBe(1);
    expect(progressionService.isCapabilityUnlocked('vision')).toBe(false);

    // WHEN: Agent submits a form
    await progressionService.recordFormSubmitted({ data: 'test form data' });

    // THEN: Should progress to level 2 with vision capabilities
    expect(progressionService.getCurrentLevel()).toBe(2);
    expect(progressionService.isCapabilityUnlocked('vision')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('screen_capture')).toBe(true);

    // Should retain all previous capabilities
    expect(progressionService.isCapabilityUnlocked('browser')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('shell')).toBe(true);
  });

  it('should unlock audio capabilities when vision is used', async () => {
    // GIVEN: Agent has unlocked vision capabilities
    await progressionService.recordAgentNamed('AudioAgent');
    await progressionService.recordCapabilityUsed('shell');
    await progressionService.recordCapabilityUsed('browser');
    await progressionService.recordFormSubmitted();
    expect(progressionService.getCurrentLevel()).toBe(2);

    // WHEN: Agent uses vision capability
    await progressionService.recordCapabilityUsed('vision');

    // THEN: Should progress to level 3 with audio capabilities
    expect(progressionService.getCurrentLevel()).toBe(3);
    expect(progressionService.isCapabilityUnlocked('microphone')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('sam')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('audio')).toBe(true);
  });

  it('should unlock camera capabilities when microphone is used', async () => {
    // GIVEN: Agent has unlocked audio capabilities
    await progressionService.recordAgentNamed('CameraAgent');
    await progressionService.recordCapabilityUsed('shell');
    await progressionService.recordCapabilityUsed('browser');
    await progressionService.recordFormSubmitted();
    await progressionService.recordCapabilityUsed('vision');
    expect(progressionService.getCurrentLevel()).toBe(3);

    // WHEN: Agent uses microphone capability
    await progressionService.recordCapabilityUsed('microphone');

    // THEN: Should progress to level 4 with camera capabilities
    expect(progressionService.getCurrentLevel()).toBe(4);
    expect(progressionService.isCapabilityUnlocked('camera')).toBe(true);
    expect(progressionService.isCapabilityUnlocked('advanced_vision')).toBe(true);
  });

  it('should not allow skipping levels in progression', async () => {
    // GIVEN: Agent at level 0
    expect(progressionService.getCurrentLevel()).toBe(0);

    // WHEN: Trying to record advanced capabilities without meeting prerequisites
    await progressionService.recordCapabilityUsed('vision'); // Should not unlock anything
    await progressionService.recordCapabilityUsed('microphone'); // Should not unlock anything
    await progressionService.recordFormSubmitted(); // Should not unlock anything without browser

    // THEN: Should remain at level 0
    expect(progressionService.getCurrentLevel()).toBe(0);
    expect(progressionService.isCapabilityUnlocked('vision')).toBe(false);
    expect(progressionService.isCapabilityUnlocked('microphone')).toBe(false);
    expect(progressionService.isCapabilityUnlocked('browser')).toBe(false);
  });

  it('should track progression state correctly through all levels', async () => {
    // GIVEN: Starting state
    let state = progressionService.getProgressionState();
    expect(state.currentLevel).toBe(0);
    expect(state.unlockedLevels).toEqual([]);

    // WHEN: Progressing through all levels
    await progressionService.recordAgentNamed('FullProgressionAgent');
    await progressionService.recordCapabilityUsed('shell');

    state = progressionService.getProgressionState();
    expect(state.currentLevel).toBe(1);
    expect(state.unlockedLevels).toContain('level_1_browser');
    expect(state.agentNamed).toBe(true);
    expect(state.completedActions).toContain('capability_used_shell');

    await progressionService.recordCapabilityUsed('browser');
    await progressionService.recordFormSubmitted();

    state = progressionService.getProgressionState();
    expect(state.currentLevel).toBe(2);
    expect(state.unlockedLevels).toContain('level_2_vision');
    expect(state.completedActions).toContain('capability_used_browser');
    expect(state.completedActions).toContain('form_submitted');

    await progressionService.recordCapabilityUsed('vision');

    state = progressionService.getProgressionState();
    expect(state.currentLevel).toBe(3);
    expect(state.unlockedLevels).toContain('level_3_audio');

    await progressionService.recordCapabilityUsed('microphone');

    state = progressionService.getProgressionState();
    expect(state.currentLevel).toBe(4);
    expect(state.unlockedLevels).toContain('level_4_camera');

    // THEN: All capabilities should be unlocked
    const allCapabilities = progressionService.getUnlockedCapabilities();
    expect(allCapabilities).toContain('shell');
    expect(allCapabilities).toContain('naming');
    expect(allCapabilities).toContain('browser');
    expect(allCapabilities).toContain('stagehand');
    expect(allCapabilities).toContain('vision');
    expect(allCapabilities).toContain('screen_capture');
    expect(allCapabilities).toContain('microphone');
    expect(allCapabilities).toContain('sam');
    expect(allCapabilities).toContain('audio');
    expect(allCapabilities).toContain('camera');
    expect(allCapabilities).toContain('advanced_vision');
  });

  it('should handle duplicate action recordings gracefully', async () => {
    // GIVEN: Agent at level 0
    expect(progressionService.getCurrentLevel()).toBe(0);

    // WHEN: Recording the same action multiple times
    await progressionService.recordAgentNamed('DuplicateTest');
    await progressionService.recordAgentNamed('DuplicateTest'); // Duplicate
    await progressionService.recordCapabilityUsed('shell');
    await progressionService.recordCapabilityUsed('shell'); // Duplicate

    // THEN: Should only progress once and not create duplicate entries
    expect(progressionService.getCurrentLevel()).toBe(1);

    const state = progressionService.getProgressionState();
    const shellActions = state.completedActions.filter(
      (action) => action === 'capability_used_shell'
    );
    expect(shellActions.length).toBe(1); // Should not have duplicates
  });

  it('should provide correct available levels information', async () => {
    // GIVEN: Progression service initialized
    const availableLevels = progressionService.getAvailableLevels();

    // THEN: Should have all 5 levels defined
    expect(availableLevels.length).toBe(5);

    // Level 0 should be unlocked by default
    expect(availableLevels[0].id).toBe('level_0_basic');
    expect(availableLevels[0].isUnlocked).toBe(true);
    expect(availableLevels[0].unlockedCapabilities).toEqual(['shell', 'naming']);

    // Other levels should be locked initially
    expect(availableLevels[1].id).toBe('level_1_browser');
    expect(availableLevels[1].isUnlocked).toBe(false);
    expect(availableLevels[1].unlockedCapabilities).toEqual(['browser', 'stagehand']);

    expect(availableLevels[2].id).toBe('level_2_vision');
    expect(availableLevels[2].isUnlocked).toBe(false);
    expect(availableLevels[2].unlockedCapabilities).toEqual(['vision', 'screen_capture']);

    expect(availableLevels[3].id).toBe('level_3_audio');
    expect(availableLevels[3].isUnlocked).toBe(false);
    expect(availableLevels[3].unlockedCapabilities).toEqual(['microphone', 'sam', 'audio']);

    expect(availableLevels[4].id).toBe('level_4_camera');
    expect(availableLevels[4].isUnlocked).toBe(false);
    expect(availableLevels[4].unlockedCapabilities).toEqual(['camera', 'advanced_vision']);
  });

  describe('Unlocked Mode Tests', () => {
    it('should start with all capabilities unlocked when PROGRESSION_MODE is set to unlocked', async () => {
      // GIVEN: Runtime with unlocked mode setting
      runtime.getSetting = (key: string) => {
        if (key === 'PROGRESSION_MODE') return 'unlocked';
        return undefined;
      };

      // WHEN: Creating a new progression service
      const unlockedService = new CapabilityProgressionService(runtime);

      // THEN: All capabilities should be unlocked
      expect(unlockedService.isUnlockedModeEnabled()).toBe(true);
      expect(unlockedService.getCurrentLevel()).toBe(5); // Max level

      const unlockedCapabilities = unlockedService.getUnlockedCapabilities();
      expect(unlockedCapabilities).toContain('shell');
      expect(unlockedCapabilities).toContain('browser');
      expect(unlockedCapabilities).toContain('vision');
      expect(unlockedCapabilities).toContain('microphone');
      expect(unlockedCapabilities).toContain('camera');

      const availableLevels = unlockedService.getAvailableLevels();
      availableLevels.forEach((level) => {
        expect(level.isUnlocked).toBe(true);
      });
    });

    it('should not track progression in unlocked mode', async () => {
      // GIVEN: Service in unlocked mode
      runtime.getSetting = (key: string) => {
        if (key === 'PROGRESSION_MODE') return 'unlocked';
        return undefined;
      };
      const unlockedService = new CapabilityProgressionService(runtime);

      // WHEN: Recording actions that would normally trigger progression
      await unlockedService.recordCapabilityUsed('shell');
      await unlockedService.recordAgentNamed('TestAgent');
      await unlockedService.recordFormSubmitted();

      // THEN: Actions should not be tracked
      const state = unlockedService.getProgressionState();
      expect(state.completedActions).toEqual([]);
    });

    it('should switch from progression to unlocked mode', async () => {
      // GIVEN: Service in progression mode
      expect(progressionService.isUnlockedModeEnabled()).toBe(false);
      expect(progressionService.getCurrentLevel()).toBe(0);

      // WHEN: Switching to unlocked mode
      await progressionService.setProgressionMode('unlocked');

      // THEN: All capabilities should be unlocked
      expect(progressionService.isUnlockedModeEnabled()).toBe(true);
      expect(progressionService.getCurrentLevel()).toBe(5);
      expect(progressionService.getUnlockedCapabilities().length).toBeGreaterThan(10);
    });

    it('should switch from unlocked to progression mode and reset progress', async () => {
      // GIVEN: Service in unlocked mode
      runtime.getSetting = (key: string) => {
        if (key === 'PROGRESSION_MODE') return 'unlocked';
        return undefined;
      };
      const unlockedService = new CapabilityProgressionService(runtime);
      expect(unlockedService.isUnlockedModeEnabled()).toBe(true);

      // WHEN: Switching to progression mode
      await unlockedService.setProgressionMode('progression');

      // THEN: Should reset to initial state
      expect(unlockedService.isUnlockedModeEnabled()).toBe(false);
      expect(unlockedService.getCurrentLevel()).toBe(0);
      expect(unlockedService.getUnlockedCapabilities()).toEqual(['shell', 'naming']);

      const state = unlockedService.getProgressionState();
      expect(state.completedActions).toEqual([]);
      expect(state.agentNamed).toBe(false);
    });
  });
});
