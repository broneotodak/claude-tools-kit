#!/usr/bin/env node
'use strict';

/**
 * Memory Health Check — reads the LIVE neo-brain `memories` table via the shared client
 * (tools/lib/neo-brain.js). Previously targeted SUPABASE_URL = the frozen legacy archive,
 * so it always reported "0 recent" and misleading totals.
 *
 * NULL embeddings are EXPECTED for operational/event categories (agent state, PR-workflow,
 * fleet events) — they are queried by metadata, never vector-searched. The canonical list of
 * those categories lives in lib/neo-brain.js (EVENT_CATEGORIES, the SAME list backfill uses),
 * so this tool and the backfill tool can never disagree about what counts as a real gap.
 * A genuine problem is a NULL embedding in a category that is NOT operational.
 */

const { getNeoBrainClient, EVENT_CATEGORIES, MEMORY_TABLE, NEO_BRAIN_REF } = require('./lib/neo-brain');

let supabase;
try {
  supabase = getNeoBrainClient();
} catch (e) {
  console.error('❌', e.message);
  process.exit(1);
}

async function countWhere(apply) {
  let q = supabase.from(MEMORY_TABLE).select('*', { count: 'exact', head: true });
  if (apply) q = apply(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function checkMemoryHealth() {
  console.log('🔍 neo-brain Memory Health Check\n');
  console.log(`Analyzing live \`${MEMORY_TABLE}\` table (${NEO_BRAIN_REF})...\n`);

  const issues = [];

  try {
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const total = await countWhere();
    const recent24 = await countWhere((q) => q.gte('created_at', dayAgo));
    const recent7 = await countWhere((q) => q.gte('created_at', weekAgo));
    const nullEmb = await countWhere((q) => q.is('embedding', null));

    console.log(`📊 Total memories:        ${total}`);
    console.log(`📈 Last 24 hours:         ${recent24}`);
    console.log(`📈 Last 7 days:           ${recent7}`);
    console.log(`🧬 NULL embeddings:       ${nullEmb}  (operational/event rows skip embeddings by design)`);

    if (recent24 === 0) {
      issues.push({
        severity: 'MEDIUM',
        message: 'No memories written in the last 24h — fleet may be idle or writes are failing',
        fix: 'Confirm agents are running and the @todak/memory SDK is reachable',
      });
    }

    // Tally NULL-embedding rows by category (paginated), then classify against the canonical list.
    const nullByCat = {};
    const page = 1000;
    for (let from = 0; ; from += page) {
      const { data, error } = await supabase
        .from(MEMORY_TABLE)
        .select('category')
        .is('embedding', null)
        .range(from, from + page - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) {
        const c = r.category || '(null)';
        nullByCat[c] = (nullByCat[c] || 0) + 1;
      }
      if (data.length < page) break;
    }

    const operational = [];
    const knowledgeGaps = [];
    for (const [cat, n] of Object.entries(nullByCat)) {
      if (EVENT_CATEGORIES.has(cat)) operational.push({ cat, n });
      else knowledgeGaps.push({ cat, n });
    }

    if (operational.length) {
      console.log('\n🗂️  Operational categories (unembedded by design, not searched):');
      operational.sort((a, b) => b.n - a.n).forEach((o) => console.log(`   ${String(o.n).padStart(5)}  ${o.cat}`));
    }

    for (const g of knowledgeGaps) {
      issues.push({
        severity: 'MEDIUM',
        message: `Non-operational category "${g.cat}" has ${g.n} unembedded row(s) — invisible to semantic search`,
        fix: `node tools/backfill-missing-embeddings.js --apply --category "${g.cat}" (or add "${g.cat}" to EVENT_CATEGORIES in tools/lib/neo-brain.js if it is genuinely operational)`,
      });
    }

    // Duplicate content among recent KNOWLEDGE rows only (operational heartbeats legitimately repeat).
    const { data: recent } = await supabase
      .from(MEMORY_TABLE)
      .select('content')
      .not('embedding', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    const seen = new Set();
    let duplicates = 0;
    recent?.forEach((r) => {
      const c = r.content?.toLowerCase().trim();
      if (!c) return;
      if (seen.has(c)) duplicates++; else seen.add(c);
    });
    if (duplicates > 0) {
      issues.push({
        severity: 'LOW',
        message: `${duplicates} potential duplicate(s) among the 100 most recent knowledge memories`,
        fix: 'Review and deduplicate similar memories',
      });
    }

    console.log('\n📋 Health Check Results:\n');
    if (issues.length === 0) {
      console.log('✅ All checks passed! neo-brain is healthy.');
      console.log('   • Every non-operational category is fully embedded (semantic search intact)');
      console.log('   • Active writes flowing');
    } else {
      console.log(`⚠️  Found ${issues.length} issue(s):\n`);
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      issues.sort((a, b) => order[a.severity] - order[b.severity]);
      issues.forEach((it, i) => {
        console.log(`${i + 1}. [${it.severity}] ${it.message}`);
        console.log(`   Fix: ${it.fix}\n`);
      });
    }

    // --alert: for scheduled/cron runs. On issues, persist an alert memory (so the fleet digest /
    // Siti can surface it) and set a non-zero exit code so a monitor catches the regression.
    // Manual runs (no --alert) always exit 0 so they don't look like failures.
    if (process.argv.includes('--alert') && issues.length) {
      try {
        const { NeoBrain } = await import('../packages/memory/src/index.js');
        const brain = new NeoBrain({ agent: 'memory-health-check' });
        const summary = issues.map((it) => `[${it.severity}] ${it.message}`).join(' | ');
        await brain.save(`memory-health alert (${NEO_BRAIN_REF}): ${issues.length} issue(s) — ${summary}`, {
          category: 'memory_health_alert', type: 'event', importance: 7, visibility: 'private',
        });
        console.log('\n🔔 Alert memory written (category=memory_health_alert).');
      } catch (e) {
        console.error('alert save failed:', e.message);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('❌ Error during health check:', error.message || error);
    process.exit(1);
  }
}

checkMemoryHealth();
