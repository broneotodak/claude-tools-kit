#!/usr/bin/env node

/**
 * Parallel/Hybrid Runner
 * Enables bounded parallel execution within phases for NON-THR projects
 */

import detectProjectMode from './project_mode.mjs';
import validateConfig from './config.schema.mjs';
import { recordMetrics, generateRunId, printFinalSummary } from './metrics.mjs';
import { validateArtifacts, createSecurityContext } from './security.mjs';
import { runRole, dryRunRole } from './launcher.mjs';
import { accept, getRejectionReason } from './acceptance.mjs';
import { requestApproval } from './hitl.mjs';

/**
 * Semaphore for bounded parallelism
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.waiting = [];
  }
  
  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    
    await new Promise(resolve => this.waiting.push(resolve));
  }
  
  release() {
    this.current--;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      this.current++;
      next();
    }
  }
}

/**
 * Run roles in parallel with bounded concurrency
 */
async function runParallelPhase(phase, projectMode, baton, runId, isDryRun = false) {
  const maxParallel = parseInt(process.env.CTK_MAX_PARALLEL || '3');
  const semaphore = new Semaphore(maxParallel);
  const securityContext = createSecurityContext(projectMode);
  
  console.log(`\n[PHASE: ${phase.name}] Running ${phase.agents.length} agents in parallel (max ${maxParallel})`);
  
  const promises = phase.agents.map(async (role) => {
    await semaphore.acquire();
    
    try {
      const startTime = Date.now();
      let retries = 0;
      const maxRetries = 1;
      let success = false;
      let result;
      
      while (retries <= maxRetries && !success) {
        try {
          // Execute role
          if (isDryRun) {
            result = await dryRunRole(role, baton);
          } else {
            result = await runRole(role, baton, { 
              project: projectMode.project,
              timeout: parseInt(process.env.CTK_TOOL_TIMEOUT_MS || '120000')
            });
          }
          
          // Security validation
          if (securityContext.validateRequired && result.artifacts) {
            validateArtifacts(result.artifacts);
          }
          
          // Acceptance gate
          if (!accept(role, result.artifacts)) {
            const reason = getRejectionReason(role, result.artifacts);
            
            if (retries < maxRetries) {
              console.log(`  ⟲ Retrying ${role}: ${reason}`);
              retries++;
              continue;
            } else {
              throw new Error(`Acceptance gate failed: ${reason}`);
            }
          }
          
          // Record metrics
          const elapsedMs = Date.now() - startTime;
          recordMetrics(runId, role, {
            elapsedMs,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            toolCalls: result.toolCalls,
            ok: true,
            retries,
            gate: 'passed'
          });
          
          success = true;
          return { role, result, success: true };
          
        } catch (error) {
          if (retries < maxRetries) {
            retries++;
            console.log(`  ⟲ Retrying ${role} due to error: ${error.message}`);
          } else {
            console.error(`  ✗ ${role} failed after ${retries} retries:`, error.message);
            
            recordMetrics(runId, role, {
              elapsedMs: Date.now() - startTime,
              tokensIn: 0,
              tokensOut: 0,
              toolCalls: 0,
              ok: false,
              retries,
              gate: 'failed'
            });
            
            return { role, error: error.message, success: false };
          }
        }
      }
    } finally {
      semaphore.release();
    }
  });
  
  const results = await Promise.all(promises);
  
  // Update baton with successful results
  const newBaton = { ...baton };
  results.forEach(r => {
    if (r.success && r.result) {
      newBaton[r.role] = r.result.artifacts;
    }
  });
  
  // Check if any critical failures
  const failures = results.filter(r => !r.success);
  if (failures.length > 0 && projectMode.security === 'strict') {
    throw new Error(`Phase ${phase.name} failed with ${failures.length} errors`);
  }
  
  return { results, baton: newBaton };
}

/**
 * Run phases sequentially, with parallel execution within phases
 */
