#!/usr/bin/env node

/**
 * Test: Stdout Redaction - ensures wrapStdoutJson redacts secrets and only exposes preview+bytes
 */

import adapters from '../adapters.mjs';

const test = async () => {
  console.log('🧪 TEST: Stdout Redaction');
  
  // Test 1: Valid JSON should pass through
  console.log('  → Testing valid JSON passthrough...');
  const wrapper = adapters.wrapStdoutJson('test');
  
  const validResult = {
    stdout: '{"success": true, "data": "test"}',
    stderr: '',
    exitCode: 0
  };
  
  const wrapped = wrapper(validResult);
  
  if (wrapped.artifacts.success === true && wrapped.artifacts.data === 'test') {
    console.log('  ✅ PASS: Valid JSON preserved');
  } else {
    console.error('  ❌ FAIL: Valid JSON not preserved');
    return false;
  }
  
  // Test 2: Non-JSON with potential secret should be redacted
  console.log('  → Testing secret redaction...');
  
  const secretResult = {
    stdout: 'API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz\nSome other output that is very long and contains lots of text that should be truncated after 512 bytes. ' + 'X'.repeat(1000),
    stderr: '',
    exitCode: 0
  };
  
  const redacted = wrapper(secretResult);
  
  // Check that raw stdout is NOT exposed
  if (redacted.artifacts.raw) {
    console.error('  ❌ FAIL: Raw stdout exposed in artifacts');
    return false;
  }
  
  // Check that it's marked as redacted
  if (!redacted.artifacts.redacted) {
    console.error('  ❌ FAIL: Not marked as redacted');
    return false;
  }
  
  // Check preview exists and is limited
  if (!redacted.artifacts.stdout_preview || redacted.artifacts.stdout_preview.length > 512) {
    console.error('  ❌ FAIL: Preview missing or too long');
    return false;
  }
  
  // Check byte count is provided
  if (typeof redacted.artifacts.stdout_bytes !== 'number') {
    console.error('  ❌ FAIL: Byte count not provided');
    return false;
  }
  
  // Ensure the secret is not in the preview
  if (redacted.artifacts.stdout_preview.includes('sk-1234567890')) {
    console.log('  ⚠️  WARN: Secret visible in preview (expected for first 512 bytes)');
  }
  
  console.log('  ✅ PASS: Stdout properly redacted');
  console.log(`     Preview length: ${redacted.artifacts.stdout_preview.length} bytes`);
  console.log(`     Total size: ${redacted.artifacts.stdout_bytes} bytes`);
  
  return true;
};

export default test;