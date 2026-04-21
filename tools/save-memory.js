#!/usr/bin/env node

/**
 * CTK Unified Memory Save
 *
 * Consolidated from save-memory.js + universal-memory-save.js
 * Works from ANY project directory. Falls back through multiple methods.
 *
 * Usage:
 *   node save-memory.js "category" "title" "content" [importance]
 *   node save-memory.js "content" --type=feature --importance=7
 *   node save-memory.js "content"  (auto-detects project)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Always load CTK .env for memory database, regardless of current directory
const CTK_ROOT = path.resolve(__dirname, '..');
const ctkEnvPath = path.join(CTK_ROOT, '.env');
require('dotenv').config({ path: ctkEnvPath });

const { getStandardizedMachineName } = require('./machine-detection');
const { MEMORY_TYPES, MEMORY_CATEGORIES, IMPORTANCE_LEVELS } = require('../config/memory-constants');

// Legacy memory database (uzamamymfzhelvkwpvgt). Kept as read-write during dual-write soak, then read-only archive.
const MEMORY_DB_URL = process.env.SUPABASE_URL || 'https://uzamamymfzhelvkwpvgt.supabase.co';
const MEMORY_DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(MEMORY_DB_URL, MEMORY_DB_KEY);

// New unified memory backend (neo-brain, xsunmervpyrplzarebva). Optional: enables dual-write when env vars set.
const NEO_BRAIN_URL = process.env.NEO_BRAIN_URL;
const NEO_BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NEO_SELF_ID = '00000000-0000-0000-0000-000000000001';
const neoBrain = (NEO_BRAIN_URL && NEO_BRAIN_KEY) ? createClient(NEO_BRAIN_URL, NEO_BRAIN_KEY) : null;

async function embedForNeoBrain(text) {
  if (!GEMINI_API_KEY || !text) return null;
  const model = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: 768 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const vals = d?.embedding?.values;
    return vals ? '[' + vals.join(',') + ']' : null;
  } catch { return null; }
}

async function dualWriteToNeoBrain(memory, legacyId) {
  if (!neoBrain) return { skipped: true };
  try {
    const embedding = await embedForNeoBrain(memory.content);
    const row = {
      content: memory.content,
      embedding,
      category: memory.category,
      memory_type: memory.memory_type,
      importance: memory.importance,
      visibility: memory.visibility || 'internal',
      subject_id: NEO_SELF_ID,
      source: memory.source || 'claude_code',
      source_ref: { legacy_id: legacyId ? String(legacyId) : null, legacy_table: 'claude_desktop_memory', dual_write: true },
      metadata: memory.metadata || {},
    };
    const { data, error } = await neoBrain.from('memories').insert(row).select('id').single();
    if (error) return { error: error.message };
    await neoBrain.from('memory_writes_log').insert({
      memory_id: data.id,
      action: 'insert',
      written_by: 'save-memory.js-dualwrite',
      payload_preview: memory.content.slice(0, 180),
    });
    return { id: data.id };
  } catch (e) {
    return { error: e.message };
  }
}

function detectProject() {
  const cwd = process.cwd();

  // Check for .ctkrc with project field
  const ctkrcPath = path.join(cwd, '.ctkrc');
  if (fs.existsSync(ctkrcPath)) {
    try {
      const ctkrc = JSON.parse(fs.readFileSync(ctkrcPath, 'utf8'));
      if (ctkrc.project) return ctkrc.project;
    } catch(e) { /* ignore */ }
  }

  const dirName = path.basename(cwd);
  const projectMap = {
    'THR': 'THR', 'ATLAS': 'ATLAS', 'todak-ai': 'TodakAI',
    'flowstate-ai': 'FlowState', 'ARS': 'ARS', 'claude-tools-kit': 'CTK',
    'clauden-app': 'ClaudeN', 'ClaudeN': 'ClaudeN',
    'todak-academy-v2': 'Academy', 'musclehub': 'Musclehub',
    'presentation-repo': 'Presentation', 'askmylegal': 'AskMyLegal',
  };

  return projectMap[dirName] || 'General';
}

async function saveMemory(content, options = {}) {
  // Prefer MACHINE_NAME env var if set (allows custom names like "CLAW")
  const machine = process.env.MACHINE_NAME || getStandardizedMachineName();
  const project = options.category || detectProject();

  const memory = {
    user_id: 'neo_todak',
    memory_type: options.type || MEMORY_TYPES.TECHNICAL_SOLUTION,
    category: project,
    content: content,
    metadata: {
      tool: 'claude_code',
      feature: 'ctk_memory_save',
      machine: machine,
      project: project,
      environment: os.platform(),
      date: new Date().toISOString().split('T')[0],
    },
    importance: parseInt(options.importance) || IMPORTANCE_LEVELS.MEDIUM,
    source: 'claude_code'
  };

  try {
    const { data, error } = await supabase
      .from('claude_desktop_memory')
      .insert([memory])
      .select('id');

    if (error) throw error;

    const legacyId = data?.[0]?.id;
    console.log('✅ Memory saved (legacy)!');
    console.log(`   Project: ${project} | Importance: ${memory.importance} | Machine: ${machine}`);

    if (neoBrain) {
      const dualResult = await dualWriteToNeoBrain(memory, legacyId);
      if (dualResult.id) {
        console.log(`✅ Dual-write neo-brain: ${dualResult.id}`);
      } else if (dualResult.error) {
        console.warn(`⚠️  neo-brain dual-write failed: ${dualResult.error}`);
      }
    }

    return { saved: true, id: legacyId };
  } catch (directError) {
    console.error('❌ Direct save failed:', directError.message);

    // Fallback: emergency local file save
    const emergencyFile = path.join(os.homedir(), '.claude-memory-emergency.json');
    const emergencyData = {
      timestamp: new Date().toISOString(),
      content, project, importance: memory.importance,
      error: directError.message
    };
    fs.appendFileSync(emergencyFile, JSON.stringify(emergencyData) + '\n');
    console.log(`📝 Emergency save: ${emergencyFile}`);
    return { saved: false, emergency: true };
  }
}

// CLI: support both old format (category title content importance) and new (content --flags)
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node save-memory.js "category" "title" "content" [importance]');
    console.log('  node save-memory.js "content" [--type=feature] [--importance=7] [--category=THR]');
    process.exit(1);
  }

  // Detect format: if first arg starts with -- or there's only 1 non-flag arg, use new format
  const flags = args.filter(a => a.startsWith('--'));
  const positional = args.filter(a => !a.startsWith('--'));

  const options = {};
  flags.forEach(f => {
    const [key, value] = f.substring(2).split('=');
    options[key] = isNaN(value) ? value : parseInt(value);
  });

  let content;
  if (positional.length >= 3) {
    // Old format: category title content [importance]
    options.category = options.category || positional[0];
    content = `${positional[1]}: ${positional[2]}`;
    if (positional[3]) options.importance = parseInt(positional[3]);
  } else {
    // New format: just content
    content = positional[0];
  }

  saveMemory(content, options)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { saveMemory, detectProject };
