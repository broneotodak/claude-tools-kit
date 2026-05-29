// Orphan-PR detector. Looks for pr-awaiting-decision memories >cutoff old
// without a matching pr-decision-recorded. Reconciles against GitHub to skip
// PRs that were Lane B / admin-merged (which never write a decision row).
//
// Returns an array of finding objects: [] if none, otherwise a single finding
// summarising the count. Severity: 1-2 orphans = WARN, 3+ = FAIL.

import { prGithubState } from "./github-state.js";

function fmtAge(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export async function checkOrphanPRs({
  brain,
  cutoffMs = 6 * 3600_000,        // 6h: how long awaiting before flagged
  horizonMs = 30 * 86400_000,     // 30d: how far back to look
  githubToken = process.env.GITHUB_TOKEN,
  userAgent = "todak-detectors",
} = {}) {
  if (!brain) throw new Error("checkOrphanPRs: brain is required");

  const cutoff = new Date(Date.now() - cutoffMs).toISOString();
  const horizon = new Date(Date.now() - horizonMs).toISOString();

  const { data: aw } = await brain
    .from("memories")
    .select("id,metadata,created_at")
    .eq("category", "pr-awaiting-decision")
    .eq("archived", false)
    .gte("created_at", horizon)
    .lt("created_at", cutoff);

  // Dedup by URL — multiple pr-awaiting-decision rows can exist for the same PR
  // (re-registration, verifier nudges, repeated pushes). Keep the oldest
  // created_at so reported age stays honest.
  const oldestByUrl = new Map();
  for (const r of aw || []) {
    const url = r.metadata?.pr_url;
    if (!url) continue;
    const prev = oldestByUrl.get(url);
    if (!prev || new Date(r.created_at).getTime() < new Date(prev).getTime()) {
      oldestByUrl.set(url, r.created_at);
    }
  }

  const orphans = [];
  for (const [url, age] of oldestByUrl) {
    const { data: dec } = await brain
      .from("memories")
      .select("id")
      .eq("category", "pr-decision-recorded")
      .eq("metadata->>pr_url", url)
      .limit(1);
    if (dec && dec.length > 0) continue;
    // No pr-decision-recorded row. Reconcile against GitHub before flagging —
    // Lane B self-merges and admin merges never write that memory.
    const ghState = await prGithubState(url, { token: githubToken, userAgent });
    if (ghState === "MERGED" || ghState === "CLOSED") continue;
    orphans.push({ url, age });
  }

  if (orphans.length === 0) return [];
  return [{
    id: `orphan-prs-${orphans.length}`,
    severity: orphans.length <= 2 ? "WARN" : "FAIL",
    check: "orphan_prs",
    label: `${orphans.length} PR(s) awaiting decision >6h`,
    detail: orphans.slice(0, 5).map(o => `${fmtAge(o.age)} ago · ${o.url}`).join("; "),
    meta: { count: orphans.length, prs: orphans.slice(0, 10).map(o => o.url) },
  }];
}
