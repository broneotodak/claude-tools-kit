#!/usr/bin/env node

/**
 * Test: THR Safety - ensures THR refuses hybrid/parallel and accepts sequential dry-run
 */

import { runHybrid } from '../parallel_runner.mjs';
import { runOrchestration } from '../strict_runner.mjs';

const test = async () => {
  console.log('🧪 TEST: THR Safety');
  
  // Test 1: THR should refuse hybrid mode
  console.log('  → Testing THR hybrid refusal...');
  process.env.CTK_PROJECT = 'THR';
  
  try {
    await runHybrid({
      project: 'THR',
      mode: 'hybrid',
      phases: [{ name: 'test', mode: 'parallel', agents: ['memory'] }]
    }, { dryRun: true });
    
    console.error('  ❌ FAIL: THR accepted hybrid mode (should have refused)');
    return false;
  } catch (error) {
    if (error.message.includes('FORBIDDEN')) {
      console.log('  ✅ PASS: THR correctly refused hybrid mode');
    } else {
      console.error('  ❌ FAIL: Unexpected error:', error.message);
      return false;
    }
  }
  
  // Test 2: THR should accept sequential dry-run
  console.log('  → Testing THR sequential dry-run...');
  
  try {
    const result = await runOrchestration({
      agents: ['memory'],
      metadata: { test: true }
    }, { dryRun: true });
    
    if (result && result.runId) {
      console.log('  ✅ PASS: THR accepts sequential dry-run');
    } else {
      console.error('  ❌ FAIL: Invalid result from sequential run');
      return false;
    }
  } catch (error) {
    console.error('  ❌ FAIL: Sequential dry-run failed:', error.message);
    return false;
  }
  
  delete process.env.CTK_PROJECT;
  return true;
};

export default test;