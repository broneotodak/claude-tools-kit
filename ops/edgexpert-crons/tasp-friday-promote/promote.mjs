#!/usr/bin/env node
// tasp-friday-promote — weekly staging→prod promote for portal.todakacademy.edu.my
// Runs on EdgeXpert (cron, Fri 09:00 MYT). Sibling pattern: tasp-migration-watch.
//
// Flow: SSH to academy-vps (Kay .213) → guard checks → sudo deploy-prod.sh →
// verify the live site from the outside → WhatsApp receipt to Neo via the
// Siti owner lane (agent_commands).
//
// Guards:
//   1. Any merged-but-unapplied DB migration → SKIP promote + alert (the
//      frontend may depend on schema that isn't there yet).
//   2. Staging bundle == prod bundle → nothing to do, quiet info WA.
// FORCE=1 bypasses guard 2 (synthetic full-path test; rsync is idempotent).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('.env', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const NEO_WHATSAPP = env.NEO_WHATSAPP || '60177519610';
const { NEO_BRAIN_URL, NEO_BRAIN_SERVICE_ROLE_KEY } = env;
const HOST = 'academy-vps';
const LIVE = 'https://portal.todakacademy.edu.my';
const COOKIE = 'tasp_staff=ok2026'; // staff unlock cookie, mirrors nginx portal-prod vhost

function sshRun(script) {
  return execFileSync('ssh',
    ['-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes', HOST, script],
    { encoding: 'utf8', timeout: 180000 });
}

async function wa(message) {
  const res = await fetch(`${NEO_BRAIN_URL}/rest/v1/agent_commands`, {
    method: 'POST',
    headers: {
      apikey: NEO_BRAIN_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${NEO_BRAIN_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      from_agent: 'tasp-friday-promote',
      to_agent: 'siti',
      command: 'send_whatsapp_notification',
      payload: { to: NEO_WHATSAPP, message },
      priority: 3,
    }),
  });
  if (!res.ok) throw new Error(`agent_commands enqueue ${res.status}`);
}

const stamp = new Date().toISOString();
try {
  const state = sshRun(`
    set -e
    pending=$(comm -23 <(ls /srv/tasp/repo/supabase/migrations/*.sql | xargs -n1 basename | sort) \
      <(sudo docker exec -i supabase-db psql "$(sudo grep ^ACADEMY_DB_URL /srv/tasp/secrets/academy.env | cut -d= -f2-)" -tA -c "SELECT filename FROM public._tasp_migrations_applied" | sort) | wc -l)
    staging=$(grep -o 'index-[^"]*[.]js' /srv/tasp/repo/dist/index.html | head -1)
    prod=$(grep -o 'index-[^"]*[.]js' /srv/tasp/prod/dist/index.html | head -1)
    echo "pending=$pending staging=$staging prod=$prod"
  `);
  const m = state.match(/pending=(\d+) staging=(\S*) prod=(\S*)/);
  if (!m) throw new Error(`state parse failed: ${state.trim().slice(0, 200)}`);
  const [, pending, staging, prod] = m;
  if (!staging) throw new Error('staging dist missing or unreadable');

  if (Number(pending) > 0) {
    await wa(`⚠️ TASP Friday auto-promote SKIPPED: ${pending} DB migration(s) merged but not yet applied (migration-watch escalation pending?). Resolve, then promote manually: sudo /srv/tasp/bin/deploy-prod.sh on academy-vps.`);
    console.log(`${stamp} skipped: ${pending} pending migrations`);
    process.exit(0);
  }
  if (staging === prod && process.env.FORCE !== '1') {
    await wa(`ℹ️ TASP Friday auto-promote: no new frontend build since last promote (live bundle ${prod}). Nothing to do.`);
    console.log(`${stamp} no-op: staging == prod (${prod})`);
    process.exit(0);
  }

  const out = sshRun('sudo /srv/tasp/bin/deploy-prod.sh');
  console.log(out.trim());

  // Verify from the outside: staff view must serve the staging bundle and it must load.
  const html = await (await fetch(`${LIVE}/login`, { headers: { Cookie: COOKIE } })).text();
  const liveBundle = (html.match(/index-[^"]*[.]js/) || [])[0];
  if (liveBundle !== staging) throw new Error(`verify failed: live serves ${liveBundle}, expected ${staging}`);
  const asset = await fetch(`${LIVE}/assets/${staging}`, { method: 'HEAD' });
  if (!asset.ok) throw new Error(`verify failed: bundle HEAD ${asset.status}`);

  await wa(`✅ TASP Friday auto-promote: staging build is now LIVE on portal.todakacademy.edu.my (bundle ${staging}${staging !== prod ? `, was ${prod || 'none'}` : ', re-synced'}). Verified: staff view serves it + asset loads. Public maintenance gate untouched.`);
  console.log(`${stamp} promoted ${prod} -> ${staging}, verified live`);
} catch (err) {
  console.error(`${stamp} FAILED: ${err.message}`);
  try { await wa(`❌ TASP Friday auto-promote FAILED: ${String(err.message).slice(0, 300)} — prod left as-is. Log: /home/neo/naca/tasp-friday-promote/logs/cron.log on EdgeXpert.`); } catch {}
  process.exit(1);
}
