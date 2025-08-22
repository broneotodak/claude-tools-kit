#!/usr/bin/env node

/**
 * Project Mode Detection
 * Determines project context and enforces appropriate execution mode
 */

export function detectProjectMode() {
  const cwd = process.cwd();
  const envProject = process.env.CTK_PROJECT;
  
  // Check if we're in THR project context
  const isTHR = cwd.includes('/Projects/THR') || envProject === 'THR';
  
  if (isTHR) {
    return {
      project: 'THR',
      mode: 'sequential',
      security: 'strict',
      immutable: true  // Cannot be overridden
    };
  }
  
  // Default mode for non-THR projects
  return {
    project: 'default',
    mode: 'sequential',
    security: 'standard',
    immutable: false
  };
}

export default detectProjectMode;