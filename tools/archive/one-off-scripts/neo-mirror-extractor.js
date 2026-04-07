#!/usr/bin/env node

/**
 * Neo Mirror Knowledge Extractor
 * Extracts facts, relationships, and personality traits from memories
 * Populates: neo_facts, neo_knowledge_graph, neo_personality
 *
 * Created: 2026-02-04
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =============================================================================
// EXTRACTION PATTERNS
// =============================================================================

const FACT_PATTERNS = {
  preference: [
    /(?:I |Neo |we )?prefer(?:s)?\s+(.+?)(?:\s+(?:over|instead|rather)|\.|$)/gi,
    /(?:I |Neo |we )?like(?:s)?\s+(?:to |using )?(.+?)(?:\.|$)/gi,
    /(?:I |Neo |we )?always use(?:s)?\s+(.+?)(?:\.|$)/gi,
    /favorite\s+(?:is\s+)?(.+?)(?:\.|$)/gi,
  ],
  skill: [
    /(?:I |Neo )?(?:know(?:s)?|understand(?:s)?|learned)\s+(?:how to\s+)?(.+?)(?:\.|$)/gi,
    /experience(?:d)?\s+(?:with|in)\s+(.+?)(?:\.|$)/gi,
    /proficient\s+(?:in|with)\s+(.+?)(?:\.|$)/gi,
  ],
  decision: [
    /(?:decided|chose|went with|picked|selected)\s+(.+?)(?:\s+(?:because|for|due)|\.|$)/gi,
    /(?:the )?(?:solution|approach|fix)\s+(?:was|is)\s+(.+?)(?:\.|$)/gi,
  ],
  pattern: [
    /(?:always|usually|typically|normally)\s+(.+?)(?:\.|$)/gi,
    /(?:my |Neo's )?(?:workflow|process|approach)\s+(?:is|involves)\s+(.+?)(?:\.|$)/gi,
  ],
  knowledge: [
    /(?:learned|discovered|found out)\s+(?:that\s+)?(.+?)(?:\.|$)/gi,
    /(?:it turns out|apparently)\s+(.+?)(?:\.|$)/gi,
  ],
  rule: [
    /(?:never|always|must|should)\s+(.+?)(?:\.|$)/gi,
    /(?:rule|principle|guideline):\s*(.+?)(?:\.|$)/gi,
  ]
};

const RELATIONSHIP_PATTERNS = [
  { pattern: /(\w+)\s+uses\s+(\w+)/gi, predicate: 'uses' },
  { pattern: /(\w+)\s+(?:built|created|developed)\s+(\w+)/gi, predicate: 'created' },
  { pattern: /(\w+)\s+(?:works with|integrates with)\s+(\w+)/gi, predicate: 'works_with' },
  { pattern: /(\w+)\s+(?:depends on|requires)\s+(\w+)/gi, predicate: 'depends_on' },
  { pattern: /(\w+)\s+(?:is part of|belongs to)\s+(\w+)/gi, predicate: 'part_of' },
];

const PERSONALITY_DIMENSIONS = {
  communication: {
    directness: ['direct', 'straightforward', 'blunt', 'concise'],
    technical_depth: ['detailed', 'technical', 'in-depth', 'thorough'],
    emoji_usage: ['emoji', '😊', '✅', '❌', '🔥'],
  },
  decision_making: {
    risk_tolerance: ['risky', 'safe', 'conservative', 'bold', 'cautious'],
    speed: ['quick', 'fast', 'slow', 'deliberate', 'careful'],
    data_driven: ['data', 'metrics', 'analytics', 'evidence', 'proof'],
  },
  work_style: {
    planning: ['plan', 'strategy', 'roadmap', 'prepare'],
    iteration: ['iterate', 'mvp', 'prototype', 'incremental'],
    documentation: ['document', 'readme', 'comments', 'notes'],
  },
  expertise: {
    react: ['react', 'jsx', 'hooks', 'component'],
    typescript: ['typescript', 'ts', 'type', 'interface'],
    supabase: ['supabase', 'postgres', 'rls', 'edge function'],
    ai: ['openai', 'claude', 'gpt', 'llm', 'embedding'],
    n8n: ['n8n', 'workflow', 'automation', 'webhook'],
  }
};

// Known entities for relationship extraction
const KNOWN_ENTITIES = {
  person: ['Neo', 'broneotodak'],
  project: ['THR', 'ATLAS', 'TODAK', 'FlowState', 'Firasah', 'Kenal', 'ClaudeN', 'ARS', 'CTK'],
  technology: ['React', 'TypeScript', 'Supabase', 'PostgreSQL', 'n8n', 'OpenAI', 'Claude', 'Tailwind', 'Vite', 'Node.js'],
  organization: ['Todak', 'Neotodak'],
};

// =============================================================================
// EXTRACTION FUNCTIONS
// =============================================================================

function extractFacts(content, memoryId) {
  const facts = [];

  for (const [factType, patterns] of Object.entries(FACT_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 10 && match[1].length < 200) {
          facts.push({
            fact: match[1].trim(),
            fact_type: factType,
            confidence: 0.7,
            source_memory_ids: [memoryId],
            domain: detectDomain(content),
          });
        }
      }
    }
  }

  return facts;
}

function extractRelationships(content, memoryId) {
  const relationships = [];

  // Extract from patterns
  for (const { pattern, predicate } of RELATIONSHIP_PATTERNS) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[2]) {
        relationships.push({
          subject: match[1].trim(),
          predicate: predicate,
          object: match[2].trim(),
          source_memory_ids: [memoryId],
          weight: 1.0,
        });
      }
    }
  }

  // Extract known entity relationships
  for (const [subjectType, subjects] of Object.entries(KNOWN_ENTITIES)) {
    for (const subject of subjects) {
      if (content.includes(subject)) {
        for (const [objectType, objects] of Object.entries(KNOWN_ENTITIES)) {
          for (const obj of objects) {
            if (subject !== obj && content.includes(obj)) {
              // Check if they appear near each other (within 100 chars)
              const subjectIndex = content.indexOf(subject);
              const objectIndex = content.indexOf(obj);
              if (Math.abs(subjectIndex - objectIndex) < 100) {
                relationships.push({
                  subject: subject,
                  subject_type: subjectType,
                  predicate: 'related_to',
                  object: obj,
                  object_type: objectType,
                  source_memory_ids: [memoryId],
                  weight: 0.5,
                });
              }
            }
          }
        }
      }
    }
  }

  return relationships;
}

function extractPersonalitySignals(content) {
  const signals = [];
  const contentLower = content.toLowerCase();

  for (const [dimension, traits] of Object.entries(PERSONALITY_DIMENSIONS)) {
    for (const [trait, keywords] of Object.entries(traits)) {
      let score = 0;
      let matches = 0;

      for (const keyword of keywords) {
        const regex = new RegExp(keyword, 'gi');
        const found = (content.match(regex) || []).length;
        if (found > 0) {
          matches += found;
          score += found * 0.1; // Each mention adds 0.1
        }
      }

      if (matches > 0) {
        signals.push({
          dimension,
          trait,
          value: Math.min(score, 1.0), // Cap at 1.0
          sample_count: matches,
        });
      }
    }
  }

  return signals;
}

function detectDomain(content) {
  const contentLower = content.toLowerCase();

  if (/code|function|bug|deploy|api|database/.test(contentLower)) return 'tech';
  if (/meeting|team|project|sprint|deadline/.test(contentLower)) return 'work';
  if (/learn|discover|research|study/.test(contentLower)) return 'learning';
  if (/personal|life|hobby/.test(contentLower)) return 'personal';

  return 'general';
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

async function saveFacts(facts) {
  if (facts.length === 0) return { inserted: 0, errors: 0 };

  let inserted = 0;
  let errors = 0;

  for (const fact of facts) {
    const { error } = await supabase.from('neo_facts').upsert({
      fact: fact.fact,
      fact_type: fact.fact_type,
      confidence: fact.confidence,
      source_memory_ids: fact.source_memory_ids,
      domain: fact.domain,
    }, {
      onConflict: 'fact',
      ignoreDuplicates: true,
    });

    if (error) {
      // Try insert if upsert fails
      const { error: insertError } = await supabase.from('neo_facts').insert(fact);
      if (insertError) errors++;
      else inserted++;
    } else {
      inserted++;
    }
  }

  return { inserted, errors };
}

async function saveRelationships(relationships) {
  if (relationships.length === 0) return { inserted: 0, errors: 0 };

  let inserted = 0;
  let errors = 0;

  for (const rel of relationships) {
    // Check if exists
    const { data: existing } = await supabase
      .from('neo_knowledge_graph')
      .select('id, evidence_count, source_memory_ids')
      .eq('subject', rel.subject)
      .eq('predicate', rel.predicate)
      .eq('object', rel.object)
      .single();

    if (existing) {
      // Update existing
      const newMemoryIds = [...new Set([...(existing.source_memory_ids || []), ...rel.source_memory_ids])];
      await supabase
        .from('neo_knowledge_graph')
        .update({
          evidence_count: existing.evidence_count + 1,
          source_memory_ids: newMemoryIds,
          last_observed: new Date().toISOString(),
          weight: Math.min((existing.evidence_count + 1) * 0.2, 1.0),
        })
        .eq('id', existing.id);
      inserted++;
    } else {
      // Insert new
      const { error } = await supabase.from('neo_knowledge_graph').insert(rel);
      if (error) errors++;
      else inserted++;
    }
  }

  return { inserted, errors };
}

async function updatePersonality(signals) {
  if (signals.length === 0) return { updated: 0 };

  let updated = 0;

  for (const signal of signals) {
    const { data: existing } = await supabase
      .from('neo_personality')
      .select('*')
      .eq('dimension', signal.dimension)
      .eq('trait', signal.trait)
      .single();

    if (existing) {
      // Update with weighted average
      const totalSamples = existing.sample_count + signal.sample_count;
      const newValue = (existing.value * existing.sample_count + signal.value * signal.sample_count) / totalSamples;

      await supabase
        .from('neo_personality')
        .update({
          value: newValue,
          sample_count: totalSamples,
          min_observed: Math.min(existing.min_observed || signal.value, signal.value),
          max_observed: Math.max(existing.max_observed || signal.value, signal.value),
          last_updated: new Date().toISOString(),
        })
        .eq('id', existing.id);
      updated++;
    } else {
      // Insert new
      await supabase.from('neo_personality').insert({
        trait: signal.trait,
        dimension: signal.dimension,
        value: signal.value,
        sample_count: signal.sample_count,
        min_observed: signal.value,
        max_observed: signal.value,
      });
      updated++;
    }
  }

  return { updated };
}

// =============================================================================
// MAIN EXTRACTION PIPELINE
// =============================================================================

async function processMemories(batchSize = 100, offset = 0) {
  console.log(`\n📊 Fetching memories (offset: ${offset}, batch: ${batchSize})...\n`);

  const { data: memories, error } = await supabase
    .from('claude_desktop_memory')
    .select('id, content, category, memory_type, metadata')
    .order('created_at', { ascending: false })
    .range(offset, offset + batchSize - 1);

  if (error) {
    console.error('Error fetching memories:', error);
    return null;
  }

  if (!memories || memories.length === 0) {
    console.log('No more memories to process.');
    return null;
  }

  const stats = {
    processed: 0,
    facts: { inserted: 0, errors: 0 },
    relationships: { inserted: 0, errors: 0 },
    personality: { updated: 0 },
  };

  for (const memory of memories) {
    if (!memory.content) continue;

    // Extract
    const facts = extractFacts(memory.content, memory.id);
    const relationships = extractRelationships(memory.content, memory.id);
    const personalitySignals = extractPersonalitySignals(memory.content);

    // Save
    const factResult = await saveFacts(facts);
    const relResult = await saveRelationships(relationships);
    const persResult = await updatePersonality(personalitySignals);

    stats.facts.inserted += factResult.inserted;
    stats.facts.errors += factResult.errors;
    stats.relationships.inserted += relResult.inserted;
    stats.relationships.errors += relResult.errors;
    stats.personality.updated += persResult.updated;
    stats.processed++;

    // Progress indicator
    if (stats.processed % 50 === 0) {
      process.stdout.write(`  Processed ${stats.processed}/${memories.length} memories...\r`);
    }
  }

  console.log(`\n✅ Batch complete: ${stats.processed} memories processed`);
  console.log(`   Facts: ${stats.facts.inserted} inserted, ${stats.facts.errors} errors`);
  console.log(`   Relationships: ${stats.relationships.inserted} inserted`);
  console.log(`   Personality signals: ${stats.personality.updated} updated`);

  return {
    processed: stats.processed,
    hasMore: memories.length === batchSize,
    stats,
  };
}

async function runFullExtraction() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('          NEO MIRROR - KNOWLEDGE EXTRACTION PIPELINE           ');
  console.log('═══════════════════════════════════════════════════════════════');

  // Get total count
  const { count } = await supabase
    .from('claude_desktop_memory')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📚 Total memories to process: ${count}`);

  const batchSize = 200;
  let offset = 0;
  let totalProcessed = 0;
  const totalStats = {
    facts: { inserted: 0, errors: 0 },
    relationships: { inserted: 0, errors: 0 },
    personality: { updated: 0 },
  };

  while (true) {
    const result = await processMemories(batchSize, offset);

    if (!result) break;

    totalProcessed += result.processed;
    totalStats.facts.inserted += result.stats.facts.inserted;
    totalStats.facts.errors += result.stats.facts.errors;
    totalStats.relationships.inserted += result.stats.relationships.inserted;
    totalStats.relationships.errors += result.stats.relationships.errors;
    totalStats.personality.updated += result.stats.personality.updated;

    if (!result.hasMore) break;

    offset += batchSize;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    EXTRACTION COMPLETE                         ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`\n📊 Final Statistics:`);
  console.log(`   Memories processed: ${totalProcessed}`);
  console.log(`   Facts extracted: ${totalStats.facts.inserted}`);
  console.log(`   Relationships mapped: ${totalStats.relationships.inserted}`);
  console.log(`   Personality traits updated: ${totalStats.personality.updated}`);

  // Show summary
  const { count: factCount } = await supabase.from('neo_facts').select('*', { count: 'exact', head: true });
  const { count: relCount } = await supabase.from('neo_knowledge_graph').select('*', { count: 'exact', head: true });
  const { count: persCount } = await supabase.from('neo_personality').select('*', { count: 'exact', head: true });

  console.log(`\n📦 Database State:`);
  console.log(`   neo_facts: ${factCount} records`);
  console.log(`   neo_knowledge_graph: ${relCount} records`);
  console.log(`   neo_personality: ${persCount} records`);

  return totalStats;
}

// Run if called directly
if (require.main === module) {
  runFullExtraction()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  extractFacts,
  extractRelationships,
  extractPersonalitySignals,
  processMemories,
  runFullExtraction,
};
