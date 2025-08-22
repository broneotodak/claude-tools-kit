#!/usr/bin/env node

/**
 * Tool Registry
 * Maps roles to tool implementations with THR-CTK precedence over Global CTK
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base paths
const CTK_ROOT = path.resolve(__dirname, '..');
const THR_ROOT = path.resolve(__dirname, '../../THR');

// Tool mappings with THR precedence
// Only roles with actual implementations are registered
const TOOL_REGISTRY = {
  memory: {
    thr: path.join(THR_ROOT, 'scripts/thr-memory-utils.js'),
    global: path.join(CTK_ROOT, 'tools/save-memory.js')
  },
  sql: {
    thr: null,
    global: path.join(CTK_ROOT, 'tools/run-sql-migration.js')
  },
  validation: {
    thr: null,  // check-field-access.js doesn't exist
    global: path.join(CTK_ROOT, 'tools/check-table-structure.js')
  },
  qa: {
    thr: path.join(THR_ROOT, 'scripts/test-all-modules.js'),
    global: null
  },
  security: {
    thr: path.join(THR_ROOT, '.git/hooks/pre-commit'),
    global: null
  },
  env: {
    thr: null,
    global: path.join(CTK_ROOT, 'tools/populate-env-from-credentials.js')
  }
  // Roles not registered (will throw if used):
  // - backend (no implementation yet)
  // - frontend (no implementation yet)
  // - db (no implementation yet)
  // - perf (no implementation yet)
};

export function resolveTool(role) {
  const toolPaths = TOOL_REGISTRY[role];
  
  if (!toolPaths) {
    throw new Error(`No tool registered for role: ${role}`);
  }
  
  // Check THR tool first (precedence)
  if (toolPaths.thr && fs.existsSync(toolPaths.thr)) {
    if (!path.isAbsolute(toolPaths.thr)) {
      throw new Error(`Tool path must be absolute: ${toolPaths.thr}`);
    }
    return {
      path: toolPaths.thr,
      source: 'THR-CTK',
      role
    };
  }
  
  // Fall back to Global CTK tool
  if (toolPaths.global && fs.existsSync(toolPaths.global)) {
    if (!path.isAbsolute(toolPaths.global)) {
      throw new Error(`Tool path must be absolute: ${toolPaths.global}`);
    }
    return {
      path: toolPaths.global,
      source: 'Global-CTK',
      role
    };
  }
  
  // Neither exists
  throw new Error(`No tool implementation found for role: ${role}`);
}

export function listRegisteredRoles() {
  return Object.keys(TOOL_REGISTRY);
}

export function getToolInfo(role) {
  const toolPaths = TOOL_REGISTRY[role];
  if (!toolPaths) return null;
  
  return {
    role,
    thr: toolPaths.thr ? fs.existsSync(toolPaths.thr) : false,
    global: toolPaths.global ? fs.existsSync(toolPaths.global) : false
  };
}

export default { resolveTool, listRegisteredRoles, getToolInfo };