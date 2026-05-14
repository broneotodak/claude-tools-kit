// Interactive eval-set builder: for each candidate question, finds the most
// likely canonical memory IDs via DETERMINISTIC filters (category, source,
// time window, keyword) so we don't bias the eval toward what semantic search
// already finds. Prints candidate IDs + first 200 chars for manual selection.
//
// Run: node --env-file=.env eval/neo-brain/_build-eval-set.mjs
// Then read the output, hand-curate eval-set-v1.json with the IDs Neo agrees
// belong in top-5 for each question.

import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const QUESTIONS = [
  // Person / identity (4)
  { q: 'Who is Lan? Is he the same person as Rokiah?', filter: { content_ilike: '%Rokiah%Lan%' }, cat: 'person' },
  { q: 'Who is Imel and what does she do in the fleet?', filter: { content_ilike: '%Imel%MBA%' }, cat: 'person' },
  { q: 'Is Mudzakkir Hasan Todak Studios staff?', filter: { content_ilike: '%Mudzakkir%' }, cat: 'person' },
  { q: 'Who is Kamiera?', filter: { content_ilike: '%Kamiera%' }, cat: 'person' },

  // Project state (6)
  { q: 'What is NACA Refactor v2 / Agent Plug and Play?', filter: { content_ilike: '%Agent Plug%Play%', cat: 'shared_infra_change' }, cat: 'project-state' },
  { q: 'Is the Academy cutover scheduled or postponed?', filter: { content_ilike: '%Academy%cutover%postpon%' }, cat: 'project-state' },
  { q: 'What phase is the digital twin in right now?', filter: { content_ilike: '%neo-twin%Phase 6%shadow%' }, cat: 'project-state' },
  { q: 'Is the Fleet Command Center live?', filter: { content_ilike: '%Fleet Command Center%' }, cat: 'project-state' },
  { q: 'What is the daily-content pipeline current state?', filter: { content_ilike: '%daily%content%Higgsfield%' }, cat: 'project-state' },
  { q: 'What is the NACA daily-content revamp plan?', filter: { content_ilike: '%content revamp%Penang%bias%' }, cat: 'project-state' },

  // Feedback / rules (6)
  { q: 'Why must we use the SDK for memory writes, never raw POST?', filter: { content_ilike: '%SDK%memory%raw%POST%' }, cat: 'feedback-rule' },
  { q: 'What is the rule about hardcoded agent name lists?', filter: { content_ilike: '%hardcoded%agent%list%' }, cat: 'feedback-rule' },
  { q: 'What is the wacli stdin 64KB limit?', filter: { content_ilike: '%wacli%64KB%' }, cat: 'feedback-rule' },
  { q: 'What is the difference between Siti and neo-twin?', filter: { content_ilike: '%Siti%neo-twin%identity%' }, cat: 'feedback-rule' },
  { q: 'Why never push directly to main?', filter: { content_ilike: '%direct push to main%' }, cat: 'feedback-rule' },
  { q: 'What is the Higgsfield Soul model pairing rule?', filter: { content_ilike: '%soul_cinematic%ref%' }, cat: 'feedback-rule' },

  // Infrastructure / config (4)
  { q: 'What is the deploy URL for naca-app?', filter: { content_ilike: '%naca-app%naca.neotodak.com%' }, cat: 'infra' },
  { q: 'Which LLM agents run on tr-home?', filter: { content_ilike: '%tr-home%pm2%dev-agent%' }, cat: 'infra' },
  { q: 'Where do we store API credentials and secrets?', filter: { content_ilike: '%credentials%vault%neo-brain%' }, cat: 'infra' },
  { q: 'What is the Kuma monitor ID for Siti WhatsApp?', filter: { content_ilike: '%Kuma%monitor%13%siti%' }, cat: 'infra' },

  // Incident / debugging (4)
  { q: 'What caused the 2026-05-13 Siti false-positive alert?', filter: { content_ilike: '%Siti%on leave%false-positive%' }, cat: 'incident' },
  { q: 'Why did chat_thread_state stop working recently?', filter: { content_ilike: '%chat_thread_state%regression%' }, cat: 'incident' },
  { q: 'Why were there 420 NULL embeddings in neo-brain?', filter: { content_ilike: '%420%NULL%embedding%' }, cat: 'incident' },
  { q: 'What is the JWT in PR #11 incident?', filter: { content_ilike: '%JWT%PR%11%' }, cat: 'incident' },

  // Decision / strategy (3)
  { q: 'Why did we move LLM agents from Hetzner to tr-home?', filter: { content_ilike: '%Phase 8%Hetzner%tr-home%' }, cat: 'decision' },
  { q: 'What is the Studio Publisher split?', filter: { content_ilike: '%Studio%Publisher%split%' }, cat: 'decision' },
  { q: 'What is the Q2 2026 active focus?', filter: { content_ilike: '%Q2%2026%focus%' }, cat: 'decision' },

  // Recent activity / multi-session (3)
  { q: 'What did the refactor v2 supervisor migration ship?', filter: { content_ilike: '%supervisor%WATCH%registry%' }, cat: 'recent' },
  { q: 'What is the CTK enforcement Layer 1 trigger?', filter: { content_ilike: '%memories_embedding_guard%trigger%' }, cat: 'recent' },
  { q: 'What is the daily-checkup memory hygiene detector?', filter: { content_ilike: '%checkMemoryHygiene%' }, cat: 'recent' },
];

for (const item of QUESTIONS) {
  const f = item.filter;
  let q = sb.from('memories').select('id, created_at, source, category, memory_type, content').limit(5);
  if (f.cat) q = q.eq('category', f.cat);
  if (f.content_ilike) q = q.ilike('content', f.content_ilike);
  q = q.order('importance', { ascending: false }).order('created_at', { ascending: false });
  const { data, error } = await q;
  console.log(`\n━━ ${item.cat.toUpperCase()} · ${item.q} ━━`);
  if (error) { console.log('  ERROR:', error.message); continue; }
  if (!data || data.length === 0) {
    console.log('  (no candidates · question may need rework or canonical memory does not exist)');
    continue;
  }
  for (const r of data) {
    console.log(`  ${r.id.slice(0,8)} · ${(r.created_at||'').slice(0,10)} · ${r.source} · ${r.category}/${r.memory_type}`);
    console.log(`    ${(r.content||'').slice(0,180).replace(/\n/g,' ')}`);
  }
}
