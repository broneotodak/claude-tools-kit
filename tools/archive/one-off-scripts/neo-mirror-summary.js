#!/usr/bin/env node

/**
 * Neo Mirror Summary - Shows your Digital Twin profile
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function showSummary() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              NEO MIRROR - YOUR DIGITAL TWIN                   ');
  console.log('═══════════════════════════════════════════════════════════════');

  // Get counts
  const { count: factCount } = await supabase.from('neo_facts').select('*', { count: 'exact', head: true });
  const { count: relCount } = await supabase.from('neo_knowledge_graph').select('*', { count: 'exact', head: true });
  const { count: persCount } = await supabase.from('neo_personality').select('*', { count: 'exact', head: true });
  const { count: memCount } = await supabase.from('claude_desktop_memory').select('*', { count: 'exact', head: true });

  console.log('\n📊 DATABASE STATE:');
  console.log('   Source memories:', memCount);
  console.log('   Facts extracted:', factCount);
  console.log('   Relationships:', relCount);
  console.log('   Personality traits:', persCount);

  // Top relationships by evidence
  console.log('\n🔗 TOP KNOWLEDGE GRAPH EDGES (by evidence):');
  const { data: topRels } = await supabase.from('neo_knowledge_graph')
    .select('subject, predicate, object, evidence_count, weight')
    .order('evidence_count', { ascending: false })
    .limit(10);

  topRels?.forEach((r, i) => {
    console.log(`   ${i+1}. ${r.subject} --[${r.predicate}]--> ${r.object} (evidence: ${r.evidence_count})`);
  });

  // Personality profile
  console.log('\n🧠 YOUR PERSONALITY PROFILE:');
  const { data: profile } = await supabase.from('neo_personality')
    .select('dimension, trait, value, sample_count')
    .order('sample_count', { ascending: false });

  const byDimension = {};
  profile?.forEach(p => {
    if (!byDimension[p.dimension]) byDimension[p.dimension] = [];
    byDimension[p.dimension].push(p);
  });

  for (const [dim, traits] of Object.entries(byDimension)) {
    console.log(`\n   ${dim.toUpperCase()}:`);
    traits.slice(0, 5).forEach(t => {
      const filled = Math.round(t.value * 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      console.log(`     ${t.trait}: [${bar}] ${(t.value * 100).toFixed(0)}%`);
    });
  }

  // Fact types distribution
  console.log('\n📝 FACTS BY TYPE:');
  const { data: factTypes } = await supabase.from('neo_facts').select('fact_type');
  const typeCount = {};
  factTypes?.forEach(f => typeCount[f.fact_type] = (typeCount[f.fact_type] || 0) + 1);
  Object.entries(typeCount).sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  // Sample facts
  console.log('\n💡 SAMPLE EXTRACTED FACTS:');
  const { data: sampleFacts } = await supabase.from('neo_facts')
    .select('fact, fact_type')
    .limit(5);
  sampleFacts?.forEach((f, i) => {
    console.log(`   ${i+1}. [${f.fact_type}] ${f.fact.slice(0, 70)}...`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
}

showSummary().catch(console.error);
