#!/usr/bin/env node

/**
 * Claude Code Memory Enrichment Service
 * Runs periodically to enrich and standardize memory entries
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { MEMORY_TYPES, MEMORY_CATEGORIES } = require('../config/memory-constants');

// DEPRECATED 2026-06-01: enriched the FROZEN legacy `claude_desktop_memory` archive
// via process.env.SUPABASE_URL (the live cron runs the archived
// enrich-memories-for-flowstate.js, not this). Superseded by the @todak/memory SDK.
// Client built lazily so the legacy URL is only touched behind --force-legacy.
let _supabase = null;
function supabase() {
    if (!_supabase) {
        _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    }
    return _supabase;
}

async function enrichMemory(memory) {
    const updates = {
        metadata: { ...memory.metadata }
    };

    // Standardize memory type
    if (memory.memory_type) {
        const standardType = Object.values(MEMORY_TYPES).find(type => 
            memory.memory_type.toLowerCase().includes(type.toLowerCase())
        );
        if (standardType && standardType !== memory.memory_type) {
            updates.memory_type = standardType;
        }
    }

    // Standardize category
    if (memory.category) {
        const standardCategory = Object.values(MEMORY_CATEGORIES).find(cat => 
            memory.category.toLowerCase().includes(cat.toLowerCase())
        );
        if (standardCategory && standardCategory !== memory.category) {
            updates.category = standardCategory;
        }
    }

    // Enrich metadata
    if (!memory.metadata.last_enriched) {
        updates.metadata.last_enriched = new Date().toISOString();
    }

    // Update only if there are changes
    if (Object.keys(updates).length > 1 || Object.keys(updates.metadata).length > 1) {
        const { error } = await supabase()
            .from('claude_desktop_memory')
            .update(updates)
            .eq('id', memory.id);

        if (error) {
            console.error(`Failed to enrich memory ${memory.id}:`, error);
            return false;
        }
        return true;
    }
    return false;
}

async function runEnrichment() {
    console.log('🔄 Starting memory enrichment cycle...\n');

    try {
        // Get memories that haven't been enriched recently
        const { data: memories, error } = await supabase()
            .from('claude_desktop_memory')
            .select('*')
            .or('metadata->last_enriched.is.null')
            .limit(100);

        if (error) {
            console.error('Failed to fetch memories:', error);
            return;
        }

        console.log(`Found ${memories.length} memories to enrich`);

        let enriched = 0;
        for (const memory of memories) {
            if (await enrichMemory(memory)) {
                enriched++;
            }
        }

        console.log(`\n✅ Enriched ${enriched} memories`);

    } catch (err) {
        console.error('❌ Enrichment error:', err);
    }
}

// Run enrichment every 5 minutes
if (require.main === module) {
    if (!process.argv.includes('--force-legacy')) {
        console.error('DEPRECATED: memory-enrichment.js targeted the frozen legacy memory archive (claude_desktop_memory); use the @todak/memory SDK (packages/memory). Re-run with --force-legacy to override.');
        process.exit(1);
    }

    console.log('🔄 Memory Enrichment Service\n');
    console.log('Enriching memories every 5 minutes...\n');

    // Initial run
    runEnrichment();

    // Schedule subsequent runs
    setInterval(runEnrichment, 5 * 60 * 1000);
}

module.exports = { enrichMemory, runEnrichment };