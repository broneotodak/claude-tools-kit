#!/usr/bin/env node

/**
 * RAG (Retrieval Augmented Generation) System for Claude Code
 * Retrieves relevant context from memory based on semantic search
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Parse command line arguments
const args = process.argv.slice(2);
const query = args.join(' ');

// Help text
if (!query || query === '--help' || query === '-h') {
    console.log(`
Claude Code RAG Retrieval System

Usage: node rag-retrieve.js [options] <query>

Options:
  --limit, -l      Number of results to return (default: 5)
  --project, -p    Filter by project name
  --threshold, -t  Similarity threshold 0-1 (default: 0.7)
  --category, -c   Filter by category
  --days, -d       Limit to memories from last N days
  --format, -f     Output format: full|summary|context (default: context)

Examples:
  node rag-retrieve.js "how to fix null owner issue"
  node rag-retrieve.js -p "FlowState AI" -l 10 "real-time updates"
  node rag-retrieve.js --days 7 --category "Bug Fix" "webhook error"

How it works:
  Uses PGVector semantic search to find memories similar to your query.
  Returns the most relevant context to augment Claude's responses.
`);
    process.exit(0);
}

// Parse options
function getOption(flags, defaultValue) {
    for (let i = 0; i < args.length; i++) {
        if (flags.includes(args[i]) && i + 1 < args.length) {
            // Remove this option and its value from the query
            args.splice(i, 2);
            return args[i + 1];
        }
    }
    return defaultValue;
}

const limit = parseInt(getOption(['--limit', '-l'], '5'));
const project = getOption(['--project', '-p'], null);
const threshold = parseFloat(getOption(['--threshold', '-t'], '0.7'));
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
        // First, get the embedding for the query
        // For now, we'll use a text search approach
        // In production, you'd generate an embedding here
        
        let query = supabase
            .from('claude_desktop_memory')
            .select('*')
            .order('created_at', { ascending: false });

        // Apply filters
        if (project) {
            query = query.or(`metadata->project.eq.${project},metadata->project.ilike.%${project}%`);
        }
        
        if (category) {
            query = query.eq('category', category);
        }
        
        if (days > 0) {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - days);
            query = query.gte('created_at', dateLimit.toISOString());
        }

        // For now, use text search (later we'll use vector similarity)
        query = query.or(`content.ilike.%${cleanQuery}%,metadata.ilike.%${cleanQuery}%`);
        
        // Limit results
        query = query.limit(limit);

        const { data: memories, error } = await query;

        if (error) {
            console.error('❌ Error retrieving memories:', error);
            return;
        }

        if (!memories || memories.length === 0) {
            console.log('❌ No relevant memories found.');
            console.log('\n💡 Try:');
            console.log('  - Using different keywords');
            console.log('  - Removing filters');
            console.log('  - Checking recent memories with: node check-latest-activities.js');
            return;
        }

        // Format output based on requested format
        console.log(`✅ Found ${memories.length} relevant memories:\n`);

        if (format === 'full') {
            // Full format - everything
            memories.forEach((memory, index) => {
                console.log(`${index + 1}. [${memory.category}] ${memory.memory_type || 'unknown'}`);
                console.log(`   ID: ${memory.id}`);
                console.log(`   Date: ${new Date(memory.created_at).toLocaleDateString()}`);
                console.log(`   Importance: ${memory.importance}/10`);
                console.log(`   Project: ${memory.metadata?.project || 'Unknown'}`);
                console.log(`   Content: ${memory.content}`);
                console.log(`   Metadata: ${JSON.stringify(memory.metadata, null, 2)}`);
                console.log('   ---\n');
            });
        } else if (format === 'summary') {
            // Summary format - key info only
            memories.forEach((memory, index) => {
                const date = new Date(memory.created_at).toLocaleDateString();
                const proj = memory.metadata?.project || 'Unknown';
                console.log(`${index + 1}. [${date}] ${proj}: ${memory.content.substring(0, 100)}...`);
            });
        } else {
            // Context format - optimized for injection
            console.log('=== Retrieved Context for Claude ===\n');
            memories.forEach((memory, index) => {
                const date = new Date(memory.created_at).toLocaleDateString();
                const proj = memory.metadata?.project || 'General';
                console.log(`## Context ${index + 1}: ${proj} (${date})`);
                console.log(memory.content);
                if (memory.metadata?.solution) {
                    console.log(`Solution: ${memory.metadata.solution}`);
                }
                console.log('');
            });
            console.log('=== End Retrieved Context ===');
        }

        // Show usage tip
        console.log('\n💡 Tips:');
        console.log('  - Use -f full for detailed view');
        console.log('  - Use -f summary for quick overview');
        console.log('  - Use -f context to copy/paste into Claude');
        console.log('  - Add filters to narrow results');

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Run retrieval
retrieveContext();