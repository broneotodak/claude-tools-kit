#!/usr/bin/env node

/**
 * Security Validation
 * Counters-only checks for PII, secrets, and size limits
 * Never logs raw content
 */

// PII patterns (simplified for demonstration)
const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,  // SSN
  /\b\d{12}\b/,              // IC number (Malaysia)
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,  // Email
  /\b\d{10,11}\b/,           // Phone numbers
  /\b\d{16}\b/,              // Credit card
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/i,  // Dates of birth
];

// Secret patterns
const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*["']?[\w-]{20,}["']?/i,
  /\b(?:password|passwd|pwd)\s*[:=]\s*["']?.+["']?/i,
  /\bBearer\s+[\w-]{20,}/i,
  /\b(?:AWS|aws)[_-]?(?:access|secret)[_-]?(?:key|id)\s*[:=]\s*["']?[\w-]+["']?/i,
  /\bsk[_-](?:test|live)[_-][\w]{24,}/,  // Stripe keys
  /\bghp_[\w]{36}/,  // GitHub personal tokens
  /\bnpm_[\w]{36}/,  // npm tokens
];

export function validateArtifacts(artifacts) {
  if (!artifacts) {
    return { valid: true, issues: [] };
  }
  
  // Convert to string for checking (but don't log it)
  let jsonString;
  try {
    jsonString = typeof artifacts === 'string' ? artifacts : JSON.stringify(artifacts);
  } catch (error) {
    throw new Error('Security validation failed: Cannot serialize artifacts');
  }
  
  const issues = [];
  let piiCount = 0;
  let secretCount = 0;
  
  // Check for PII
  for (const pattern of PII_PATTERNS) {
    const matches = jsonString.match(pattern);
    if (matches) {
      piiCount += matches.length;
    }
  }
  
  if (piiCount > 0) {
    issues.push(`Contains ${piiCount} potential PII item(s)`);
  }
  
  // Check for secrets
  for (const pattern of SECRET_PATTERNS) {
    const matches = jsonString.match(pattern);
    if (matches) {
      secretCount += matches.length;
    }
  }
  
  if (secretCount > 0) {
    issues.push(`Contains ${secretCount} potential secret(s)`);
  }
  
  // Check size (1MB limit)
  const sizeBytes = new Blob([jsonString]).size;
  const sizeMB = sizeBytes / (1024 * 1024);
  
  if (sizeMB > 1) {
    issues.push(`Artifact too large: ${sizeMB.toFixed(2)}MB (limit: 1MB)`);
  }
  
  // Throw if any issues found
  if (issues.length > 0) {
    throw new Error(`Security validation failed: ${issues.join('; ')}`);
  }
  
  return {
    valid: true,
    counters: {
      pii: piiCount,
      secrets: secretCount,
      sizeMB: sizeMB.toFixed(2)
    }
  };
}

export function createSecurityContext(projectMode) {
  const isStrict = projectMode.security === 'strict';
  
  return {
    validateRequired: isStrict,
    maxSizeMB: isStrict ? 1 : 10,
    allowPII: !isStrict,
    allowSecrets: false,  // Never allow secrets
    auditMode: isStrict
  };
}

export default { validateArtifacts, createSecurityContext };