/**
 * Check-in Service - Manages check-in schedules and responses.
 */

import type { CheckinSchedule, CheckinResponse, CheckinType, CheckinFrequency, CheckinReport, OrgState } from '../types';
import type { OrgStorage } from './storage';

export interface CreateScheduleParams {
  roomId: string;
  name: string;
  checkinType?: CheckinType;
  frequency?: CheckinFrequency;
  timeUtc: string;
  questions?: string[];
  createdBy: string;
}

export interface RecordResponseParams {
  scheduleId: string;
  responderAgentId: string;
  responderName?: string;
  answers: Record<string, string>;
}

export interface GenerateReportParams {
  start: number;
  end: number;
}

const DEFAULT_QUESTIONS: Record<CheckinType, string[]> = {
  standup: ['What did you accomplish yesterday?', 'What are you working on today?', 'Any blockers or challenges?'],
  mental_health: ['How are you feeling today (1-10)?', 'What is helping you this week?', 'Is there anything the team can do to support you?'],
  sprint: ['What progress did you make on sprint goals?', 'Are you on track to complete your sprint tasks?', 'Any blockers or scope changes needed?'],
  project_status: ['What is the current status of your project?', 'Any risks or issues to report?', 'What are the next milestones?'],
  retrospective: ['What went well?', 'What could be improved?', 'What will you do differently next time?'],
};

export class CheckinService {
  constructor(private storage: OrgStorage) {}

  async createSchedule(state: OrgState, params: CreateScheduleParams): Promise<{ schedule: CheckinSchedule; state: OrgState; cid: string }> {
    const checkinType = params.checkinType ?? 'standup';
    const schedule: CheckinSchedule = {
      id: crypto.randomUUID(),
      roomId: params.roomId,
      name: params.name,
      checkinType,
      frequency: params.frequency ?? 'weekdays',
      timeUtc: params.timeUtc,
      questions: params.questions ?? DEFAULT_QUESTIONS[checkinType],
      enabled: true,
      nextRunAt: this.calcNextRun(params.timeUtc, params.frequency ?? 'weekdays'),
      createdBy: params.createdBy,
      createdAt: Date.now(),
    };
    const result = await this.storage.addCheckinSchedule(state, schedule);
    return { schedule, ...result };
  }

  async recordResponse(state: OrgState, params: RecordResponseParams): Promise<{ response: CheckinResponse; state: OrgState; cid: string }> {
    if (!state.checkinSchedules.find(s => s.id === params.scheduleId)) throw new Error(`Schedule not found: ${params.scheduleId}`);

    const blockers = Object.entries(params.answers)
      .filter(([q, a]) => /blocker|block|challenge|issue|problem|stuck/i.test(q) && a && !/^(none|no)$/i.test(a))
      .map(([, a]) => a);

    const response: CheckinResponse = {
      id: crypto.randomUUID(),
      scheduleId: params.scheduleId,
      responderAgentId: params.responderAgentId,
      responderName: params.responderName,
      answers: params.answers,
      blockers: blockers.length ? blockers : undefined,
      submittedAt: Date.now(),
    };
    const result = await this.storage.recordCheckinResponse(state, response);
    return { response, ...result };
  }

  listSchedules(state: OrgState, roomId?: string): CheckinSchedule[] {
    let schedules = state.checkinSchedules;
    if (roomId) schedules = schedules.filter(s => s.roomId === roomId);
    return schedules.sort((a, b) => b.createdAt - a.createdAt);
  }

  getResponses(state: OrgState, scheduleId: string, params?: { start?: number; end?: number; limit?: number }): CheckinResponse[] {
    let responses = state.checkinResponses.filter(r => r.scheduleId === scheduleId);
    if (params?.start) responses = responses.filter(r => r.submittedAt >= params.start!);
    if (params?.end) responses = responses.filter(r => r.submittedAt <= params.end!);
    responses.sort((a, b) => b.submittedAt - a.submittedAt);
    if (params?.limit) responses = responses.slice(0, params.limit);
    return responses;
  }

  generateReport(state: OrgState, scheduleId: string, params: { start: number; end: number }): CheckinReport {
    const schedule = state.checkinSchedules.find(s => s.id === scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);

    const responses = this.getResponses(state, scheduleId, params);
    const byMember = new Map<string, CheckinResponse[]>();
    responses.forEach(r => byMember.set(r.responderAgentId, [...(byMember.get(r.responderAgentId) ?? []), r]));

    const members = Array.from(byMember.entries()).map(([agentId, resps]) => {
      const member = state.teamMembers.find(m => m.agentId === agentId);
      return {
        name: member?.displayName ?? `Agent ${agentId.slice(0, 8)}`,
        responseCount: resps.length,
        streak: this.calcStreak(resps),
        blockerCount: resps.reduce((sum, r) => sum + (r.blockers?.length ?? 0), 0),
      };
    });

    const blockers = responses.filter(r => r.blockers?.length).flatMap(r => {
      const member = state.teamMembers.find(m => m.agentId === r.responderAgentId);
      return r.blockers!.map(b => ({ memberName: member?.displayName ?? `Agent ${r.responderAgentId.slice(0, 8)}`, blocker: b, date: r.submittedAt }));
    });

    const expected = state.teamMembers.length * this.calcExpected(schedule.frequency, params.start, params.end);

    return {
      scheduleName: schedule.name,
      checkinType: schedule.checkinType,
      period: params,
      totalResponses: responses.length,
      participationRate: expected > 0 ? Math.round((responses.length / expected) * 100) : 0,
      members,
      blockers,
    };
  }

  private calcNextRun(timeUtc: string, frequency: CheckinFrequency): number {
    const [h, m] = timeUtc.split(':').map(Number);
    const next = new Date();
    next.setUTCHours(h ?? 9, m ?? 0, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    if (frequency === 'weekdays') while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    else if (frequency === 'weekly') while (next.getDay() !== 1) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  private calcStreak(responses: CheckinResponse[]): number {
    if (!responses.length) return 0;
    const sorted = [...responses].sort((a, b) => b.submittedAt - a.submittedAt);
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1]!.submittedAt - sorted[i]!.submittedAt <= 172800000) streak++;
      else break;
    }
    return streak;
  }

  private calcExpected(frequency: CheckinFrequency, start: number, end: number): number {
    const days = Math.ceil((end - start) / 86400000);
    return { daily: days, weekdays: Math.ceil(days * 5 / 7), weekly: Math.ceil(days / 7), bi_weekly: Math.ceil(days / 14), monthly: Math.ceil(days / 30) }[frequency] ?? days;
  }
}

export function createCheckinService(storage: OrgStorage): CheckinService {
  return new CheckinService(storage);
}
