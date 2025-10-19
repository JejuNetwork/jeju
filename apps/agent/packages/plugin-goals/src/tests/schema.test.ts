import { describe, it, expect } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { goalsTable, goalTagsTable } from '../schema';

describe('Goals Schema Tests', () => {
  describe('goalsTable', () => {
    it('should have correct columns', () => {
      const columns = getTableColumns(goalsTable);

      expect(columns.id).toBeDefined();
      expect(columns.agentId).toBeDefined();
      expect(columns.ownerType).toBeDefined();
      expect(columns.ownerId).toBeDefined();
      expect(columns.name).toBeDefined();
      expect(columns.description).toBeDefined();
      expect(columns.isCompleted).toBeDefined();
      expect(columns.completedAt).toBeDefined();
      expect(columns.createdAt).toBeDefined();
      expect(columns.updatedAt).toBeDefined();
      expect(columns.metadata).toBeDefined();
    });

    it('should have correct defaults', () => {
      const columns = getTableColumns(goalsTable);

      expect(columns.isCompleted.default).toBe(false);
      expect(columns.metadata.default).toEqual({});
    });
  });

  describe('goalTagsTable', () => {
    it('should have correct columns', () => {
      const columns = getTableColumns(goalTagsTable);

      expect(columns.id).toBeDefined();
      expect(columns.goalId).toBeDefined();
      expect(columns.tag).toBeDefined();
      expect(columns.createdAt).toBeDefined();
    });

    it('should have foreign key reference to goals', () => {
      const columns = getTableColumns(goalTagsTable);
      const goalIdColumn = columns.goalId;

      expect(goalIdColumn).toBeDefined();
    });
  });
});
