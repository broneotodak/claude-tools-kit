#!/usr/bin/env node

/**
 * Tool Launcher
 * Resolves registry, picks adapter, runs tool, returns normalized result
 */

import { resolveTool } from './registry.mjs';
import {
  memoryAdapter,
  sqlAdapter,
  validationAdapter,
  qaAdapter,
  securityAdapter,
  guardStrictMode
} from './adapters.mjs';

/**
 * Map role to appropriate adapter
 */
const ROLE_ADAPTERS = {
  memory: memoryAdapter,
  sql: sqlAdapter,
  validation: validationAdapter,
  qa: qaAdapter,
  security: securityAdapter,
  env: sqlAdapter  // Reuse SQL adapter for env scripts
};

/**
 * Run a specific role with its adapter
 * @param {string} role - The role to execute
 * @param {object} baton - Data to pass between roles
 * @param {object} options - Execution options including project
 * @returns {object} - Normalized result { artifacts, tokensIn, tokensOut, toolCalls }
 */
export async function runRole(role, baton = {}, options = {}) {
  const { project } = options;
  
  // Set strict mode if THR project
  if (project === 'THR') {
    guardStrictMode();
  }
  
  try {
    // Resolve tool path from registry
    const toolInfo = resolveTool(role);
    console.log(`  → Executing ${role} from ${toolInfo.source} [${toolInfo.path}]`);
    
    // Get appropriate adapter
    const adapter = ROLE_ADAPTERS[role];
    if (!adapter) {
      throw new Error(`No adapter configured for role: ${role}`);
    }
    
    // Execute with adapter
    const result = await adapter(toolInfo.path, baton);
    
    // Ensure normalized shape
    const normalized = {
      artifacts: result.artifacts || {},
      tokensIn: result.tokensIn || 0,
      tokensOut: result.tokensOut || 0,
      toolCalls: result.toolCalls || 1
    };
    
    return normalized;
    
  } catch (error) {
    console.error(`  ✗ Failed to execute ${role}: ${error.message}`);
    
    // Return error artifacts in normalized shape
    return {
      artifacts: { 
        error: error.message, 
        ok: false,
        role 
      },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 0
    };
  }
}

/**
 * Dry run a role (for testing)
 * Returns mock data instead of executing real tool
 */
export async function dryRunRole(role, baton = {}) {
  console.log(`  → [DRY RUN] ${role}`);
  
  // Mock responses for testing
  const mockResults = {
    memory: {
      artifacts: { saved: true },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    },
    sql: {
      artifacts: { success: true, rows: 0 },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    },
    validation: {
      artifacts: { ok: true, issues: [] },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    },
    qa: {
      artifacts: { testsPassed: true },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    },
    security: {
      artifacts: { audit: true, ok: true },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    },
    env: {
      artifacts: { configured: true },
      tokensIn: 0,
      tokensOut: 0,
      toolCalls: 1
    }
  };
  
  // Simulate async delay
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));
  
  return mockResults[role] || {
    artifacts: { unknown: true },
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 1
  };
}

/**
 * Check if a role is available
 */
export function isRoleAvailable(role) {
  try {
    resolveTool(role);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all available roles
 */
export function listAvailableRoles() {
  const allRoles = Object.keys(ROLE_ADAPTERS);
  return allRoles.filter(role => isRoleAvailable(role));
}

export default {
  runRole,
  dryRunRole,
  isRoleAvailable,
  listAvailableRoles
};