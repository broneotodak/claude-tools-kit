#!/usr/bin/env node

/**
 * Test Runner - executes all orchestration tests
 */

import thrSafetyTest from './smoke_thrsafety.mjs';
import stdoutRedactionTest from './stdout_redaction.mjs';

const runTests = async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  CTK ORCHESTRATION - RUNTIME TESTS');
  console.log('═'.repeat(60) + '\n');
  
  const tests = [
    { name: 'THR Safety', fn: thrSafetyTest },
    { name: 'Stdout Redaction', fn: stdoutRedactionTest }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`\n❌ Test "${test.name}" crashed:`, error.message);
      failed++;
    }
    console.log('');
  }
  
  console.log('═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
};

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});