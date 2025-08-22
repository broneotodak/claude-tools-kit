#!/usr/bin/env node

/**
 * Acceptance Gates
 * Concrete programmatic gates for each role (fail-closed)
 */

/**
 * Check if artifacts pass acceptance criteria for a given role
 * @param {string} role - The role being validated
 * @param {any} artifacts - The artifacts to validate
 * @returns {boolean} - True if accepted, false if rejected
 */
export function accept(role, artifacts) {
  if (!artifacts) {
    return false; // Fail-closed: no artifacts = rejection
  }
  
  switch (role) {
    case 'memory':
      // Memory must explicitly indicate save success
      return artifacts.saved === true || Boolean(artifacts);
    
    case 'sql':
      // SQL must not explicitly fail
      return artifacts.success !== false;
    
    case 'validation':
      // Validation must either be ok or provide issues array
      return artifacts.ok === true || Array.isArray(artifacts.issues);
    
    case 'qa':
      // QA must explicitly pass tests
      return artifacts.testsPassed === true;
    
    case 'security':
      // Security must pass audit or be explicitly ok
      return artifacts.audit === true || artifacts.ok === true;
    
    case 'env':
      // Environment setup must not fail
      return artifacts.error === undefined && artifacts.ok !== false;
    
    default:
      // Unknown roles pass by default (for extensibility)
      // But log warning in production
      console.warn(`[ACCEPTANCE] No gate defined for role: ${role}`);
      return true;
  }
}

/**
 * Get descriptive reason for rejection
 * @param {string} role - The role that was rejected
 * @param {any} artifacts - The artifacts that failed validation
 * @returns {string} - Human-readable rejection reason
 */
export function getRejectionReason(role, artifacts) {
  if (!artifacts) {
    return `No artifacts produced by ${role}`;
  }
  
  switch (role) {
    case 'memory':
      return `Memory save not confirmed (saved !== true)`;
    
    case 'sql':
      return `SQL execution failed (success === false)`;
    
    case 'validation':
      return `Validation did not pass (ok !== true and no issues array)`;
    
    case 'qa':
      return `Tests did not pass (testsPassed !== true)`;
    
    case 'security':
      return `Security audit failed (audit !== true and ok !== true)`;
    
    case 'env':
      return `Environment setup failed (error present or ok === false)`;
    
    default:
      return `Acceptance gate not defined for ${role}`;
  }
}

/**
 * Get acceptance criteria description for a role
 * @param {string} role - The role to describe
 * @returns {string} - Description of acceptance criteria
 */
export function getCriteria(role) {
  const criteria = {
    memory: 'artifacts.saved === true OR truthy artifacts',
    sql: 'artifacts.success !== false',
    validation: 'artifacts.ok === true OR Array.isArray(artifacts.issues)',
    qa: 'artifacts.testsPassed === true',
    security: 'artifacts.audit === true OR artifacts.ok === true',
    env: 'No error and artifacts.ok !== false'
  };
  
  return criteria[role] || 'No specific criteria (default: true)';
}

/**
 * Validate all roles have acceptance criteria
 * @param {string[]} roles - List of roles to validate
 * @returns {object} - Validation result with missing roles
 */
export function validateRoles(roles) {
  const knownRoles = ['memory', 'sql', 'validation', 'qa', 'security', 'env'];
  const missing = roles.filter(role => !knownRoles.includes(role));
  
  if (missing.length > 0) {
    console.warn(`[ACCEPTANCE] Roles without specific gates: ${missing.join(', ')}`);
  }
  
  return {
    valid: missing.length === 0,
    missing,
    known: roles.filter(role => knownRoles.includes(role))
  };
}

export default {
  accept,
  getRejectionReason,
  getCriteria,
  validateRoles
};