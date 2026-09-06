#!/usr/bin/env node

/**
 * capture-cc-session.js — capture a Claude Code session into neo-brain, searchable.
 *
 * Reads a CC session transcript (~/.claude/projects/<proj>/<session_id>.jsonl),
 * summarises it via Gemini, embeds the summary, and stores ONE row in `memories`
 * (memory_type='session', source='claude_code') so Neo can later recall
 * "what did I do with Claude Code on X". Idempotent: a session already captured
 * (matched by source_ref.session_id) is skipped.
 *
 * Usage:
 *   node capture-cc-session.js <session_id | transcript_path>
 *   node capture-cc-session.js            (uses $CLAUDE_CODE_SESSION_ID)
 *
 * Designed to run from the SessionEnd hook, but safe to run manually/backfill.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CTK_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(CTK_ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');

const NEO_BRAIN_URL = process.env.NEO_BRAIN_URL;
const NEO_BRAIN_KEY = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NEO_SELF_ID = '00000000-0000-0000-0000-000000000001';
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MIN_USER_PROMPTS = 2; // skip trivial sessions

if (!NEO_BRAIN_URL || !NEO_BRAIN_KEY) {
  console.error('capture-cc-session: NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY required');
  process.exit(0); // exit 0 so a hook never blocks session end
}
const brain = createClient(NEO_BRAIN_URL, NEO_BRAIN_KEY);

async function embedText(text) {
  if (!GEMINI_API_KEY || !text) return null;
  const model = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 2048) }] }, outputDimensionality: 768 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const vals = d?.embedding?.values;
    return vals ? '[' + vals.join(',') + ']' : null;
  } catch { return null; }
}

async function geminiSummarize(convText) {
  if (!GEMINI_API_KEY) return null;
  const prompt = `You are summarising a Claude Code (AI pair-programming CLI) session for Neo Todak's searchable memory. From the user's prompts and the assistant's key replies below, output ONLY compact JSON with keys:
"title" (<= 8 words, specific), "summary" (3-5 sentences: what was worked on, key decisions, and outcomes), "key_points" (array of 3-6 short bullets), "areas" (array of repos/systems/topics touched, e.g. "siti-router", "neo-brain", "naca.neotodak.com").
Focus on what Neo would search for later. No prose outside the JSON.

SESSION:
${convText.slice(0, 24000)}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    let txt = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    txt = txt.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(txt);
  } catch { return null; }
}

function resolveTranscript(arg) {
  if (arg && arg.endsWith('.jsonl') && fs.existsSync(arg)) return arg;
  const id = arg || process.env.CLAUDE_CODE_SESSION_ID;
  if (!id) return null;
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  for (const proj of fs.readdirSync(PROJECTS_DIR)) {
    const p = path.join(PROJECTS_DIR, proj, `${id}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n');
  }
  return '';
}

function parseTranscript(file) {
  const userPrompts = []; const assistantMsgs = [];
  let firstTs = null; let lastTs = null;
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    if (o.timestamp) { firstTs = firstTs || o.timestamp; lastTs = o.timestamp; }
    const m = o.message;
    if (o.type === 'user' && m) {
      // a real prompt is a string; tool-result user turns are arrays — skip those
      if (typeof m.content === 'string' && m.content.trim()) userPrompts.push(m.content.trim());
    } else if (o.type === 'assistant' && m) {
      const t = textOf(m.content).trim();
      if (t) assistantMsgs.push(t);
    }
  }
  const project = path.basename(path.dirname(file));
  return { userPrompts, assistantMsgs, firstTs, lastTs, project };
}

function buildConvText(p) {
  const lines = [];
  p.userPrompts.forEach((u, i) => {
    lines.push(`USER: ${u.slice(0, 900)}`);
    const a = p.assistantMsgs[i];
    if (a) lines.push(`ASSISTANT: ${a.slice(0, 700)}`);
  });
  return lines.join('\n\n');
}

async function alreadyCaptured(sessionId) {
  try {
    const { data } = await brain.from('memories').select('id')
      .eq('source', 'claude_code').eq('memory_type', 'session')
      .contains('source_ref', { session_id: sessionId }).limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}

async function main() {
  const arg = process.argv[2] || process.env.CLAUDE_CODE_SESSION_ID;
  const file = resolveTranscript(arg);
  if (!file) { console.log('capture-cc-session: no transcript found for', arg || '(none)'); return; }
  const sessionId = path.basename(file, '.jsonl');
  const p = parseTranscript(file);
  if (p.userPrompts.length < MIN_USER_PROMPTS) { console.log(`capture-cc-session: ${sessionId} trivial (${p.userPrompts.length} prompts) — skip`); return; }
  if (await alreadyCaptured(sessionId)) { console.log(`capture-cc-session: ${sessionId} already captured — skip`); return; }

  const conv = buildConvText(p);
  const s = await geminiSummarize(conv);
  const title = s?.title || `Claude Code session in ${p.project}`;
  const areas = Array.isArray(s?.areas) ? s.areas : [];
  const keyPoints = Array.isArray(s?.key_points) ? s.key_points : [];
  const content = [
    `# ${title}`,
    s?.summary || `Session with ${p.userPrompts.length} prompts. First ask: "${p.userPrompts[0].slice(0, 160)}".`,
    keyPoints.length ? '\nKey points:\n' + keyPoints.map((k) => `- ${k}`).join('\n') : '',
    areas.length ? `\nAreas: ${areas.join(', ')}` : '',
    `\nFirst ask: ${p.userPrompts[0].slice(0, 200)}`,
  ].filter(Boolean).join('\n');

  const embedding = await embedText(content);
  const row = {
    content, embedding,
    category: 'claude_code',
    memory_type: 'session',
    importance: 5,
    visibility: 'private',
    subject_id: NEO_SELF_ID,
    source: 'claude_code',
    source_ref: { session_id: sessionId, transcript: file },
    metadata: {
      tool: 'capture-cc-session.js', session_id: sessionId, project: p.project,
      user_prompts: p.userPrompts.length, assistant_msgs: p.assistantMsgs.length,
      started_at: p.firstTs, ended_at: p.lastTs, title, areas,
    },
  };
  const { data, error } = await brain.from('memories').insert(row).select('id').single();
  if (error) { console.error('capture-cc-session: save failed:', error.message); return; }
  console.log(`capture-cc-session: ✓ ${sessionId} → memory ${data.id} ("${title}")`);
}

main().catch((e) => { console.error('capture-cc-session error:', e.message); process.exit(0); });
