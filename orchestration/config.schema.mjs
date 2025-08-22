#!/usr/bin/env node

/**
 * Configuration Schema Validation
 * Enforces strict rules for THR and validates orchestration configs
 */

const ALLOWED_KEYS = [
  'project',
  'mode',
  'security',
  'agents',
  'phases',
  'metadata',
  'validation',
  'retries'
];

const ALLOWED_MODES = ['sequential', 'parallel', 'hybrid'];
const ALLOWED_SECURITY = ['strict', 'standard', 'relaxed'];

export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Config must be an object');
  }
  
  // Check for unknown keys
  const configKeys = Object.keys(config);
  const unknownKeys = configKeys.filter(key => !ALLOWED_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown config keys: ${unknownKeys.join(', ')}`);
  }
  
  // Validate mode
  if (config.mode && !ALLOWED_MODES.includes(config.mode)) {
    throw new Error(`Invalid mode: ${config.mode}. Must be one of: ${ALLOWED_MODES.join(', ')}`);
  }
  
  // Validate security
  if (config.security && !ALLOWED_SECURITY.includes(config.security)) {
    throw new Error(`Invalid security: ${config.security}. Must be one of: ${ALLOWED_SECURITY.join(', ')}`);
  }
  
  // THR-specific enforcement
  if (config.project === 'THR') {
    if (config.mode !== 'sequential') {
      throw new Error('THR project requires sequential mode. Parallel/hybrid execution not allowed.');
    }
    if (config.security !== 'strict') {
      throw new Error('THR project requires strict security mode.');
    }
  }
  
  // Phases only allowed in hybrid mode for non-THR projects
  if (config.phases && config.phases.length > 0) {
    if (config.mode !== 'hybrid') {
      throw new Error('Phases are only allowed in hybrid mode');
    }
    if (config.project === 'THR') {
      throw new Error('THR project cannot use phases (hybrid mode not allowed)');
    }
  }
  
  // Validate agents array
  if (config.agents && !Array.isArray(config.agents)) {
    throw new Error('Agents must be an array');
  }
  
  return true; // Validation passed
}

export default validateConfig;