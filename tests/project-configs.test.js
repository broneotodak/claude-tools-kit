const fs = require('fs');
const path = require('path');

const PROJECTS_DIR = path.join(__dirname, '..', 'projects');

describe('Project Configs', () => {
  const projects = fs.readdirSync(PROJECTS_DIR).filter(f =>
    fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory()
  );

  test('at least 2 projects configured', () => {
    expect(projects.length).toBeGreaterThanOrEqual(2);
  });

  projects.forEach(project => {
    describe(project, () => {
      const configPath = path.join(PROJECTS_DIR, project, 'config.json');

      test('has config.json', () => {
        expect(fs.existsSync(configPath)).toBe(true);
      });

      test('config.json is valid JSON with required fields', () => {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        expect(config).toHaveProperty('project');
        expect(config).toHaveProperty('name');
        expect(typeof config.project).toBe('string');
        expect(typeof config.name).toBe('string');
      });

      test('config.json has database or deployment info', () => {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const hasDb = config.database !== undefined;
        const hasDeploy = config.deployment !== undefined;
        expect(hasDb || hasDeploy).toBe(true);
      });
    });
  });
});
