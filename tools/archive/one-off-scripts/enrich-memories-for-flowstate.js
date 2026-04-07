#!/usr/bin/env node

/**
 * Memory Enrichment for FlowState
 * Processes claude_desktop_memory entries to add metadata for better FlowState visualization
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { applyEnrichmentRules } = require('./memory-enrichment-rules');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function enrichMemoriesForFlowState() {
  try {
    console.log('🔄 Enriching memories for FlowState visualization...\n');
    
    // Get unprocessed memories from last 7 days
    const { data: memories, error } = await supabase
      .from('claude_desktop_memory')
      .select('*')
      .is('metadata->>flowstate_processed', null)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    console.log(`Found ${memories.length} unprocessed memories to enrich\n`);
    
    let enriched = 0;
    const activityTypes = {};
    
    for (const memory of memories) {
      // Use centralized enrichment rules
      const enrichedMetadata = applyEnrichmentRules(memory);
      
      // Add FlowState-specific flags
      enrichedMetadata.flowstate_processed = true;
      enrichedMetadata.processed_at = new Date().toISOString();
      
      // Update the memory
      const { error: updateError } = await supabase
        .from('claude_desktop_memory')
        .update({ metadata: enrichedMetadata })
        .eq('id', memory.id);
      
      if (updateError) {
        console.error(`❌ Failed to update memory ${memory.id}:`, updateError.message);
      } else {
        enriched++;
        activityTypes[enrichedMetadata.activity_type] = (activityTypes[enrichedMetadata.activity_type] || 0) + 1;
      }
    }
    
    console.log(`\n✅ Enriched ${enriched} memories`);
    console.log('\n📊 Activity type distribution:');
    Object.entries(activityTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    
    console.log('\n🎯 FlowState should now display these memories with proper categorization');
    
  } catch (error) {
    console.error('❌ Error enriching memories:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  enrichMemoriesForFlowState();
}

module.exports = { enrichMemoriesForFlowState };