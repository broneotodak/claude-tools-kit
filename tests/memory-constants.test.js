const { MEMORY_TYPES, MEMORY_CATEGORIES, IMPORTANCE_LEVELS } = require('../config/memory-constants');

describe('Memory Constants', () => {
  test('MEMORY_TYPES has required types', () => {
    expect(MEMORY_TYPES.TECHNICAL_SOLUTION).toBe('technical_solution');
    expect(MEMORY_TYPES.BUG_FIX).toBe('bug_fix');
    expect(MEMORY_TYPES.FEATURE).toBe('feature_implementation');
    expect(Object.keys(MEMORY_TYPES).length).toBeGreaterThanOrEqual(10);
  });

  test('MEMORY_CATEGORIES has all active projects', () => {
    expect(MEMORY_CATEGORIES.THR).toBe('THR');
    expect(MEMORY_CATEGORIES.ACADEMY).toBe('Academy');
    expect(MEMORY_CATEGORIES.MUSCLEHUB).toBe('Musclehub');
    expect(MEMORY_CATEGORIES.ASKMYLEGAL).toBe('AskMyLegal');
    expect(MEMORY_CATEGORIES.CTK).toBe('CTK');
    expect(MEMORY_CATEGORIES.OPENCLAW).toBe('OpenClaw');
    expect(MEMORY_CATEGORIES.GENERAL).toBe('General');
  });

  test('IMPORTANCE_LEVELS has correct values', () => {
    expect(IMPORTANCE_LEVELS.CRITICAL).toBe(8);
    expect(IMPORTANCE_LEVELS.HIGH).toBe(6);
    expect(IMPORTANCE_LEVELS.MEDIUM).toBe(4);
    expect(IMPORTANCE_LEVELS.LOW).toBe(2);
    expect(IMPORTANCE_LEVELS.INFO).toBe(1);
  });

  test('all MEMORY_TYPES values are lowercase snake_case', () => {
    Object.values(MEMORY_TYPES).forEach(v => {
      expect(v).toMatch(/^[a-z_]+$/);
    });
  });
});
