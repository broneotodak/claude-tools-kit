#!/usr/bin/env node

/**
 * Memory Health Check Tool for Claude Code
 * Checks the LIVE neo-brain `memories` table (xsunmervpyrplzarebva) for common issues.
 *
 * NOTE: This used to target the legacy archive (SUPABASE_URL / claude_desktop_memory),
 * which has been frozen since the April-2026 neo-brain migration — so it always reported
 * "0 recent" and misleading totals. It now reads NEO_BRAIN_URL / `memories`, the PRIMARY store.
 *
 * NULL embeddings are EXPECTED for operational/event categories (agent state, PR-workflow,
 * fleet events) — they are not semantic knowledge and are never embedded. The health signal
 * that matters is a *partially-embedded* category: one that has both embedded and non-embedded
 * rows, which means embedding is failing for a category that is supposed to be searchable.
 * This is detected dynamically (no hardcoded category list) per Agent Plug & Play rules.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Target the LIVE neo-brain. Fall back to generic SUPABASE_* only if NEO_BRAIN_* is unset.
const supabaseUrl = process.env.NEO_BRAIN_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEO_BRAIN_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables (NEO_BRAIN_URL / NEO_BRAIN_SERVICE_ROLE_KEY)');
    process.exit(1);
}

const ref = (supabaseUrl.match(/https:\/\/([a-z0-9]+)\./) || [])[1] || supabaseUrl;
const supabase = createClient(supabaseUrl, supabaseKey);
const TABLE = 'memories';

async function countWhere(apply) {
    let q = supabase.from(TABLE).select('*', { count: 'exact', head: true });
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
}

async function checkMemoryHealth() {
    console.log('🔍 neo-brain Memory Health Check\n');
    console.log(`Analyzing live \`${TABLE}\` table (${ref})...\n`);

    const issues = [];

    try {
        const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

        const total = await countWhere();
        const recent24 = await countWhere(q => q.gte('created_at', dayAgo));
        const recent7 = await countWhere(q => q.gte('created_at', weekAgo));
        const nullEmb = await countWhere(q => q.is('embedding', null));

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

        // Pull all NULL-embedding rows (paginated) and tally by category.
        const nullByCat = {};
        let from = 0;
        const page = 1000;
        for (;;) {
            const { data, error } = await supabase
                .from(TABLE)
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
            from += page;
        }

        // Classify each NULL-bearing category by its embed-rate = embedded / (embedded + null).
        //   • rate < 0.5  → operational/event category (mostly unembedded by design) — informational.
        //   • rate >= 0.5 → knowledge category that is mostly embedded but has gaps → real backfill
        //                   candidate (those NULL rows are missed embeddings, invisible to search).
        // Stray-embedded rows in operational categories no longer cry wolf; this self-adjusts per
        // category with no hardcoded list.
        const KNOWLEDGE_RATE = 0.5;
        const operational = [];
        const knowledgeGaps = [];
        for (const cat of Object.keys(nullByCat)) {
            const nulls = nullByCat[cat];
            const embedded = await countWhere(q => q.eq('category', cat).not('embedding', 'is', null));
            const rate = embedded / (embedded + nulls);
            if (rate >= KNOWLEDGE_RATE) knowledgeGaps.push({ cat, nulls, embedded, rate });
            else operational.push({ cat, nulls });
        }

        if (operational.length) {
            console.log('\n🗂️  Operational categories (mostly unembedded — expected, not searched):');
            operational.sort((a, b) => b.nulls - a.nulls)
                .forEach(o => console.log(`   ${String(o.nulls).padStart(5)}  ${o.cat}`));
        }

        for (const p of knowledgeGaps) {
            issues.push({
                severity: 'MEDIUM',
                message: `Knowledge category "${p.cat}" has ${p.nulls} unembedded row(s) (${Math.round(p.rate * 100)}% embedded) — likely missed embeddings, invisible to semantic search`,
                fix: `node tools/backfill-missing-embeddings.js (category "${p.cat}")`,
            });
        }

        // Duplicate content among recent KNOWLEDGE rows only (embedded). Operational categories
        // legitimately repeat identical heartbeat/state lines, so excluding them avoids false dups.
        const { data: recent } = await supabase
            .from(TABLE)
            .select('content')
            .not('embedding', 'is', null)
            .order('created_at', { ascending: false })
            .limit(100);
        const seen = new Set();
        let duplicates = 0;
        recent?.forEach(r => {
            const c = r.content?.toLowerCase().trim();
            if (!c) return;
            if (seen.has(c)) duplicates++; else seen.add(c);
        });
        if (duplicates > 0) {
            issues.push({
                severity: 'LOW',
                message: `${duplicates} potential duplicate(s) among the 100 most recent memories`,
                fix: 'Review and deduplicate similar memories',
            });
        }

        console.log('\n📋 Health Check Results:\n');
        if (issues.length === 0) {
            console.log('✅ All checks passed! neo-brain is healthy.');
            console.log('   • Knowledge categories fully embedded (semantic search intact)');
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
    } catch (error) {
        console.error('❌ Error during health check:', error.message || error);
        process.exit(1);
    }
}

checkMemoryHealth();
