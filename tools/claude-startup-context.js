#!/usr/bin/env node

/**
 * Real-time RAG Context Loader for Claude Code
 * Automatically loads relevant context on startup
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
require('dotenv').config();

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Create embedding for query
async function createEmbedding(text) {
  if (!openaiKey) return null;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      input: text,
      model: 'text-embedding-ada-002',
    });

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (parsed.data?.[0]?.embedding) {
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

/**
 * Get context from current directory/project
 */
function detectContext() {
  const cwd = process.cwd();
  const contexts = [];

  // Detect project
  if (cwd.includes('/THR')) {
    contexts.push('THR HRMS project');
  } else if (cwd.includes('/ATLAS')) {
    contexts.push('ATLAS asset management');
  } else if (cwd.includes('/claude-tools-kit')) {
    contexts.push('Claude Tools Kit development');
  } else if (cwd.includes('/todak-ai')) {
    contexts.push('TODAK AI WhatsApp bot');
  }

  // Add general work context
  contexts.push('recent work', 'important decisions', 'current progress');

  return contexts.join(' ');
}

/**
 * Load relevant memories via semantic search
 */
async function loadRelevantMemories(contextQuery, limit = 10) {
  try {
    // Create embedding for context query
    const embedding = await createEmbedding(contextQuery);

    if (!embedding) {
      console.log('⚠️  No OpenAI key - loading recent memories instead');
      return loadRecentMemories(limit);
    }

    // Semantic search using pgvector
    const { data, error } = await supabase.rpc('match_memories', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: limit,
    });

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error in semantic search:', error.message);
    return loadRecentMemories(limit);
  }
}

/**
 * Fallback: Load recent memories
 */
async function loadRecentMemories(limit = 10) {
  const { data, error } = await supabase
    .from('claude_desktop_memory')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Format context for Claude
 */
function formatContext(memories) {
  let context = '# Claude Code Session Context\n\n';
  context += `**Loaded**: ${new Date().toLocaleString()}\n`;
  context += `**Relevant Memories**: ${memories.length}\n\n`;

  context += '## Recent Context\n\n';

  for (const memory of memories) {
    const category = memory.metadata?.category || 'General';
    const title = memory.metadata?.title || 'Untitled';
    const importance = memory.metadata?.importance || 'N/A';
    const date = new Date(memory.created_at).toLocaleDateString();

    context += `### [${category}] ${title}\n`;
    context += `*${date} - Importance: ${importance}*\n\n`;
    context += memory.content.substring(0, 300);
    if (memory.content.length > 300) context += '...';
    context += '\n\n---\n\n';
  }

  return context;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const customQuery = args.join(' ');

  console.log('\n🧠 Real-time RAG Context Loader\n');

  // Detect or use custom context
  const contextQuery = customQuery || detectContext();
  console.log(`📍 Context: ${contextQuery}\n`);

  // Load memories
  console.log('🔍 Searching for relevant memories...');
  const memories = await loadRelevantMemories(contextQuery, 10);

  if (memories.length === 0) {
    console.log('⚠️  No relevant memories found\n');
    return;
  }

  console.log(`✅ Found ${memories.length} relevant memories\n`);

  // Format and output
  const context = formatContext(memories);
  console.log(context);

  // Save to temp file for easy reference
  const fs = require('fs');
  const tempFile = '/tmp/claude-context.md';
  fs.writeFileSync(tempFile, context);
  console.log(`\n💾 Context saved to: ${tempFile}`);
  console.log(`\n💡 Use this context to inform your conversation with Claude Code\n`);
}

// Help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Real-time RAG Context Loader

Automatically loads relevant memories based on current project context.

Usage:
  node claude-startup-context.js [custom query]

Examples:
  node claude-startup-context.js                    # Auto-detect from current directory
  node claude-startup-context.js "database migrations"  # Custom query
  node claude-startup-context.js "recent bugs"      # Search specific topic

Features:
  ✅ Auto-detects project from current directory
  ✅ Semantic search using embeddings (if OpenAI key available)
  ✅ Falls back to recent memories
  ✅ Formats context for easy reading
  ✅ Saves to /tmp/claude-context.md

Integration:
  Add to your .zshrc or .bashrc:
    alias claude-start='node ~/Projects/claude-tools-kit/tools/claude-startup-context.js && claude'
`);
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
