#!/usr/bin/env node
// cospace-minutes-sync — mirrors finished cospace meeting minutes into
// neo-brain so Siti's recall surfaces them automatically.
//
// Read-only against cospace's Supabase (db.cospace.team, service key fetched
// from the neo-brain vault at runtime — nothing secret in this dir's .env
// beyond the standard NEO_BRAIN/GEMINI trio). Writes embedded knowledge
// memories via @naca/core helpers (full-text chunk+mean-pool embedding).
//
// Cron: every 5 min under flock. Changelog: shared_infra_change 2026-08-03.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const envPath = join(HERE, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CORE = '/home/neo/naca/naca/packages/core/src';
const { embedText } = await import(`${CORE}/gemini.js`);
const { getCredential } = await import(`${CORE}/vault.js`);
const { selectRows, insertRow } = await import(`${CORE}/postgrest.js`);

const COSPACE_URL = process.env.COSPACE_SUPABASE_URL || 'https://db.cospace.team';
const SOURCE = 'cospace-minutes-sync';

function myt(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function mytTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatMinutes(rec) {
  const lines = [];
  const dur = rec.ended_at
    ? Math.round((new Date(rec.ended_at) - new Date(rec.started_at)) / 60000)
    : null;
  lines.push(
    `Minit Mesyuarat Cospace — bilik ${rec.room} — ${myt(rec.started_at)}` +
    `${rec.ended_at ? `–${mytTime(rec.ended_at)}` : ''} MYT${dur ? ` (${dur} min)` : ''}`
  );
  const att = Array.isArray(rec.attendees) ? rec.attendees : [];
  if (att.length) lines.push(`Peserta (${att.length}): ${att.map((a) => a.name).join(', ')}`);
  if (rec.started_by_name) lines.push(`Dimulakan oleh: ${rec.started_by_name}`);
  if (rec.summary) lines.push('', 'RINGKASAN:', rec.summary.trim());
  const topics = rec.minutes?.topics || [];
  if (topics.length) {
    lines.push('', 'TOPIK:');
    topics.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title}`);
      (t.points || []).forEach((p) => lines.push(`   - ${p}`));
    });
  }
  const actions = rec.minutes?.actions || [];
  if (actions.length) {
    lines.push('', 'TINDAKAN:');
    actions.forEach((a) => lines.push(`- ${a.who}: ${a.what}${a.due ? ` (sebelum ${a.due})` : ''}`));
  }
  return lines.join('\n');
}

const key = await getCredential('cospace_supabase', 'service_role_key');
const resp = await fetch(
  `${COSPACE_URL}/rest/v1/recordings` +
  `?status=eq.done&minutes=not.is.null` +
  `&select=id,room,started_by_name,started_at,ended_at,summary,minutes,attendees` +
  `&order=started_at.desc&limit=25`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) }
);
if (!resp.ok) {
  console.error(`${new Date().toISOString()} cospace fetch ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  process.exit(1);
}
const recs = await resp.json();

let saved = 0;
for (const rec of recs) {
  const dup = await selectRows(
    'memories',
    `source=eq.${SOURCE}&source_ref->>cospace_recording_id=eq.${rec.id}&select=id&limit=1`
  );
  if (dup.length) continue;
  const content = formatMinutes(rec);
  const embedding = await embedText(content);
  if (!embedding) {
    // Knowledge rows must carry an embedding (neo-brain trigger enforces it) —
    // leave the row unsynced so the next run retries instead of half-saving.
    console.error(`${new Date().toISOString()} embed failed for ${rec.id} — will retry next run`);
    continue;
  }
  await insertRow('memories', {
    content,
    embedding,
    category: 'meeting_minutes',
    memory_type: 'note',
    importance: 6,
    visibility: 'internal',
    source: SOURCE,
    source_ref: { cospace_recording_id: rec.id, room: rec.room },
    metadata: {
      scope: 'knowledge',
      system: 'cospace',
      room: rec.room,
      started_at: rec.started_at,
      ended_at: rec.ended_at,
      attendees: (rec.attendees || []).map((a) => a.name),
    },
  });
  saved++;
  console.log(`${new Date().toISOString()} saved minutes ${rec.id} (${rec.room}, ${myt(rec.started_at)})`);
}
console.log(`${new Date().toISOString()} done — ${recs.length} candidates, ${saved} new`);
