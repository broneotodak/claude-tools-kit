#!/usr/bin/env node

/**
 * Test Orchestration
 * Demonstrates the orchestration system with example runs
 */

import { runOrchestration } from './strict_runner.mjs';

console.log('═'.repeat(60));
console.log('CTK ORCHESTRATION TEST');
console.log('═'.repeat(60));

// Test 1: THR Project (will enforce strict sequential)
async function testTHR() {
  console.log('\n▶ TEST 1: THR Project Orchestration');
  console.log('Expected: Strict sequential mode enforced');
  
  // Set THR context
  process.env.CTK_PROJECT = 'THR';
  
  const config = {
    agents: ['memory', 'validation', 'qa'],
    metadata: {
      task: 'THR data validation and testing',
      requestor: 'test_orchestration.mjs'
    }
  };
  
  try {
    await runOrchestration(config);
    console.log('✓ THR orchestration completed');
  } catch (error) {
    console.error('✗ THR orchestration failed:', error.message);
  }
}

// Test 2: Default Project
async function testDefault() {
  console.log('\n▶ TEST 2: Default Project Orchestration');
  console.log('Expected: Standard sequential mode');
  
  // Clear THR context
  delete process.env.CTK_PROJECT;
  
  const config = {
    agents: ['sql', 'env'],
    metadata: {
      task: 'Database and environment setup',
      requestor: 'test_orchestration.mjs'
    }
  };
  
  try {
    await runOrchestration(config);
    console.log('✓ Default orchestration completed');
  } catch (error) {
    console.error('✗ Default orchestration failed:', error.message);
  }
}

// Test 3: Invalid THR Config (should fail)
async function testInvalidTHR() {
  console.log('\n▶ TEST 3: Invalid THR Config (should fail)');
  console.log('Expected: Error - THR cannot use parallel mode');
  
  process.env.CTK_PROJECT = 'THR';
  
  const config = {
    mode: 'parallel',  // Invalid for THR
    agents: ['memory'],
    metadata: {
      task: 'Attempting parallel in THR',
      requestor: 'test_orchestration.mjs'
    }
  };
  
  try {
    await runOrchestration(config);
    console.log('✗ Should have failed but didn\'t!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.message);
  }
}

// Test 4: Missing Role (should fail)
async function testMissingRole() {
  console.log('\n▶ TEST 4: Missing Role');
  console.log('Expected: Error - No tool for backend role');
  
  delete process.env.CTK_PROJECT;
  
  const config = {
    agents: ['backend'],  // Not registered
    metadata: {
      task: 'Testing missing role',
      requestor: 'test_orchestration.mjs'
    }
  };
  
  try {
    await runOrchestration(config);
    console.log('✗ Should have failed but didn\'t!');
  } catch (error) {
    console.log('✓ Correctly rejected:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  await testTHR();
  await testDefault();
  await testInvalidTHR();
  await testMissingRole();
  
  console.log('\n' + '═'.repeat(60));
  console.log('ORCHESTRATION TESTS COMPLETE');
  console.log('═'.repeat(60));
}

runAllTests().catch(console.error);