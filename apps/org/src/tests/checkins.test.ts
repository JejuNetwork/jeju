/**
 * Check-in Service Tests
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { CheckinService, createCheckinService } from '../services/checkins';
import { OrgStorage, createOrgStorage } from '../services/storage';
import type { OrgState, CheckinSchedule, TeamMember } from '../types';

describe('CheckinService', () => {
  let storage: OrgStorage;
  let checkinService: CheckinService;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    storage = createOrgStorage({
      apiUrl: 'http://localhost:3100',
      ipfsGateway: 'http://localhost:3100',
    });
    checkinService = createCheckinService(storage);
    mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ cid: 'QmTest' }), { status: 200 }))
    );
    global.fetch = mockFetch as typeof fetch;
  });

  describe('Create Schedule', () => {
    it('should create standup schedule with defaults', async () => {
      const state = storage.createInitialState('org-1');
      
      const { schedule } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Daily Standup',
        timeUtc: '09:00',
        createdBy: 'agent-1',
      });

      expect(schedule.name).toBe('Daily Standup');
      expect(schedule.checkinType).toBe('standup');
      expect(schedule.frequency).toBe('weekdays');
      expect(schedule.timeUtc).toBe('09:00');
      expect(schedule.enabled).toBe(true);
      expect(schedule.questions.length).toBe(3); // Default standup questions
    });

    it('should create mental health checkin', async () => {
      const state = storage.createInitialState('org-1');
      
      const { schedule } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Weekly Wellness',
        checkinType: 'mental_health',
        frequency: 'weekly',
        timeUtc: '14:00',
        createdBy: 'agent-1',
      });

      expect(schedule.checkinType).toBe('mental_health');
      expect(schedule.frequency).toBe('weekly');
      expect(schedule.questions).toContain('How are you feeling today (1-10)?');
    });

    it('should allow custom questions', async () => {
      const state = storage.createInitialState('org-1');
      const customQuestions = ['What did you learn?', 'What was challenging?'];
      
      const { schedule } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Custom Checkin',
        timeUtc: '10:00',
        questions: customQuestions,
        createdBy: 'agent-1',
      });

      expect(schedule.questions).toEqual(customQuestions);
    });

    it('should calculate next run time', async () => {
      const state = storage.createInitialState('org-1');
      const now = Date.now();
      
      const { schedule } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Future Run',
        timeUtc: '09:00',
        createdBy: 'agent-1',
      });

      expect(schedule.nextRunAt).toBeGreaterThan(now);
    });
  });

  describe('Record Response', () => {
    it('should record check-in response', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Test',
        timeUtc: '09:00',
        createdBy: 'agent-1',
      });

      const { response, state: s2 } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-2',
        responderName: 'Jimmy',
        answers: {
          'What did you accomplish yesterday?': 'Fixed bugs',
          'What are you working on today?': 'New feature',
          'Any blockers or challenges?': 'None',
        },
      });

      expect(response.scheduleId).toBe(schedule.id);
      expect(response.responderAgentId).toBe('agent-2');
      expect(response.responderName).toBe('Jimmy');
      expect(Object.keys(response.answers).length).toBe(3);
      expect(s2.checkinResponses.length).toBe(1);
    });

    it('should extract blockers from answers', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Test',
        timeUtc: '09:00',
        createdBy: 'agent-1',
      });

      const { response } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-2',
        answers: {
          'Any blockers?': 'Waiting for API access',
          'Challenges': 'Need design review',
        },
      });

      expect(response.blockers).toBeDefined();
      expect(response.blockers?.length).toBe(2);
    });

    it('should not extract blockers from "none" answers', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1',
        name: 'Test',
        timeUtc: '09:00',
        createdBy: 'agent-1',
      });

      const { response } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-2',
        answers: {
          'Any blockers?': 'None',
          'Any issues?': 'No',
        },
      });

      expect(response.blockers).toBeUndefined();
    });

    it('should throw for non-existent schedule', async () => {
      const state = storage.createInitialState('org-1');

      await expect(checkinService.recordResponse(state, {
        scheduleId: 'non-existent',
        responderAgentId: 'agent-1',
        answers: {},
      })).rejects.toThrow('Schedule not found');
    });
  });

  describe('List Schedules', () => {
    it('should list all schedules', async () => {
      let state = storage.createInitialState('org-1');
      
      const { state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Schedule 1', timeUtc: '09:00', createdBy: 'agent-1',
      });
      const { state: s2 } = await checkinService.createSchedule(s1, {
        roomId: 'room-2', name: 'Schedule 2', timeUtc: '10:00', createdBy: 'agent-1',
      });

      const schedules = checkinService.listSchedules(s2);
      expect(schedules.length).toBe(2);
    });

    it('should filter by roomId', async () => {
      let state = storage.createInitialState('org-1');
      
      const { state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Schedule 1', timeUtc: '09:00', createdBy: 'agent-1',
      });
      const { state: s2 } = await checkinService.createSchedule(s1, {
        roomId: 'room-2', name: 'Schedule 2', timeUtc: '10:00', createdBy: 'agent-1',
      });
      const { state: s3 } = await checkinService.createSchedule(s2, {
        roomId: 'room-1', name: 'Schedule 3', timeUtc: '11:00', createdBy: 'agent-1',
      });

      const schedules = checkinService.listSchedules(s3, 'room-1');
      expect(schedules.length).toBe(2);
      expect(schedules.every(s => s.roomId === 'room-1')).toBe(true);
    });

    it('should sort by createdAt descending', async () => {
      let state = storage.createInitialState('org-1');
      
      const { state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'First', timeUtc: '09:00', createdBy: 'agent-1',
      });
      
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));
      
      const { state: s2 } = await checkinService.createSchedule(s1, {
        roomId: 'room-1', name: 'Second', timeUtc: '10:00', createdBy: 'agent-1',
      });

      const schedules = checkinService.listSchedules(s2);
      expect(schedules[0].name).toBe('Second');
      expect(schedules[1].name).toBe('First');
    });
  });

  describe('Get Responses', () => {
    it('should get responses for schedule', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Test', timeUtc: '09:00', createdBy: 'agent-1',
      });

      const { state: s2 } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-1',
        answers: { 'Q1': 'A1' },
      });
      const { state: s3 } = await checkinService.recordResponse(s2, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-2',
        answers: { 'Q1': 'A2' },
      });

      const responses = checkinService.getResponses(s3, schedule.id);
      expect(responses.length).toBe(2);
    });

    it('should filter responses by date range', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Test', timeUtc: '09:00', createdBy: 'agent-1',
      });

      const now = Date.now();
      
      // Mock the response timestamp
      const { state: s2 } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-1',
        answers: { 'Q1': 'A1' },
      });

      const responses = checkinService.getResponses(s2, schedule.id, {
        start: now - 10000,
        end: now + 10000,
      });
      expect(responses.length).toBe(1);

      const noResponses = checkinService.getResponses(s2, schedule.id, {
        start: now + 100000,
        end: now + 200000,
      });
      expect(noResponses.length).toBe(0);
    });

    it('should respect limit', async () => {
      let state = storage.createInitialState('org-1');
      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Test', timeUtc: '09:00', createdBy: 'agent-1',
      });

      let currentState = s1;
      for (let i = 0; i < 10; i++) {
        const result = await checkinService.recordResponse(currentState, {
          scheduleId: schedule.id,
          responderAgentId: `agent-${i}`,
          answers: { 'Q1': `A${i}` },
        });
        currentState = result.state;
      }

      const responses = checkinService.getResponses(currentState, schedule.id, { limit: 5 });
      expect(responses.length).toBe(5);
    });
  });

  describe('Generate Report', () => {
    async function createTestScenario(): Promise<{ state: OrgState; scheduleId: string }> {
      let state = storage.createInitialState('org-1');
      
      // Add team members
      const members: TeamMember[] = [
        { id: 'tm-1', agentId: 'agent-1', displayName: 'Alice', isAdmin: false, joinedAt: Date.now(), lastActiveAt: Date.now(), stats: { totalCheckins: 0, checkinStreak: 0, todosCompleted: 0 } },
        { id: 'tm-2', agentId: 'agent-2', displayName: 'Bob', isAdmin: false, joinedAt: Date.now(), lastActiveAt: Date.now(), stats: { totalCheckins: 0, checkinStreak: 0, todosCompleted: 0 } },
      ];
      state = { ...state, teamMembers: members };

      const { schedule, state: s1 } = await checkinService.createSchedule(state, {
        roomId: 'room-1', name: 'Daily Standup', timeUtc: '09:00', createdBy: 'admin',
      });

      // Record responses
      const { state: s2 } = await checkinService.recordResponse(s1, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-1',
        answers: {
          'What did you accomplish?': 'Finished feature',
          'Any blockers?': 'Waiting for review',
        },
      });

      const { state: s3 } = await checkinService.recordResponse(s2, {
        scheduleId: schedule.id,
        responderAgentId: 'agent-2',
        answers: {
          'What did you accomplish?': 'Bug fixes',
          'Any blockers?': 'None',
        },
      });

      return { state: s3, scheduleId: schedule.id };
    }

    it('should generate basic report', async () => {
      const { state, scheduleId } = await createTestScenario();
      
      const report = checkinService.generateReport(state, scheduleId, {
        start: Date.now() - 86400000,
        end: Date.now() + 86400000,
      });

      expect(report.scheduleName).toBe('Daily Standup');
      expect(report.checkinType).toBe('standup');
      expect(report.totalResponses).toBe(2);
    });

    it('should include member stats in report', async () => {
      const { state, scheduleId } = await createTestScenario();
      
      const report = checkinService.generateReport(state, scheduleId, {
        start: Date.now() - 86400000,
        end: Date.now() + 86400000,
      });

      expect(report.members.length).toBe(2);
      expect(report.members[0].responseCount).toBe(1);
    });

    it('should extract blockers for report', async () => {
      const { state, scheduleId } = await createTestScenario();
      
      const report = checkinService.generateReport(state, scheduleId, {
        start: Date.now() - 86400000,
        end: Date.now() + 86400000,
      });

      expect(report.blockers.length).toBe(1);
      expect(report.blockers[0].blocker).toBe('Waiting for review');
    });

    it('should throw for non-existent schedule', () => {
      const state = storage.createInitialState('org-1');

      expect(() => checkinService.generateReport(state, 'non-existent', {
        start: Date.now() - 86400000,
        end: Date.now(),
      })).toThrow('Schedule not found');
    });
  });
});
