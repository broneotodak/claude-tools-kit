#!/usr/bin/env node

/**
 * Subagent Runner for CTK Orchestration
 * Integrates Claude Code subagents with orchestration workflows
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Invoke a Claude Code subagent
 * @param {string} agentName - Name of the subagent (without .md extension)
 * @param {string} prompt - Prompt/task for the subagent
 * @param {object} options - Additional options
 * @returns {Promise<object>} - Subagent result
 */
export async function invokeSubagent(agentName, prompt, options = {}) {
  const {
    timeout = 300000, // 5 minutes default
    cwd = process.cwd(),
    inheritEnv = true,
  } = options;

  console.log(`\n🤖 Invoking subagent: ${agentName}`);
  console.log(`   Prompt: ${prompt.substring(0, 100)}...`);

  try {
    // Check if subagent exists
    const agentPath = path.join(
      process.env.HOME,
      '.claude',
      'agents',
      `${agentName}.md`
    );

    if (!fs.existsSync(agentPath)) {
      throw new Error(`Subagent not found: ${agentPath}`);
    }

    // Build command to invoke subagent via Task tool
    // Note: This is a simplified version - actual implementation would use MCP/API
    const command = `claude "${prompt}" --agent ${agentName}`;

    console.log(`   Executing: ${command}`);

    const result = execSync(command, {
      cwd,
      timeout,
      encoding: 'utf8',
      env: inheritEnv ? process.env : {},
      stdio: 'pipe',
    });

    console.log(`   ✅ Subagent completed successfully`);

    return {
      success: true,
      output: result,
      agent: agentName,
    };
  } catch (error) {
    console.error(`   ❌ Subagent failed: ${error.message}`);

    return {
      success: false,
      error: error.message,
      agent: agentName,
    };
  }
}

/**
 * Run multiple subagents in parallel
 * @param {Array<{agent: string, prompt: string}>} tasks - Array of subagent tasks
 * @param {object} options - Options
 * @returns {Promise<Array>} - Array of results
 */
export async function runSubagentsParallel(tasks, options = {}) {
  const { maxConcurrent = 3 } = options;

  console.log(`\n🚀 Running ${tasks.length} subagents in parallel (max ${maxConcurrent} concurrent)`);

  const results = [];
  const executing = [];

  for (const task of tasks) {
    const promise = invokeSubagent(task.agent, task.prompt, task.options).then(
      (result) => {
        executing.splice(executing.indexOf(promise), 1);
        return result;
      }
    );

    executing.push(promise);
    results.push(promise);

    // Limit concurrent executions
    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  // Wait for all to complete
  return Promise.all(results);
}

/**
 * Integration with CTK orchestration
 * Allows orchestration phases to use subagents
 */
export class SubagentOrchestrator {
  constructor(config = {}) {
    this.config = config;
    this.results = [];
  }

  /**
   * Add subagent task to orchestration
   */
  addTask(agentName, prompt, phase = 'default') {
    if (!this.config.phases) {
      this.config.phases = {};
    }

    if (!this.config.phases[phase]) {
      this.config.phases[phase] = [];
    }

    this.config.phases[phase].push({
      type: 'subagent',
      agent: agentName,
      prompt: prompt,
    });
  }

  /**
   * Execute orchestration with subagents
   */
  async execute() {
    console.log('\n📋 Subagent Orchestration');
    console.log(`   Phases: ${Object.keys(this.config.phases).length}`);

    for (const [phaseName, tasks] of Object.entries(this.config.phases)) {
      console.log(`\n▶️  Phase: ${phaseName}`);
      console.log(`   Tasks: ${tasks.length}`);

      const subagentTasks = tasks.filter((t) => t.type === 'subagent');

      if (subagentTasks.length > 0) {
        const results = await runSubagentsParallel(subagentTasks);
        this.results.push(...results);
      }
    }

    return {
      success: this.results.every((r) => r.success),
      results: this.results,
    };
  }
}

/**
 * Example usage for THR project
 */
export function createTHROrchestration() {
  const orchestrator = new SubagentOrchestrator();

  // Phase 1: Data validation
  orchestrator.addTask(
    'ctk-data-validator',
    'Validate employee data before migration',
    'validation'
  );

  // Phase 2: Database operations
  orchestrator.addTask(
    'ctk-sql-runner',
    'Run leave balance migration SQL',
    'migration'
  );

  // Phase 3: Memory save
  orchestrator.addTask(
    'ctk-memory-manager',
    'Save migration results to memory',
    'completion'
  );

  return orchestrator;
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === 'test') {
    console.log('🧪 Testing subagent orchestration...\n');

    const orchestrator = createTHROrchestration();
    orchestrator.execute().then((result) => {
      console.log('\n📊 Orchestration Result:');
      console.log(JSON.stringify(result, null, 2));
    });
  } else if (command === 'invoke') {
    const [, , , agent, ...promptParts] = process.argv;
    const prompt = promptParts.join(' ');

    invokeSubagent(agent, prompt).then((result) => {
      console.log('\n📊 Subagent Result:');
      console.log(JSON.stringify(result, null, 2));
    });
  } else {
    console.log(`
Subagent Runner for CTK Orchestration

Usage:
  node subagent_runner.mjs test                    - Test orchestration
  node subagent_runner.mjs invoke <agent> <prompt> - Invoke single subagent

Examples:
  node subagent_runner.mjs test
  node subagent_runner.mjs invoke ctk-memory-manager "save progress on Phase 2"
`);
  }
}
