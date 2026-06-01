#!/usr/bin/env node

/**
 * RAG Memory Embedder for Claude Code
 * Creates embeddings for memories to enable semantic search
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
require('dotenv').config();

// DEPRECATED 2026-06-01: embedded the FROZEN legacy `claude_desktop_memory` archive
// (via process.env.SUPABASE_URL) using OpenAI ada-002. Superseded by
// tools/backfill-missing-embeddings.js (live neo-brain, Gemini embeddings).
// Client built lazily so the legacy URL is only touched behind --force-legacy.
const openaiKey = process.env.OPENAI_API_KEY;

let _supabase = null;
function supabase() {
    if (!_supabase) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
            console.error('❌ Missing Supabase credentials');
            process.exit(1);
        }
        if (!openaiKey) {
            console.error('❌ Missing OpenAI API key for embeddings');
            console.error('   Add OPENAI_API_KEY to your .env file');
            process.exit(1);
        }
        _supabase = createClient(supabaseUrl, supabaseKey);
    }
    return _supabase;
}

// Create embedding using OpenAI
async function createEmbedding(text) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            input: text,
            model: "text-embedding-ada-002"
        });

        const options = {
            hostname: 'api.openai.com',
            port: 443,
            path: '/v1/embeddings',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Length': data.length
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    if (parsed.data && parsed.data[0] && parsed.data[0].embedding) {
                        resolve(parsed.data[0].embedding);
                    } else {
                        reject(new Error('Invalid embedding response'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function embedMemories() {
    console.log('🧠 RAG Memory Embedder\n');
    console.log('This tool creates embeddings for memories without them.\n');

    try {
        // Check for memories without embeddings
        const { data: unembedded, error: checkError, count } = await supabase()
            .from('claude_desktop_memory')
            .select('id, content, metadata', { count: 'exact' })
            .is('embedding', null)
            .limit(100);

        if (checkError) {
            console.error('❌ Error checking memories:', checkError);
            return;
        }

        if (!unembedded || unembedded.length === 0) {
            console.log('✅ All memories already have embeddings!');
            return;
        }

        console.log(`📊 Found ${count} memories without embeddings`);
        console.log(`📝 Processing ${unembedded.length} memories in this batch...\n`);

        let processed = 0;
        let failed = 0;

        for (const memory of unembedded) {
            try {
                // Create text for embedding (combine content with metadata)
                const embeddingText = `${memory.content} ${JSON.stringify(memory.metadata || {})}`;
                
                // Generate embedding
                process.stdout.write(`\rProcessing memory ${memory.id}...`);
                const embedding = await createEmbedding(embeddingText);

                // Update memory with embedding
                const { error: updateError } = await supabase()
                    .from('claude_desktop_memory')
                    .update({ embedding: embedding })
                    .eq('id', memory.id);

                if (updateError) {
                    console.error(`\n❌ Failed to update memory ${memory.id}:`, updateError);
                    failed++;
                } else {
                    processed++;
                    if (processed % 10 === 0) {
                        console.log(`\n✅ Processed ${processed} memories...`);
                    }
                }

                // Rate limiting - OpenAI has limits
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                console.error(`\n❌ Error processing memory ${memory.id}:`, error.message);
                failed++;
            }
        }

        console.log('\n\n📊 Embedding Summary:');
        console.log(`   ✅ Successfully embedded: ${processed} memories`);
        if (failed > 0) {
            console.log(`   ❌ Failed: ${failed} memories`);
        }
        if (count > unembedded.length) {
            console.log(`   ⏳ Remaining: ${count - unembedded.length} memories`);
            console.log('\n💡 Run this tool again to process more memories');
        }

    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

// Add help command
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
RAG Memory Embedder

This tool creates vector embeddings for memories to enable semantic search.

Usage: node rag-embed-memories.js

Requirements:
  - OPENAI_API_KEY in your .env file
  - Supabase credentials configured

How it works:
  1. Finds memories without embeddings
  2. Creates embeddings using OpenAI's text-embedding-ada-002
  3. Stores embeddings in the database
  4. Enables semantic similarity search

Note: Processes 100 memories at a time to avoid rate limits.
`);
    process.exit(0);
}

if (!process.argv.includes('--force-legacy')) {
    console.error('DEPRECATED: rag-embed-memories.js targeted the frozen legacy memory archive (claude_desktop_memory) with OpenAI ada-002 embeddings; use tools/backfill-missing-embeddings.js (live neo-brain, Gemini) instead. Re-run with --force-legacy to override.');
    process.exit(1);
}

// Run embedder
embedMemories();