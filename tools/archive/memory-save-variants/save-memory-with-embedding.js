#!/usr/bin/env node

/**
 * Enhanced Memory Save with Auto-Embedding
 * Saves to pgVector and automatically creates embeddings
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const os = require('os');
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

// Get machine name
function getMachineName() {
  const hostname = os.hostname();
  if (hostname.includes('MacBook-Pro')) return 'MacBook Pro';
  if (hostname.includes('MacBook-Air')) return 'MacBook Air';
  if (hostname.includes('office')) return 'Office PC';
  return 'Home PC';
}

// Create embedding using OpenAI
async function createEmbedding(text) {
  if (!openaiKey) {
    console.warn('⚠️  No OpenAI API key - skipping embedding');
    return null;
  }

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

async function saveMemory(category, title, content, importance = 5) {
  const machineName = getMachineName();

  console.log(`\n💾 Saving to pgVector memory...`);
  console.log(`   Category: ${category}`);
  console.log(`   Title: ${title}`);
  console.log(`   Importance: ${importance}`);
  console.log(`   Machine: ${machineName}`);

  try {
    // Create embedding
    let embedding = null;
    if (openaiKey) {
      console.log(`\n🧠 Creating embedding...`);
      const embeddingText = `${title} ${content} ${category}`;
      embedding = await createEmbedding(embeddingText);
      console.log(`   ✅ Embedding created (${embedding.length} dimensions)`);
    }

    // Save to database
    const { data, error } = await supabase.from('claude_desktop_memory').insert([
      {
        content: content,
        metadata: {
          category: category,
          title: title,
          importance: importance,
          machine: machineName,
          source: 'claude-code',
          created_by: 'save-memory-with-embedding',
        },
        embedding: embedding,
      },
    ]).select();

    if (error) {
      console.error('\n❌ Error saving memory:', error);
      process.exit(1);
    }

    console.log(`\n✅ Memory saved successfully!`);
    console.log(`   ID: ${data[0].id}`);
    console.log(`   Created: ${new Date(data[0].created_at).toLocaleString()}`);
    if (embedding) {
      console.log(`   Embedding: ✓ Included (semantic search enabled)`);
    } else {
      console.log(`   Embedding: ✗ Skipped (set OPENAI_API_KEY to enable)`);
    }
    console.log(`\n💡 Memory is now searchable via RAG tools\n`);

  } catch (error) {
    console.error('\n❌ Unexpected error:', error);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
  console.log(`
Enhanced Memory Save with Auto-Embedding

Usage: node save-memory-with-embedding.js <category> <title> <content> [importance]

Arguments:
  category    - Category (Session, Progress, Learning, Decision, Project, Config)
  title       - Short title
  content     - Full content to save
  importance  - Importance level 3-8 (default: 5)

Features:
  ✅ Auto-creates embeddings for semantic search
  ✅ Validates input
  ✅ Saves to pgVector with metadata
  ✅ Enables immediate RAG retrieval

Examples:
  node save-memory-with-embedding.js "Progress" "Phase 2 Complete" "Implemented MCP server and auto-embedding" 6
  node save-memory-with-embedding.js "Learning" "Git Hooks" "Pre-commit hooks prevent credential leaks" 5

Environment:
  SUPABASE_URL              - Required
  SUPABASE_SERVICE_ROLE_KEY - Required
  OPENAI_API_KEY            - Optional (for embeddings)
`);
  process.exit(1);
}

const [category, title, content, importance = 5] = args;

// Validate category
const validCategories = ['Session', 'Progress', 'Learning', 'Decision', 'Project', 'Config'];
if (!validCategories.includes(category)) {
  console.error(`❌ Invalid category: ${category}`);
  console.error(`   Valid categories: ${validCategories.join(', ')}`);
  process.exit(1);
}

// Validate importance
const importanceNum = parseInt(importance);
if (isNaN(importanceNum) || importanceNum < 3 || importanceNum > 8) {
  console.error(`❌ Invalid importance: ${importance}`);
  console.error(`   Must be between 3 and 8`);
  process.exit(1);
}

// Save memory
saveMemory(category, title, content, importanceNum);
