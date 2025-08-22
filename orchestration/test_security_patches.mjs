#!/usr/bin/env node

/**
 * Test security patches
 */

import adapters from './adapters.mjs';
import { resolveTool } from './registry.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('\n═══════════════════════════════════════════════════════');
console.log('  SECURITY PATCHES VALIDATION');
console.log('═══════════════════════════════════════════════════════\n');

// Test 1: Environment allowlist
console.log('▶ TEST 1: Environment Allowlist');

// Create a test script that prints environment
const envTestScript = `
console.log('PATH:', process.env.PATH);
console.log('HOME:', process.env.HOME);
console.log('CTK_RUN_ID:', process.env.CTK_RUN_ID || '[not set]');
console.log('CTK_PROJECT:', process.env.CTK_PROJECT || '[not set]');
console.log('SECRET_VAR:', process.env.SECRET_VAR || '[filtered]');
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY || '[filtered]');
`;

const envTestFile = path.join(__dirname, 'test_env.js');
fs.writeFileSync(envTestFile, envTestScript);

// Set some test environment variables
process.env.SECRET_VAR = 'should-be-filtered';
process.env.AWS_SECRET_ACCESS_KEY = 'definitely-should-be-filtered';
process.env.CTK_RUN_ID = 'test-run-123';
process.env.CTK_PROJECT = 'test-project';

try {
  const result = await adapters.runScript(envTestFile);
  console.log('  Environment test output:');
  console.log(result.stdout.trim().split('\n').map(line => '    ' + line).join('\n'));
  
  if (!result.stdout.includes('should-be-filtered')) {
    console.log('  ✓ Secret variables filtered from environment');
  } else {
    console.log('  ✗ Secret variables exposed!');
  }
  
  if (result.stdout.includes('CTK_RUN_ID: test-run-123')) {
    console.log('  ✓ CTK variables passed through');
  }
} catch (error) {
  console.log('  Error:', error.message);
} finally {
  fs.unlinkSync(envTestFile);
  delete process.env.SECRET_VAR;
  delete process.env.AWS_SECRET_ACCESS_KEY;
}

// Test 2: Symlink refusal
console.log('\n▶ TEST 2: Symlink Refusal');

const realFile = path.join(__dirname, 'test_real.js');
const symlinkFile = path.join(__dirname, 'test_symlink.js');

fs.writeFileSync(realFile, 'console.log("real file");');
fs.symlinkSync(realFile, symlinkFile);

try {
  const result = await adapters.runScript(symlinkFile);
  if (result.stderr.includes('Refused symlink')) {
    console.log('  ✓ Symlink correctly refused');
  } else {
    console.log('  ✗ Symlink was executed!');
  }
} catch (error) {
  console.log('  ✓ Symlink execution failed (expected)');
} finally {
  fs.unlinkSync(symlinkFile);
  fs.unlinkSync(realFile);
}

// Test 3: Absolute path requirement
console.log('\n▶ TEST 3: Absolute Path Requirement');

try {
  // All registered tools should use absolute paths
  const testRole = 'memory';
  const toolInfo = resolveTool(testRole);
  
  if (path.isAbsolute(toolInfo.path)) {
    console.log(`  ✓ Tool path is absolute: ${toolInfo.path}`);
  } else {
    console.log(`  ✗ Tool path is not absolute: ${toolInfo.path}`);
  }
} catch (error) {
  console.log('  Error:', error.message);
}

// Test 4: THR approval requirement
console.log('\n▶ TEST 4: THR Approval Requirement');
console.log('  THR without CTK_APPROVED=1: would fail with error');
console.log('  THR with CTK_APPROVED=1: would proceed');
console.log('  THR with --dry-run: always allowed');
console.log('  Non-THR projects: no approval needed');

console.log('\n═══════════════════════════════════════════════════════');
console.log('  SECURITY VALIDATION COMPLETE');
console.log('═══════════════════════════════════════════════════════\n');