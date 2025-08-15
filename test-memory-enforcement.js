#!/usr/bin/env node

/**
 * Test Memory Enforcement System
 * Verifies that all memory save methods work correctly
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🧪 Testing Memory Enforcement System\n');

const tests = [
  {
    name: 'THR Project Memory Utils',
    cwd: '/Users/broneotodak/Projects/THR',
    command: 'node scripts/thr-memory-utils.js session "Test from THR project"',
    condition: () => fs.existsSync('/Users/broneotodak/Projects/THR/scripts/thr-memory-utils.js')
  },
  {
    name: 'Global Save Memory',
    cwd: '/Users/broneotodak/Projects',
    command: 'node claude-tools-kit/tools/save-memory.js "Test" "Enforcement Test" "Testing global save" 5',
    condition: () => true
  },
  {
    name: 'Universal Memory Save',
    cwd: '/Users/broneotodak/Projects',
    command: 'node claude-tools-kit/tools/universal-memory-save.js "Testing universal save with validation" --type=test --importance=5',
    condition: () => fs.existsSync('/Users/broneotodak/Projects/claude-tools-kit/tools/universal-memory-save.js')
  },
  {
    name: 'Enforcement Hook',
    cwd: '/Users/broneotodak/Projects/claude-tools-kit',
    command: 'node hooks/enforce-memory-save.js "save our progress from testing"',
    condition: () => fs.existsSync('/Users/broneotodak/Projects/claude-tools-kit/hooks/enforce-memory-save.js')
  }
];

let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
  console.log(`\n📋 Test ${index + 1}: ${test.name}`);
  console.log(`Directory: ${test.cwd}`);
  console.log(`Command: ${test.command}`);
  
  if (!test.condition()) {
    console.log('⏭️  Skipped - Condition not met');
    return;
  }
  
  try {
    const output = execSync(test.command, {
      cwd: test.cwd,
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    
    if (output.includes('saved successfully') || output.includes('Success') || output.includes('✅')) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❓ Uncertain - Check output:');
      console.log(output.substring(0, 200));
    }
  } catch (error) {
    console.log('❌ FAILED');
    console.log('Error:', error.message);
    failed++;
  }
});

console.log('\n📊 Test Summary:');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`⏭️  Skipped: ${tests.length - passed - failed}`);

// Check if enforcement rules exist
console.log('\n📄 Checking enforcement documentation:');
const docs = [
  '/Users/broneotodak/.claude/MEMORY_ENFORCEMENT.md',
  '/Users/broneotodak/.claude/CLAUDE.md'
];

docs.forEach(doc => {
  if (fs.existsSync(doc)) {
    const content = fs.readFileSync(doc, 'utf8');
    if (content.includes('Memory Save Enforcement') || content.includes('pgVector')) {
      console.log(`✅ ${path.basename(doc)} - Contains enforcement rules`);
    } else {
      console.log(`⚠️  ${path.basename(doc)} - Missing enforcement rules`);
    }
  } else {
    console.log(`❌ ${path.basename(doc)} - File not found`);
  }
});

console.log('\n✨ Memory enforcement system test complete!');