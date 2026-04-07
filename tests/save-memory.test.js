const { detectProject } = require('../tools/save-memory');

describe('Save Memory', () => {
  test('detectProject returns a string', () => {
    const project = detectProject();
    expect(typeof project).toBe('string');
    expect(project.length).toBeGreaterThan(0);
  });

  test('detectProject returns CTK when running from CTK directory', () => {
    // We're running tests from the CTK directory
    const project = detectProject();
    expect(project).toBe('CTK');
  });

  test('save-memory.js module exports saveMemory function', () => {
    const mod = require('../tools/save-memory');
    expect(typeof mod.saveMemory).toBe('function');
    expect(typeof mod.detectProject).toBe('function');
  });

  test('universal-memory-save.js re-exports correctly', () => {
    const mod = require('../tools/universal-memory-save');
    expect(typeof mod.universalSave).toBe('function');
  });
});
