#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixConstraint() {
  console.log('🔧 Fixing CTK Memory Constraint...\n');
  
  try {
    // Step 1: Drop existing constraint
    console.log('1️⃣ Dropping existing constraint...');
    const { error: dropError } = await supabase.rpc('execute_sql', {
      sql: `ALTER TABLE claude_desktop_memory DROP CONSTRAINT IF EXISTS claude_desktop_memory_source_check;`
    });
    
    if (dropError) {
      console.error('❌ Error dropping constraint:', dropError);
      return;
    }
    console.log('✅ Constraint dropped successfully\n');
    
    // Step 2: Add new constraint with claude_code
    console.log('2️⃣ Adding updated constraint with claude_code...');
    const { error: addError } = await supabase.rpc('execute_sql', {
      sql: `ALTER TABLE claude_desktop_memory 
            ADD CONSTRAINT claude_desktop_memory_source_check 
            CHECK (source::text = ANY (ARRAY['claude_desktop', 'cursor', 'manual', 'other', 'claude_code']::text[]));`
    });
    
    if (addError) {
      console.error('❌ Error adding constraint:', addError);
      return;
    }
    console.log('✅ New constraint added successfully\n');
    
    // Step 3: Test by saving a memory with claude_code source
    console.log('3️⃣ Testing claude_code source...');
    const testMemory = {
      owner: 'neo_todak',
      context: 'general',
      category: 'CTK Test',
      content: 'CTK constraint fix verified - claude_code source now working!',
      metadata: {
        date: new Date().toISOString().split('T')[0],
        feature: 'constraint_fix',
        tool: 'claude_code'
      },
      importance: 5,
      source: 'claude_code',
      author: 'neo_todak'
    };
    
    const { data, error: testError } = await supabase
      .from('claude_desktop_memory')
      .insert([testMemory])
      .select();
    
    if (testError) {
      console.error('❌ Test failed:', testError);
      return;
    }
    
    console.log('✅ Test successful! Memory saved with source=claude_code');
    console.log(`   ID: ${data[0].id}`);
    console.log(`   Content: ${data[0].content}\n`);
    
    // Step 4: Show count of claude_code entries
    const { data: countData } = await supabase
      .from('claude_desktop_memory')
      .select('id', { count: 'exact' })
      .eq('source', 'claude_code');
    
    console.log('📊 Summary:');
    console.log(`   - Constraint updated successfully`);
    console.log(`   - claude_code is now a valid source`);
    console.log(`   - Total claude_code entries: ${countData?.length || 0}`);
    console.log('\n🎉 CTK Memory constraint fixed successfully!');
    console.log('   FlowState dashboard should now display CTK activities.');
    
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
}

// Run the fix
fixConstraint();