#!/usr/bin/env node

/**
 * Standalone Memory Save for Claude Code
 * Works regardless of which project directory you're in
 * 
 * Usage: node /Users/broneotodak/Projects/claude-tools-kit/tools/standalone-memory-save.cjs "Your content here"
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// Hardcoded for reliability (no dotenv dependency issues)
const SUPABASE_URL = 'https://uzamamymfzhelvkwpvgt.supabase.co';
const SUPABASE_KEY_FILE = path.join(__dirname, '..', '.env');

// Read key from .env file directly
function getServiceKey() {
  try {
    const envContent = fs.readFileSync(SUPABASE_KEY_FILE, 'utf8');
    const match = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/);
    if (match) return match[1].trim();
    
    // Fallback to anon key
    const anonMatch = envContent.match(/SUPABASE_ANON_KEY=(.+)/);
    if (anonMatch) return anonMatch[1].trim();
  } catch (e) {
    console.error('Could not read .env file:', e.message);
  }
  return null;
}

async function saveMemory(content, project = 'THR', memoryType = 'session_summary') {
  const key = getServiceKey();
  if (!key) {
    console.error('❌ No Supabase key found');
    process.exit(1);
  }

  const data = JSON.stringify({
    user_id: 'neo_todak',
    owner: 'neo_todak',
    source: 'claude_desktop',
    category: project,
    memory_type: memoryType,
    importance: 7,
    content: content,
    metadata: {
      machine: 'MacBook Pro',
      tool: 'Claude Code',
      project: project,
      activity_type: 'session_end',
      flowstate_ready: true,
      saved_via: 'standalone-memory-save.cjs'
    }
  });

  const options = {
    hostname: 'uzamamymfzhelvkwpvgt.supabase.co',
    port: 443,
    path: '/rest/v1/claude_desktop_memory',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=representation',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Memory saved successfully!');
          try {
            const result = JSON.parse(body);
            console.log(`📝 Memory ID: ${result[0]?.id || 'unknown'}`);
          } catch (e) {}
          resolve(true);
        } else {
          console.error(`❌ Failed (${res.statusCode}):`, body);
          reject(new Error(body));
        }
      });
    });

    req.on('error', (e) => {
      console.error('❌ Request error:', e.message);
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

// Main
const content = process.argv[2];
const project = process.argv[3] || 'THR';
const memoryType = process.argv[4] || 'session_summary';

if (!content) {
  console.log('Usage: node standalone-memory-save.cjs "content" [project] [memory_type]');
  console.log('Example: node standalone-memory-save.cjs "Session complete" THR session_summary');
  process.exit(1);
}

console.log(`📤 Saving memory to ${project}...`);
saveMemory(content, project, memoryType)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