export async function runHybrid(config, options = {}) {
  const { dryRun = false } = options;
  const runId = generateRunId();
  
  // Detect project mode
  const projectMode = detectProjectMode();
  
  // REFUSE to run for THR
  if (projectMode.project === 'THR') {
    throw new Error('FORBIDDEN: THR project must use strict sequential mode. Use strict_runner instead.');
  }
  
  // Tag environment for all child processes
  process.env.CTK_RUN_ID = runId;
  process.env.CTK_PROJECT = projectMode.project || 'default';
  
  console.log(`\n[ORCHESTRATION] Run ID: ${runId}`);
  console.log(`[PROJECT] ${projectMode.project || 'default'} mode`);
  console.log(`[MODE] Hybrid execution with parallel phases`);
  console.log('═'.repeat(50));
  
  let baton = {};
  const allResults = [];
  
  for (const phase of config.phases) {
    // Mark parallel phases; used to disable global stdout hooks
    if (phase.mode === 'parallel') {
      process.env.CTK_PARALLEL_PHASE = '1';
    } else {
      delete process.env.CTK_PARALLEL_PHASE;
    }
    
    // HITL approval at phase boundary
    if (process.env.CTK_HITL === '1') {
      const phaseSummary = {
        phase: phase.name,
        agents: phase.agents,
        mode: phase.mode,
        batonKeys: Object.keys(baton)
      };
      await requestApproval(phaseSummary);
    }
    
    if (phase.mode === 'parallel') {
      const phaseResult = await runParallelPhase(phase, projectMode, baton, runId, dryRun);
      baton = phaseResult.baton;
      allResults.push(...phaseResult.results);
    } else {
      // Sequential phase - run agents one by one
      console.log(`\n[PHASE: ${phase.name}] Running ${phase.agents.length} agents sequentially`);
      
      for (const role of phase.agents) {
        const startTime = Date.now();
        let result;
        
        try {
          if (dryRun) {
            result = await dryRunRole(role, baton);
          } else {
            result = await runRole(role, baton, { 
              project: projectMode.project,
              timeout: parseInt(process.env.CTK_TOOL_TIMEOUT_MS || '120000')
            });
          }
          
          // Validate and record
          const securityContext = createSecurityContext(projectMode);
          if (securityContext.validateRequired && result.artifacts) {
            validateArtifacts(result.artifacts);
          }
          
          if (!accept(role, result.artifacts)) {
            throw new Error(getRejectionReason(role, result.artifacts));
          }
          
          recordMetrics(runId, role, {
            elapsedMs: Date.now() - startTime,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            toolCalls: result.toolCalls,
            ok: true,
            retries: 0,
            gate: 'passed'
          });
          
          baton[role] = result.artifacts;
          allResults.push({ role, result, success: true });
          
        } catch (error) {
          console.error(`  ✗ ${role} failed:`, error.message);
          
          recordMetrics(runId, role, {
            elapsedMs: Date.now() - startTime,
            tokensIn: 0,
            tokensOut: 0,
            toolCalls: 0,
            ok: false,
            retries: 0,
            gate: 'failed'
          });
          
          allResults.push({ role, error: error.message, success: false });
          
          if (projectMode.security === 'strict') {
            throw new Error(`Sequential phase failed at ${role}`);
          }
        }
      }
    }
  }
  
  // Print final summary
  printFinalSummary(runId);
  
  return { runId, results: allResults, baton };
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const exampleConfig = {
    project: 'analytics',
    mode: 'hybrid',
    phases: [
      { name: 'foundation', mode: 'sequential', agents: ['sql'] },
      { name: 'implementation', mode: 'parallel', agents: ['memory', 'validation'] },
      { name: 'quality', mode: 'parallel', agents: ['security', 'qa'] }
    ]
  };
  
  runHybrid(exampleConfig, { dryRun: true })
    .then(result => {
      console.log('\n✓ Hybrid orchestration completed');
    })
    .catch(error => {
      console.error('\n✗ Orchestration failed:', error.message);
      process.exit(1);
    });
}

export default { runHybrid };