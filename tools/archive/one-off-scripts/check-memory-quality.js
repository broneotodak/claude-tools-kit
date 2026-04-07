#!/usr/bin/env node

/**
 * Check memory quality for proper FlowState display
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMemoryQuality(category = null, hours = 1) {
  try {
    console.log(`🔍 Checking memory quality from last ${hours} hour(s)...\n`);
    
    // Build query
    let query = supabase
      .from('claude_desktop_memory')
      .select('*')
      .gte('created_at', new Date(Date.now() - hours * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (category) {
      query = query.eq('category', category);
    }
    
    const { data: memories, error } = await query;
    
    if (error) throw error;
    
    if (!memories || memories.length === 0) {
      console.log('No memories found in the specified time range');
      return;
    }
    
    console.log(`Found ${memories.length} memories\n`);
    
    let issueCount = 0;
    
    memories.forEach((memory, index) => {
      console.log(`Memory ${index + 1}:`);
      console.log(`  ID: ${memory.id}`);
      console.log(`  Category: ${memory.category}`);
      console.log(`  Title: ${memory.title || '❌ MISSING TITLE'}`);
      console.log(`  Created: ${new Date(memory.created_at).toLocaleString()}`);
      
      // Check metadata quality
      const issues = [];
      
      if (!memory.metadata) {
        issues.push('❌ No metadata object');
      } else {
        if (!memory.metadata.machine) issues.push('❌ Missing metadata.machine');
        if (!memory.metadata.tool) issues.push('❌ Missing metadata.tool');
        if (!memory.metadata.project) issues.push('❌ Missing metadata.project');
      }
      
      // Check if it's been processed
      const processed = memory.metadata?.flowstate_processed;
      console.log(`  FlowState Processed: ${processed ? '✅' : '❌ Not yet'}`);
      
      if (issues.length > 0) {
        issueCount++;
        console.log('  Issues:');
        issues.forEach(issue => console.log(`    ${issue}`));
      } else {
        console.log('  ✅ All required fields present');
      }
      
      // Show current metadata
      if (memory.metadata) {
        console.log('  Current metadata:');
        console.log(`    machine: ${memory.metadata.machine || 'undefined'}`);
        console.log(`    tool: ${memory.metadata.tool || 'undefined'}`);
        console.log(`    project: ${memory.metadata.project || 'undefined'}`);
      }
      
      console.log('');
    });
    
    if (issueCount > 0) {
      console.log(`\n⚠️  ${issueCount} memories have quality issues`);
      console.log('These will show as "Unknown Machine" or "Unknown Tool" in FlowState');
      console.log('\nTo fix: Run memory enrichment with:');
      console.log('  ctk enrich');
    } else {
      console.log('\n✅ All memories have proper metadata!');
    }
    
  } catch (error) {
    console.error('❌ Error checking memory quality:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  const category = process.argv[2];
  const hours = parseInt(process.argv[3]) || 1;
  checkMemoryQuality(category, hours);
}

module.exports = { checkMemoryQuality };