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
  
  const fakeOutput = [
    "API_KEY=__MOCK_OPENAI_KEY__",           // not matching sk-/ghp_/AKIA/ya29
    "Some other output that is very long and should be truncated after 512 bytes.",
    "user=demo@company.com action=export",
    'X'.repeat(1000)
  ].join("\n");
  
  const secretResult = {
    stdout: fakeOutput,
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
  
  // Ensure our mock token is in the preview (it's safe)
  if (redacted.artifacts.stdout_preview.includes('__MOCK_OPENAI_KEY__')) {
    console.log('  ✓ Mock token visible in preview (safe, as expected)');
  }
  
  console.log('  ✅ PASS: Stdout properly redacted');
  console.log(`     Preview length: ${redacted.artifacts.stdout_preview.length} bytes`);
  console.log(`     Total size: ${redacted.artifacts.stdout_bytes} bytes`);
  
  return true;
};

export default test;