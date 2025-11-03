#!/usr/bin/env node

/**
 * Simple Memory Save (no embedding required)
 */

require('dotenv').config({ path: '/Users/broneotodak/Projects/claude-tools-kit/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function saveMemory(category, content, importance = 5) {
  console.log('💾 Saving memory to pgVector...\n');

  try {
    const { data, error } = await supabase
      .from('claude_desktop_memory')
      .insert({
        user_id: 'neo_todak',
        memory_type: 'context',
        category,
        content,
        importance,
        source: 'claude_code',  // ✅ FIXED: Accurate source (underscore, not hyphen)
        metadata: {
          machine_name: process.env.MACHINE_NAME || 'MacBook Air',
          saved_by: 'claude_code',
          timestamp: new Date().toISOString()
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // New columns (with defaults)
        priority_score: 1.0,
        decay_factor: 1.0,
        entity_count: 0
      })
      .select();

    if (error) throw error;

    console.log('✅ Memory saved successfully!');
    console.log(`   ID: ${data[0].id}`);
    console.log(`   Category: ${category}`);
    console.log(`   Importance: ${importance}\n`);

    return { success: true, id: data[0].id };
  } catch (error) {
    console.error('❌ Failed to save memory:', error.message);
    return { success: false, error: error.message };
  }
}

const category = process.argv[2];
const content = process.argv[3];
const importance = parseInt(process.argv[4]) || 5;

if (!category || !content) {
  console.error('Usage: node save-memory-simple.js <category> <content> [importance]');
  console.error('Valid categories: Session, Progress, Learning, Decision, Project, Config');
  process.exit(1);
}

saveMemory(category, content, importance)
  .then(result => process.exit(result.success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
