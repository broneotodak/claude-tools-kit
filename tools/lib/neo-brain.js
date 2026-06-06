'use strict';

/**
 * Shared neo-brain access for CTK tools — the SINGLE correct way to reach the live memory DB.
 *
 * Why this exists: many tools historically built a Supabase client from process.env.SUPABASE_URL,
 * which resolves to the FROZEN legacy archive (uzamamymfzhelvkwpvgt) since the April-2026 migration.
 * They silently returned stale data. Tools must use getNeoBrainClient() here instead, and the
 * pre-commit guard (tools/check-memory-db-target.js) blocks new legacy access.
 *
 * For semantic search / saves prefer the @todak/memory SDK (packages/memory). Use the raw client
 * below only for counts / health / maintenance queries the SDK doesn't cover.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const NEO_BRAIN_REF = 'xsunmervpyrplzarebva';     // live PRIMARY
const LEGACY_ARCHIVE_REF = 'uzamamymfzhelvkwpvgt'; // frozen read-only archive
const MEMORY_TABLE = 'memories';

// Canonical operational/event categories that intentionally skip embeddings (queried by
// metadata, not vector search). SINGLE SOURCE OF TRUTH for CTK tools — mirrors the DB trigger
// allowlist. check-memory-health.js, backfill-missing-embeddings.js and any future tool must
// import this, never redeclare it, so the "is this row a real embedding gap?" answer can never drift.
// CROSS-REPO MIRRORS that CANNOT import this (sync BY HAND when adding a category):
//   - DB trigger `enforce_memory_embedding_for_knowledge` (SQL — the enforcement authority)
//   - daily-checkup-agent/index.js MEMORY_EVENT_CATEGORIES (separate repo on NAS) — drifted on
//     2026-06-06 (missing planner_deferred_dispatch + 3 others) → false "knowledge NULL" alert.
//     See feedback_allowlist_drift_multi_layer; the lasting fix is to derive these from the DB.
const EVENT_CATEGORIES = new Set([
  'naca_monitor_snapshot',
  'kg_populator_state',
  'pr-stuck-reminder',
  'pr-awaiting-decision',
  'pr-decision-recorded',
  'digest_queue',
  'daily_checkup_run',
  'supervisor-observation',
  'supervisor',
  'planner_decomposition',
  'planner_deferred_dispatch',  // 2026-06-04: planner audit record (AUTONOMOUS_DISPATCH_ENABLED=false). Trigger rejection had jammed the planner. Keep this list == the DB trigger's event_categories.
  'vps_git_drift',
  'fleet-node-discovered',
  'deploy_log',
  'deploy-verified',
  'wa-primary-media',
  'agent_heartbeat',
  'cycle_state',
]);

function refOf(url) {
  const m = (url || '').match(/https:\/\/([a-z0-9]+)\./);
  return m ? m[1] : (url || '');
}

/**
 * Supabase client bound to the LIVE neo-brain. Throws (fails loud) if env is missing or if
 * NEO_BRAIN_URL has been pointed at the frozen legacy archive — never silently reads stale data.
 */
function getNeoBrainClient() {
  const url = process.env.NEO_BRAIN_URL;
  const key = process.env.NEO_BRAIN_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('neo-brain: NEO_BRAIN_URL + NEO_BRAIN_SERVICE_ROLE_KEY required (see claude-tools-kit/.env)');
  }
  if (refOf(url) === LEGACY_ARCHIVE_REF) {
    throw new Error(`neo-brain: NEO_BRAIN_URL points at the FROZEN legacy archive (${LEGACY_ARCHIVE_REF}) — refusing to read stale data`);
  }
  return createClient(url, key);
}

module.exports = {
  getNeoBrainClient,
  EVENT_CATEGORIES,
  MEMORY_TABLE,
  NEO_BRAIN_REF,
  LEGACY_ARCHIVE_REF,
  refOf,
};
