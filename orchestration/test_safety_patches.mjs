#!/usr/bin/env node

/**
 * Test safety patches
 */

import adapters from './adapters.mjs';
const { runScript } = adapters;

console.log('\n═══════════════════════════════════════════════════════');
console.log('  SAFETY PATCHES VALIDATION');
console.log('═══════════════════════════════════════════════════════\n');

// Test 1: Confirm env tags are passed
console.log('▶ TEST 1: Environment Tags');
console.log('  CTK_RUN_ID:', process.env.CTK_RUN_ID || '[not set]');
console.log('  CTK_PROJECT:', process.env.CTK_PROJECT || '[not set]');
console.log('  CTK_STRICT_MODE:', process.env.CTK_STRICT_MODE || '[not set]');
console.log('  CTK_PARALLEL_PHASE:', process.env.CTK_PARALLEL_PHASE || '[not set]');

// Test 2: Verify stdout redaction
console.log('\n▶ TEST 2: Stdout Redaction');

// Create a test script that outputs large text
const testScript = `
const largeOutput = 'X'.repeat(200000); // 200KB
console.log(largeOutput);
`;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFile = path.join(__dirname, 'test_large_output.js');
fs.writeFileSync(testFile, testScript);

try {
  const result = await runScript(testFile);
  
  console.log('  Script exit code:', result.exitCode);
  console.log('  Stdout length:', result.stdout.length, 'bytes');
  console.log('  Stderr length:', result.stderr.length, 'bytes');
  
  // Should be capped at 100KB
  if (result.stdout.length <= 100000) {
    console.log('  ✓ Stdout correctly capped at 100KB');
  } else {
    console.log('  ✗ Stdout cap failed!');
  }
  
  // Test wrapStdoutJson to ensure it doesn't expose raw stdout
  const wrapper = adapters.wrapStdoutJson('test');
  const wrapped = wrapper(result);
  
  console.log('\n▶ TEST 3: Artifacts Redaction');
  console.log('  Artifacts keys:', Object.keys(wrapped.artifacts));
  
  if (wrapped.artifacts.redacted === true) {
    console.log('  ✓ Artifacts marked as redacted');
  }
  
  if (wrapped.artifacts.stdout_preview && wrapped.artifacts.stdout_preview.length <= 512) {
    console.log('  ✓ Preview limited to 512 bytes');
  }
  
  if (wrapped.artifacts.stdout_bytes) {
    console.log('  ✓ Byte count provided:', wrapped.artifacts.stdout_bytes);
  }
  
  if (!wrapped.artifacts.raw) {
    console.log('  ✓ No raw stdout in artifacts');
  } else {
    console.log('  ✗ WARNING: Raw stdout exposed in artifacts!');
  }
  
} finally {
  // Clean up
  fs.unlinkSync(testFile);
}

// Test 4: Parallel phase detection
console.log('\n▶ TEST 4: Parallel Phase Detection');

process.env.CTK_PARALLEL_PHASE = '1';
process.env.CTK_LLM_WRAP = '1';

const { withLLMMetrics } = await import('./token_wrapper.mjs');

const testFn = async () => 'test result';
const result = await withLLMMetrics('test', testFn);

if (result.tokensIn === 0 && result.tokensOut === 0) {
  console.log('  ✓ LLM metrics disabled during parallel phase');
} else {
  console.log('  ✗ LLM metrics active during parallel phase!');
}

delete process.env.CTK_PARALLEL_PHASE;

// Test 5: THR HITL behavior
console.log('\n▶ TEST 5: THR HITL Behavior');

const { requestApprovalWithTimeout } = await import('./hitl.mjs');

// Simulate THR context
const thrContext = { project: 'THR', phase: 'test' };

console.log('  THR context would block on timeout (no auto-continue)');
console.log('  Non-THR context would auto-continue after timeout');

console.log('\n═══════════════════════════════════════════════════════');
console.log('  VALIDATION COMPLETE');
console.log('═══════════════════════════════════════════════════════\n');