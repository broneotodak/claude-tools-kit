#!/usr/bin/env node

/**
 * RAG (Retrieval Augmented Generation) System for Claude Code
 * Retrieves relevant context from memory based on semantic search.
 *
 * PORTED 2026-06-01: was text-searching (ilike) the FROZEN legacy
 * `claude_desktop_memory` table via process.env.SUPABASE_URL (silent stale data).
 * Now uses the @todak/memory SDK hybrid semantic+lexical search over the live
 * neo-brain `memories` table. Project/category/days are post-filters; --threshold
 * maps onto the SDK minSimilarity.
 */

require('dotenv').config();

// Parse command line arguments
const args = process.argv.slice(2);

// Help text (check raw args before mutating them)
if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Claude Code RAG Retrieval System

Usage: node rag-retrieve.js [options] <query>

Options:
  --limit, -l      Number of results to return (default: 5)
  --project, -p    Filter by project name
  --threshold, -t  Similarity threshold 0-1 (default: 0.3)
  --category, -c   Filter by category
  --days, -d       Limit to memories from last N days
  --format, -f     Output format: full|summary|context (default: context)

Examples:
  node rag-retrieve.js "how to fix null owner issue"
  node rag-retrieve.js -p "FlowState AI" -l 10 "real-time updates"
  node rag-retrieve.js --days 7 --category "Bug Fix" "webhook error"

How it works:
  Uses neo-brain hybrid semantic + lexical search (@todak/memory SDK) to find
  memories similar to your query, then augments Claude's responses.
`);
    process.exit(0);
}

// Parse options
function getOption(flags, defaultValue) {
    for (let i = 0; i < args.length; i++) {
        if (flags.includes(args[i]) && i + 1 < args.length) {
            const val = args[i + 1];
            // Remove this option and its value from the query
            args.splice(i, 2);
            return val;
        }
    }
    return defaultValue;
}

const limit = parseInt(getOption(['--limit', '-l'], '5'));
const project = getOption(['--project', '-p'], null);
const threshold = parseFloat(getOption(['--threshold', '-t'], '0.3'));
const category = getOption(['--category', '-c'], null);
const days = parseInt(getOption(['--days', '-d'], '0'));
const format = getOption(['--format', '-f'], 'context');

// Reconstruct query without options
const cleanQuery = args.join(' ');

async function retrieveContext() {
    console.log('🔍 RAG Context Retrieval\n');
    console.log(`Query: "${cleanQuery}"`);

    if (project) console.log(`Project filter: ${project}`);
    if (category) console.log(`Category filter: ${category}`);
    if (days > 0) console.log(`Time filter: Last ${days} days`);
    console.log(`Similarity threshold: ${threshold}`);
    console.log(`Results limit: ${limit}\n`);

    try {
        const { NeoBrain } = await import('../packages/memory/src/index.js');
        const brain = new NeoBrain({ agent: 'rag-retrieve' });

        // Over-fetch so post-filters (project/category/days) still leave enough rows.
        const k = Math.max(limit * 4, limit);
        let memories = await brain.search(cleanQuery, { k, minSimilarity: threshold });

        // Apply post-filters the hybrid RPC doesn't take directly.
        if (category) {
            memories = memories.filter((m) => m.category === category);
        }
        if (project) {
            const p = project.toLowerCase();
            memories = memories.filter((m) => {
                const mp = (m.metadata?.project || m.category || '').toLowerCase();
                return mp === p || mp.includes(p);
            });
        }
        if (days > 0) {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);
            memories = memories.filter((m) => new Date(m.created_at) >= dateLimit);
        }

        memories = memories.slice(0, limit);

        if (!memories || memories.length === 0) {
            console.log('❌ No relevant memories found.');
            console.log('\n💡 Try:');
            console.log('  - Using different keywords');
            console.log('  - Removing filters');
            console.log('  - Lowering --threshold');
            console.log('  - Checking recent memories with: node check-latest-activities.js');
            return;
        }

        // Format output based on requested format
        console.log(`✅ Found ${memories.length} relevant memories:\n`);

        if (format === 'full') {
            memories.forEach((memory, index) => {
                console.log(`${index + 1}. [${memory.category}] ${memory.memory_type || 'unknown'}`);
                console.log(`   ID: ${memory.id}`);
                console.log(`   Date: ${new Date(memory.created_at).toLocaleDateString()}`);
                console.log(`   Importance: ${memory.importance}/10`);
                console.log(`   Project: ${memory.metadata?.project || memory.category || 'Unknown'}`);
                console.log(`   Content: ${memory.content}`);
                if (memory.metadata) console.log(`   Metadata: ${JSON.stringify(memory.metadata, null, 2)}`);
                console.log('   ---\n');
            });
        } else if (format === 'summary') {
            memories.forEach((memory, index) => {
                const date = new Date(memory.created_at).toLocaleDateString();
                const proj = memory.metadata?.project || memory.category || 'Unknown';
                console.log(`${index + 1}. [${date}] ${proj}: ${memory.content.substring(0, 100)}...`);
            });
        } else {
            // Context format - optimized for injection
            console.log('=== Retrieved Context for Claude ===\n');
            memories.forEach((memory, index) => {
                const date = new Date(memory.created_at).toLocaleDateString();
                const proj = memory.metadata?.project || memory.category || 'General';
                console.log(`## Context ${index + 1}: ${proj} (${date})`);
                console.log(memory.content);
                if (memory.metadata?.solution) {
                    console.log(`Solution: ${memory.metadata.solution}`);
                }
                console.log('');
            });
            console.log('=== End Retrieved Context ===');
        }

        console.log('\n💡 Tips:');
        console.log('  - Use -f full for detailed view');
        console.log('  - Use -f summary for quick overview');
        console.log('  - Use -f context to copy/paste into Claude');
        console.log('  - Add filters to narrow results');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    }
}

// Run retrieval
retrieveContext();
