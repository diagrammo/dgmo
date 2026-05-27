import { describe, it, expect } from 'vitest';
import { resolveTaskName, isResolverError } from '../src/gantt/resolver';
import type { GanttTask } from '../src/gantt/types';

function makeTask(
  label: string,
  groupPath: string[] = [],
  id?: string
): GanttTask {
  return {
    id: id ?? `task_${label}`,
    label,
    duration: { amount: 10, unit: 'd' },
    uncertain: false,
    progress: null,
    isDefinition: true,
    dependencies: [],
    metadata: {},
    lineNumber: 1,
    groupPath,
  };
}

describe('gantt resolver', () => {
  describe('exact label match', () => {
    it('resolves unique task name', () => {
      const tasks = [makeTask('Deploy'), makeTask('Test')];
      const result = resolveTaskName('Deploy', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.label).toBe('Deploy');
      }
    });

    it('returns not_found for missing name', () => {
      const tasks = [makeTask('Deploy')];
      const result = resolveTaskName('Build', tasks);
      expect(isResolverError(result)).toBe(true);
      if (isResolverError(result)) {
        expect(result.kind).toBe('not_found');
        expect(result.message).toContain('No task found');
      }
    });

    it('returns ambiguous for duplicate names', () => {
      const tasks = [
        makeTask('Deploy', ['Backend'], 'task_1'),
        makeTask('Deploy', ['Frontend'], 'task_2'),
      ];
      const result = resolveTaskName('Deploy', tasks);
      expect(isResolverError(result)).toBe(true);
      if (isResolverError(result)) {
        expect(result.kind).toBe('ambiguous');
        expect(result.message).toContain('Backend.Deploy');
        expect(result.message).toContain('Frontend.Deploy');
      }
    });
  });

  describe('dot-notation resolution', () => {
    it('resolves Group.Task', () => {
      const tasks = [
        makeTask('Deploy', ['Backend'], 'task_1'),
        makeTask('Deploy', ['Frontend'], 'task_2'),
      ];
      const result = resolveTaskName('Backend.Deploy', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.groupPath).toEqual(['Backend']);
      }
    });

    it('resolves deep path', () => {
      const tasks = [
        makeTask('Deploy', ['Backend', 'API'], 'task_1'),
        makeTask('Deploy', ['Frontend', 'API'], 'task_2'),
      ];
      const result = resolveTaskName('Backend.Deploy', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.groupPath[0]).toBe('Backend');
      }
    });

    it('handles dots in group names', () => {
      // "U.S. Operations.Task A" — last dot split gives "U.S. Operations" + "Task A"
      const tasks = [makeTask('Task A', ['U.S. Operations'], 'task_1')];
      const result = resolveTaskName('U.S. Operations.Task A', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.label).toBe('Task A');
      }
    });
  });

  describe('case sensitivity', () => {
    it('matches case-insensitively (Universal Name Handling)', () => {
      const tasks = [makeTask('Deploy')];
      const result = resolveTaskName('deploy', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.label).toBe('Deploy');
      }
    });
  });

  describe('whitespace handling', () => {
    it('trims whitespace from name', () => {
      const tasks = [makeTask('Deploy')];
      const result = resolveTaskName('  Deploy  ', tasks);
      expect(isResolverError(result)).toBe(false);
    });
  });

  describe('bracket syntax (AC 10)', () => {
    it('resolves [Group].Task as Group.Task', () => {
      const tasks = [
        makeTask('Deploy', ['Backend'], 'task_1'),
        makeTask('Deploy', ['Frontend'], 'task_2'),
      ];
      const result = resolveTaskName('[Backend].Deploy', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.groupPath).toEqual(['Backend']);
      }
    });

    it('resolves [Group.With.Dots].Task', () => {
      const tasks = [makeTask('Task A', ['U.S. Operations'], 'task_1')];
      const result = resolveTaskName('[U.S. Operations].Task A', tasks);
      expect(isResolverError(result)).toBe(false);
      if (!isResolverError(result)) {
        expect(result.task.label).toBe('Task A');
      }
    });

    it('bracket form and dot form resolve identically', () => {
      const tasks = [
        makeTask('Deploy', ['Backend'], 'task_1'),
        makeTask('Deploy', ['Frontend'], 'task_2'),
      ];
      const bracket = resolveTaskName('[Backend].Deploy', tasks);
      const dot = resolveTaskName('Backend.Deploy', tasks);
      expect(isResolverError(bracket)).toBe(false);
      expect(isResolverError(dot)).toBe(false);
      if (!isResolverError(bracket) && !isResolverError(dot)) {
        expect(bracket.task.id).toBe(dot.task.id);
      }
    });
  });
});
