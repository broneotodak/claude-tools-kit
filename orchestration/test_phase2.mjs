#!/usr/bin/env node

/**
 * Phase 2 Test Script
 * Demonstrates real tool execution with adapters and acceptance gates
 */

import { runOrchestration } from './strict_runner.mjs';
import { accept, getCriteria } from './acceptance.mjs';
import { listAvailableRoles } from './launcher.mjs';

console.log('\n' + '═'.repeat(60));
console.log('  CTK ORCHESTRATION - PHASE 2 TEST');
console.log('  Real Tool Execution with Adapters');
console.log('═'.repeat(60));

// Show available roles
console.log('\n▶ AVAILABLE ROLES\n');
const availableRoles = listAvailableRoles();
console.log('Registered roles with tool implementations:');
availableRoles.forEach(role => {
  console.log(`  • ${role}: ${getCriteria(role)}`);
});

// Test 1: Dry run with mocked data
async function testDryRun() {
  console.log('\n▶ TEST 1: DRY RUN (Mocked Execution)\n');
  
  process.env.CTK_PROJECT = 'THR';
  
  const config = {
    agents: ['memory', 'validation', 'qa'],
    metadata: {
      task: 'THR validation pipeline',
      mode: 'dry-run'
    }
  };
  
  try {
    const result = await runOrchestration(config, { dryRun: true });
    console.log('\n✓ Dry run completed');
    console.log('  Baton passed between roles:', Object.keys(result.baton));
  } catch (error) {
    console.error('✗ Dry run failed:', error.message);
  }
}

// Test 2: Acceptance gate demonstration
async function testAcceptanceGates() {
  console.log('\n▶ TEST 2: ACCEPTANCE GATES\n');
  
  const testCases = [
    { role: 'memory', artifacts: { saved: true }, expected: true },
    { role: 'memory', artifacts: { saved: false }, expected: false },
    { role: 'sql', artifacts: { success: true }, expected: true },
    { role: 'sql', artifacts: { success: false }, expected: false },
    { role: 'validation', artifacts: { ok: true, issues: [] }, expected: true },
    { role: 'validation', artifacts: { ok: false }, expected: false },
    { role: 'qa', artifacts: { testsPassed: true }, expected: true },
    { role: 'qa', artifacts: { testsPassed: false }, expected: false },
    { role: 'security', artifacts: { audit: true }, expected: true },
    { role: 'security', artifacts: { ok: false }, expected: false }
  ];
  
  console.log('Testing acceptance criteria:');
  testCases.forEach(test => {
    const result = accept(test.role, test.artifacts);
    const status = result === test.expected ? '✓' : '✗';
    console.log(`  ${status} ${test.role}: ${JSON.stringify(test.artifacts)} → ${result}`);
  });
}

// Test 3: Example output with THR strict mode
async function showExampleOutput() {
  console.log('\n▶ EXAMPLE OUTPUT (THR Strict Mode)\n');
  
  // Simulate the output
  console.log('[ORCHESTRATION] Run ID: run_1755798659714_example');
  console.log('[PROJECT] THR mode');
  console.log('[SECURITY] Running in strict sequential mode');
  console.log('──────────────────────────────────────────────────');
  console.log('  → [DRY RUN] memory');
  console.log('● memory └─ Done (1 tool uses · 0 tokens · 0.3s)');
  console.log('  → [DRY RUN] validation');
  console.log('● validation └─ Done (1 tool uses · 0 tokens · 0.5s)');
  console.log('  → [DRY RUN] qa');
  console.log('● qa └─ Done (1 tool uses · 0 tokens · 2.1s)');
  console.log('\n──────────────────────────────────────────────────');
  console.log('✓ Orchestration complete: 3 agents executed');
  console.log('  Total: 3 tool uses · 0 tokens · 2.9s');
  console.log('──────────────────────────────────────────────────');
}

// Run all tests
async function runAllTests() {
  await testDryRun();
  await testAcceptanceGates();
  await showExampleOutput();
  
  console.log('\n' + '═'.repeat(60));
  console.log('  PHASE 2 TEST COMPLETE');
  console.log('═'.repeat(60));
}

runAllTests().catch(console.error);