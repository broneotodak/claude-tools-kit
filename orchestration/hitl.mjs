#!/usr/bin/env node

/**
 * Human-In-The-Loop (HITL) Approval Gates
 * Pause for human approval at phase boundaries
 */

import readline from 'readline';

/**
 * Request human approval at a checkpoint
 * @param {object} context - Context about what needs approval
 * @returns {Promise<boolean>} - True if approved, false if rejected
 */
export async function requestApproval(context) {
  // Skip if HITL not enabled
  if (process.env.CTK_HITL !== '1') {
    return true; // Auto-continue
  }
  
  // Format the approval request
  console.log('\n' + '═'.repeat(60));
  console.log('  🔔 HUMAN APPROVAL REQUIRED');
  console.log('═'.repeat(60));
  
  // Show phase information
  if (context.phase) {
    console.log(`\n📍 Phase: ${context.phase}`);
  }
  
  // Show agents to be executed
  if (context.agents && context.agents.length > 0) {
    console.log(`\n🤖 Agents to execute:`);
    context.agents.forEach(agent => {
      console.log(`   • ${agent}`);
    });
  }
  
  // Show execution mode
  if (context.mode) {
    console.log(`\n⚙️  Execution mode: ${context.mode}`);
  }
  
  // Show current baton state (keys only, not content)
  if (context.batonKeys && context.batonKeys.length > 0) {
    console.log(`\n📦 Data from previous phases:`);
    context.batonKeys.forEach(key => {
      console.log(`   • ${key}: [present]`);
    });
  }
  
  // Show summary if provided
  if (context.summary) {
    console.log(`\n📋 Summary:`);
    console.log(`   ${context.summary}`);
  }
  
  // Show diffs if provided (for reviewing changes)
  if (context.diffs && context.diffs.length > 0) {
    console.log(`\n📝 Changes to review:`);
    context.diffs.forEach(diff => {
      console.log(`   • ${diff}`);
    });
  }
  
  // THR-specific warning
  if (context.project === 'THR') {
    console.log(`\n⚠️  THR PROJECT: This approval is MANDATORY`);
    console.log(`   Security and acceptance gates cannot be bypassed.`);
  }
  
  console.log('\n' + '─'.repeat(60));
  
  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('Press ENTER to continue, or type "abort" to stop: ', (answer) => {
      rl.close();
      
      if (answer.toLowerCase() === 'abort') {
        console.log('\n❌ Execution aborted by user\n');
        process.exit(1);
      } else {
        console.log('\n✅ Approved - continuing execution\n');
        resolve(true);
      }
    });
  });
}

/**
 * Request approval with a timeout
 * @param {object} context - Approval context
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if approved, false if timeout
 */
export async function requestApprovalWithTimeout(context, timeoutMs = 30000) {
  if (process.env.CTK_HITL !== '1') return true;
  
  // THR projects must never auto-continue; require explicit approval
  if (context?.project === 'THR') {
    return requestApproval(context);
  }
  
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.log(`\n⏱️  Approval timeout (${timeoutMs}ms) - auto-continuing\n`);
      resolve(true);
    }, timeoutMs);
  });
  
  const approvalPromise = requestApproval(context);
  
  return Promise.race([approvalPromise, timeoutPromise]);
}

/**
 * Check if HITL is required for a project
 * @param {string} project - Project name
 * @returns {boolean} - True if HITL should be enforced
 */
export function isHITLRequired(project) {
  // THR always requires HITL if enabled
  if (project === 'THR' && process.env.CTK_HITL === '1') {
    return true;
  }
  
  // Other projects only if explicitly enabled
  return process.env.CTK_HITL === '1';
}

/**
 * Format a phase summary for HITL review
 * @param {object} phase - Phase configuration
 * @param {object} metrics - Phase execution metrics
 * @returns {string} - Formatted summary
 */
export function formatPhaseSummary(phase, metrics) {
  const lines = [];
  
  lines.push(`Phase: ${phase.name}`);
  lines.push(`Mode: ${phase.mode}`);
  lines.push(`Agents: ${phase.agents.join(', ')}`);
  
  if (metrics) {
    lines.push(`Duration: ${metrics.duration}ms`);
    lines.push(`Tokens: ${metrics.tokensIn} in, ${metrics.tokensOut} out`);
    lines.push(`Tool calls: ${metrics.toolCalls}`);
  }
  
  return lines.join('\n');
}

/**
 * Log HITL decision for audit
 * @param {string} decision - 'approved' or 'rejected'
 * @param {object} context - The approval context
 */
export function logHITLDecision(decision, context) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    decision,
    phase: context.phase,
    project: context.project,
    user: process.env.USER || 'unknown'
  };
  
  // Log to console (could be extended to file/database)
  console.log(`[HITL AUDIT] ${JSON.stringify(logEntry)}`);
}

export default {
  requestApproval,
  requestApprovalWithTimeout,
  isHITLRequired,
  formatPhaseSummary,
  logHITLDecision
};