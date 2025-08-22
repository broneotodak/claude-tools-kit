#!/usr/bin/env node

/**
 * THR Pipeline Wiring Test
 * Tests that THR tools are properly wired into orchestration
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.join(__dirname, '..', 'cli.mjs');

console.log('🧪 THR Pipeline Wiring Test\n');
console.log('=' .repeat(60));

const tests = [];

/**
 * Test 1: THR project detection
 */
async function testProjectDetection() {
  console.log('\n📋 Test 1: THR Project Detection');
  
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, 'detect'], {
      cwd: path.resolve(__dirname, '../../../THR'),
      env: { ...process.env, CTK_PROJECT: 'THR' }
    });
    
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => output += data.toString());
    
    child.on('close', (code) => {
      const passed = output.includes('THR') && output.includes('immutable');
      tests.push({ 
        name: 'Project Detection', 
        passed,
        details: passed ? 'THR detected with immutable mode' : 'Failed to detect THR'
      });
      console.log(passed ? '  ✅ THR detected correctly' : '  ❌ Failed to detect THR');
      resolve();
    });
  });
}

/**
 * Test 2: THR tools are registered
 */
async function testToolRegistry() {
  console.log('\n📋 Test 2: THR Tool Registry');
  
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, 'list-tools'], {
      env: { ...process.env }
    });
    
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    
    child.on('close', (code) => {
      const hasMemory = output.includes('memory') && output.includes('THR-CTK');
      const hasValidation = output.includes('validation') && output.includes('THR-CTK');
      const hasQA = output.includes('qa') && output.includes('THR-CTK');
      const hasSecurity = output.includes('security') && output.includes('THR-CTK');
      
      const passed = hasMemory && hasValidation && hasQA && hasSecurity;
      tests.push({ 
        name: 'Tool Registry', 
        passed,
        details: `Memory: ${hasMemory}, Validation: ${hasValidation}, QA: ${hasQA}, Security: ${hasSecurity}`
      });
      console.log(passed ? '  ✅ All THR tools registered' : '  ❌ Some THR tools missing');
      resolve();
    });
  });
}

/**
 * Test 3: Dry run THR orchestration
 */
async function testDryRun() {
  console.log('\n📋 Test 3: THR Dry Run');
  
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, 'orchestrate', '--project', 'THR', '--dry-run'], {
      env: { ...process.env, CTK_APPROVED: '1' }
    });
    
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => output += data.toString());
    
    child.on('close', (code) => {
      const passed = code === 0 && output.includes('[DRY RUN]');
      tests.push({ 
        name: 'Dry Run', 
        passed,
        details: passed ? 'Dry run completed successfully' : `Exit code: ${code}`
      });
      console.log(passed ? '  ✅ Dry run successful' : `  ❌ Dry run failed (exit ${code})`);
      resolve();
    });
  });
}

/**
 * Test 4: THR gates are applied
 */
async function testGates() {
  console.log('\n📋 Test 4: THR Acceptance Gates');
  
  // This would need a mock setup to test properly
  // For now, we just verify the gates module loads
  try {
    const gates = await import('../thr_gates.mjs');
    const hasMemoryGate = typeof gates.memoryGate === 'function';
    const hasValidationGate = typeof gates.validationGate === 'function';
    const hasQAGate = typeof gates.qaGate === 'function';
    const hasSecurityGate = typeof gates.securityGate === 'function';
    
    const passed = hasMemoryGate && hasValidationGate && hasQAGate && hasSecurityGate;
    tests.push({ 
      name: 'Acceptance Gates', 
      passed,
      details: 'All gate functions defined'
    });
    console.log(passed ? '  ✅ All gates defined' : '  ❌ Some gates missing');
  } catch (error) {
    tests.push({ 
      name: 'Acceptance Gates', 
      passed: false,
      details: error.message
    });
    console.log('  ❌ Failed to load gates:', error.message);
  }
}

/**
 * Test 5: Strict mode enforcement
 */
async function testStrictMode() {
  console.log('\n📋 Test 5: Strict Mode Enforcement');
  
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, 'orchestrate', '--project', 'THR', '--mode', 'hybrid', '--dry-run'], {
      env: { ...process.env, CTK_APPROVED: '1' }
    });
    
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    child.stderr.on('data', (data) => output += data.toString());
    
    child.on('close', (code) => {
      // Should still use sequential mode despite --mode hybrid
      const passed = output.includes('sequential') || output.includes('SEQUENTIAL');
      tests.push({ 
        name: 'Strict Mode', 
        passed,
        details: passed ? 'THR enforced sequential mode' : 'Failed to enforce sequential'
      });
      console.log(passed ? '  ✅ Strict mode enforced' : '  ❌ Strict mode not enforced');
      resolve();
    });
  });
}

/**
 * Test 6: Baton passing
 */
async function testBatonPassing() {
  console.log('\n📋 Test 6: Baton Data Passing');
  
  // This tests that data flows between tools
  try {
    const { applyGate } = await import('../thr_gates.mjs');
    
    // Simulate successful memory save with CTK_STRICT_MODE
    process.env.CTK_STRICT_MODE = '1';
    const memoryResult = { artifacts: { saved: true, thr: true } };
    const baton = {};
    
    const gateResult = applyGate('memory', memoryResult, baton);
    
    const passed = gateResult.accept && 
                   gateResult.baton.memory_gate && 
                   gateResult.baton.memory_artifacts;
    
    tests.push({ 
      name: 'Baton Passing', 
      passed,
      details: passed ? 'Baton updated correctly' : 'Baton not updated'
    });
    console.log(passed ? '  ✅ Baton passing works' : '  ❌ Baton passing failed');
  } catch (error) {
    tests.push({ 
      name: 'Baton Passing', 
      passed: false,
      details: error.message
    });
    console.log('  ❌ Baton test failed:', error.message);
  }
}

// Run all tests
async function runTests() {
  await testProjectDetection();
  await testToolRegistry();
  await testDryRun();
  await testGates();
  await testStrictMode();
  await testBatonPassing();
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 TEST SUMMARY\n');
  
  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;
  
  tests.forEach(test => {
    const icon = test.passed ? '✅' : '❌';
    console.log(`${icon} ${test.name}: ${test.details}`);
  });
  
  console.log('\n' + '-' .repeat(60));
  console.log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed}`);
  
  const allPassed = failed === 0;
  if (allPassed) {
    console.log('\n🎉 All THR pipeline tests passed!');
  } else {
    console.log('\n⚠️ Some tests failed - review THR wiring');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run the tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});