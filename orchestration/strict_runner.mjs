#!/usr/bin/env node

/**
 * Strict Sequential Runner
 * Enforces sequential execution with security validation and metrics
 */

import detectProjectMode from './project_mode.mjs';
import validateConfig from './config.schema.mjs';
import { recordMetrics, generateRunId, printFinalSummary } from './metrics.mjs';
import { validateArtifacts, createSecurityContext } from './security.mjs';
import { runRole, dryRunRole } from './launcher.mjs';
import { accept, getRejectionReason } from './acceptance.mjs';

/**
 * Run agents sequentially with validation and metrics
 */
async function runSequential(config, projectMode, isDryRun = false) {
  const runId = generateRunId();
  const securityContext = createSecurityContext(projectMode);
  
  // Tag child processes and logs
  process.env.CTK_RUN_ID = runId;
  process.env.CTK_PROJECT = projectMode.project || 'default';
  
  // Set CTK_STRICT_MODE for child processes
  if (projectMode.project === 'THR') {
    process.env.CTK_STRICT_MODE = '1';
  }
  
  console.log(`\n[ORCHESTRATION] Run ID: ${runId}`);
  console.log(`[PROJECT] ${projectMode.project} mode`);
  
  if (projectMode.security === 'strict') {
    console.log('[SECURITY] Running in strict sequential mode');
  }
  
  console.log('─'.repeat(50));
  
  const results = [];
  let baton = {}; // Data passed between roles
  
  for (const role of config.agents) {
    const startTime = Date.now();
    let retries = 0;
    const maxRetries = 1;
    let success = false;
    let result;
    const timeout = parseInt(process.env.CTK_TOOL_TIMEOUT_MS || '120000');
    
    while (retries <= maxRetries && !success) {
      try {
        // Execute role through launcher with timeout
        if (isDryRun) {
          result = await dryRunRole(role, baton);
        } else {
          // Add timeout wrapper
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Tool timeout after ${timeout}ms`)), timeout);
          });
          
          const executionPromise = runRole(role, baton, { 
            project: projectMode.project,
            timeout 
          });
          
          result = await Promise.race([executionPromise, timeoutPromise]);
        }
        
        // Security validation in strict mode
        if (securityContext.validateRequired && result.artifacts) {
          validateArtifacts(result.artifacts);
        }
        
        // Acceptance gate check
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
        
        // Success - record metrics
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
        
        // Update baton with artifacts
        baton[role] = result.artifacts;
        results.push({ role, result });
        success = true;
        
      } catch (error) {
        if (retries < maxRetries) {
          retries++;
          console.log(`  ⟲ Retrying ${role} due to error: ${error.message}`);
        } else {
          console.error(`  ✗ ${role} failed after ${retries} retries:`, error.message);
          
          // Record failure metrics
          recordMetrics(runId, role, {
            elapsedMs: Date.now() - startTime,
            tokensIn: 0,
            tokensOut: 0,
            toolCalls: 0,
            ok: false,
            retries,
            gate: 'failed'
          });
          
          // In strict mode, stop on first failure
          if (projectMode.security === 'strict') {
            throw new Error(`Strict mode: Stopping due to ${role} failure after ${retries} retries`);
          }
          
          break;
        }
      }
    }
  }
  
  // Print final summary
  printFinalSummary(runId);
  
  return { runId, results, baton };
}

/**
 * Main orchestration entry point
 */
export async function runOrchestration(projectConfig, options = {}) {
  const { dryRun = false } = options;
  
  // Detect project mode
  const projectMode = detectProjectMode();
  
  // Merge detected mode with config
  const config = {
    ...projectConfig,
    project: projectMode.project,
    mode: projectMode.immutable ? projectMode.mode : (projectConfig.mode || projectMode.mode),
    security: projectMode.immutable ? projectMode.security : (projectConfig.security || projectMode.security)
  };
  
  // Validate configuration
  validateConfig(config);
  
  // For THR or sequential mode, use sequential runner
  if (config.project === 'THR' || config.mode === 'sequential') {
    return await runSequential(config, projectMode, dryRun);
  }
  
  // For now, all modes use sequential (parallel/hybrid to be implemented later)
  console.log('[INFO] Parallel/hybrid modes not yet implemented, using sequential');
  return await runSequential(config, projectMode, dryRun);
}

// Example usage (if run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  // Example THR configuration
  const exampleConfig = {
    agents: ['memory', 'validation', 'qa'],
    metadata: {
      description: 'Example THR orchestration run'
    }
  };
  
  runOrchestration(exampleConfig)
    .then(result => {
      console.log('\n✓ Orchestration completed successfully');
    })
    .catch(error => {
      console.error('\n✗ Orchestration failed:', error.message);
      process.exit(1);
    });
}

export default { runOrchestration, runSequential };