#!/usr/bin/env node

/**
 * Investigate Schema Accuracy Issues
 * CTK Strict Mode: Verify actual vs expected data
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigateSchema() {
  console.log('🔍 SCHEMA ACCURACY INVESTIGATION');
  console.log('=' .repeat(80) + '\n');

  try {
    // 1. Get the most recent memory (the one we just saved)
    const { data: recentMemory, error: memError } = await supabase
      .from('claude_desktop_memory')
      .select('*')
      .eq('id', 3207)
      .single();

    if (memError) throw memError;

    console.log('📊 MOST RECENT MEMORY (ID: 3207)\n');
    console.log('Checking data accuracy...\n');

    // Check source field
    console.log('❌ ISSUE #1: Source Field Inaccuracy');
    console.log(`   Actual: "${recentMemory.source}"`);
    console.log(`   Expected: "claude_code" or "claude-code"`);
    console.log(`   Problem: Using wrong source identifier\n`);

    // 2. Get ALL columns in the table
    console.log('📋 COMPLETE SCHEMA (All 25 Columns):\n');

    const allColumns = Object.keys(recentMemory).sort();

    allColumns.forEach((col, idx) => {
      const value = recentMemory[col];
      const type = value === null ? 'null' : typeof value;
      const isNew = ['entities', 'relationships', 'entity_count', 'consolidated_from',
                     'consolidation_date', 'consolidation_reason', 'priority_score',
                     'last_consolidation', 'decay_factor'].includes(col);

      const marker = isNew ? '🆕' : '  ';
      console.log(`${marker} ${(idx + 1).toString().padStart(2)}. ${col.padEnd(25)} : ${type}`);
    });

    console.log('\n' + '=' .repeat(80));
    console.log('\n📊 COLUMN ANALYSIS\n');

    // Original 16 columns
    const originalColumns = [
      'id', 'user_id', 'memory_type', 'category', 'content',
      'metadata', 'importance', 'last_accessed', 'created_at',
      'updated_at', 'embedding', 'owner', 'archived',
      'heat_score', 'access_count', 'source'
    ];

    // New 9 columns we just added
    const newColumns = [
      'entities', 'relationships', 'entity_count',
      'consolidated_from', 'consolidation_date', 'consolidation_reason',
      'priority_score', 'last_consolidation', 'decay_factor'
    ];

    console.log(`Original Columns: ${originalColumns.length}`);
    console.log(`New Columns: ${newColumns.length}`);
    console.log(`Total: ${originalColumns.length + newColumns.length}\n`);

    // 3. Check which new columns are populated
    console.log('🆕 NEW COLUMNS STATUS:\n');

    newColumns.forEach(col => {
      const value = recentMemory[col];
      const status = value === null ? '❌ NULL (not yet used)' : `✅ ${JSON.stringify(value)}`;
      console.log(`   ${col.padEnd(25)} : ${status}`);
    });

    console.log('\n' + '=' .repeat(80));
    console.log('\n⚠️  ACCURACY ISSUES FOUND:\n');

    const issues = [];

    // Issue 1: Source field
    if (recentMemory.source !== 'claude-code' && recentMemory.source !== 'claude_code') {
      issues.push({
        issue: 'Incorrect source field',
        current: recentMemory.source,
        expected: 'claude-code or claude_code',
        severity: 'MEDIUM',
        fix: 'Update save-memory-simple.js to use correct source'
      });
    }

    // Issue 2: Metadata accuracy
    if (recentMemory.metadata && recentMemory.metadata.saved_by) {
      if (recentMemory.metadata.saved_by !== 'claude-code') {
        issues.push({
          issue: 'Incorrect metadata.saved_by',
          current: recentMemory.metadata.saved_by,
          expected: 'claude-code',
          severity: 'LOW',
          fix: 'Update metadata in save script'
        });
      }
    }

    // Issue 3: New columns not being used
    const unusedNewColumns = newColumns.filter(col => recentMemory[col] === null);
    if (unusedNewColumns.length > 0) {
      issues.push({
        issue: 'New columns not utilized',
        current: `${unusedNewColumns.length} columns unused`,
        expected: 'Should populate new fields when saving',
        severity: 'INFO',
        fix: 'This is expected - features not yet implemented'
      });
    }

    issues.forEach((issue, idx) => {
      console.log(`${idx + 1}. [${issue.severity}] ${issue.issue}`);
      console.log(`   Current: ${issue.current}`);
      console.log(`   Expected: ${issue.expected}`);
      console.log(`   Fix: ${issue.fix}\n`);
    });

    console.log('=' .repeat(80));

    return {
      success: true,
      issues,
      recentMemory,
      columnCount: allColumns.length
    };

  } catch (error) {
    console.error('❌ Investigation failed:', error.message);
    return { success: false, error: error.message };
  }
}

if (require.main === module) {
  investigateSchema()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Investigation complete');
        console.log(`   Issues found: ${result.issues.length}`);
        console.log(`   Total columns: ${result.columnCount}\n`);
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { investigateSchema };
