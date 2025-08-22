#!/usr/bin/env node

/**
 * THR Acceptance Gates
 * Stricter validation gates for THR tools
 */

/**
 * Memory gate - validates memory was saved
 */
export function memoryGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { saved, thr } = result.artifacts;
  
  if (!saved) {
    return { accept: false, reason: 'Memory save failed' };
  }
  
  if (thr && !process.env.CTK_STRICT_MODE) {
    return { accept: false, reason: 'THR memory requires strict mode' };
  }
  
  return { accept: true };
}

/**
 * Validation gate - checks for schema issues
 */
export function validationGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { ok, issues, thr } = result.artifacts;
  
  if (!ok) {
    return { 
      accept: false, 
      reason: `Validation failed: ${issues.length} issues found`,
      issues 
    };
  }
  
  if (thr && issues && issues.length > 0) {
    // THR allows warnings but not errors
    const hasErrors = issues.some(i => i.includes('ERROR') || i.includes('FAIL'));
    if (hasErrors) {
      return { 
        accept: false, 
        reason: 'THR validation has errors',
        issues: issues.filter(i => i.includes('ERROR') || i.includes('FAIL'))
      };
    }
  }
  
  return { accept: true };
}

/**
 * QA gate - ensures tests pass
 */
export function qaGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { testsPassed, passed, failed, thr } = result.artifacts;
  
  if (!testsPassed) {
    const details = thr && failed ? ` (${failed} tests failed)` : '';
    return { 
      accept: false, 
      reason: `Tests did not pass${details}` 
    };
  }
  
  // THR requires at least 80% pass rate
  if (thr && passed !== undefined && failed !== undefined) {
    const total = passed + failed;
    if (total > 0) {
      const passRate = (passed / total) * 100;
      if (passRate < 80) {
        return { 
          accept: false, 
          reason: `THR requires 80% pass rate, got ${passRate.toFixed(1)}%` 
        };
      }
    }
  }
  
  return { accept: true };
}

/**
 * Security gate - blocks on security issues
 */
export function securityGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { ok, securityIssues, thr } = result.artifacts;
  
  if (!ok) {
    return { accept: false, reason: 'Security audit failed' };
  }
  
  // THR has zero tolerance for security issues
  if (thr && securityIssues > 0) {
    return { 
      accept: false, 
      reason: `THR found ${securityIssues} security issues - must be zero` 
    };
  }
  
  return { accept: true };
}

/**
 * SQL gate - validates migration success
 */
export function sqlGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { success } = result.artifacts;
  
  if (!success) {
    return { accept: false, reason: 'SQL migration failed' };
  }
  
  return { accept: true };
}

/**
 * Environment gate - checks env setup
 */
export function envGate(result) {
  if (!result || !result.artifacts) {
    return { accept: false, reason: 'No artifacts returned' };
  }
  
  const { ok } = result.artifacts;
  
  if (!ok) {
    return { accept: false, reason: 'Environment setup failed' };
  }
  
  // THR requires specific env vars
  if (process.env.CTK_PROJECT === 'THR') {
    const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      return { 
        accept: false, 
        reason: `THR missing required env vars: ${missing.join(', ')}` 
      };
    }
  }
  
  return { accept: true };
}

/**
 * Get gate for role
 */
export function getGate(role) {
  const gates = {
    memory: memoryGate,
    validation: validationGate,
    qa: qaGate,
    security: securityGate,
    sql: sqlGate,
    env: envGate
  };
  
  return gates[role] || null;
}

/**
 * Apply gate with baton passing
 */
export function applyGate(role, result, baton = {}) {
  const gate = getGate(role);
  if (!gate) {
    // No gate, but still update baton with artifacts
    const newBaton = { ...baton };
    if (result && result.artifacts) {
      newBaton[`${role}_artifacts`] = result.artifacts;
    }
    return { accept: true, baton: newBaton };
  }
  
  const gateResult = gate(result);
  
  // Always update baton, even if gate fails
  const newBaton = {
    ...baton,
    [`${role}_gate`]: {
      accept: gateResult.accept,
      reason: gateResult.reason || 'passed'
    }
  };
  
  // Add artifacts to baton for next tool
  if (result && result.artifacts) {
    newBaton[`${role}_artifacts`] = result.artifacts;
  }
  
  return { ...gateResult, baton: newBaton };
}

export default {
  memoryGate,
  validationGate,
  qaGate,
  securityGate,
  sqlGate,
  envGate,
  getGate,
  applyGate
};