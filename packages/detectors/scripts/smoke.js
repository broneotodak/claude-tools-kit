// Smoke test for @todak/detectors. Two phases:
//   1. prGithubState against live GitHub API (requires GITHUB_TOKEN)
//   2. checkOrphanPRs against an in-memory mock brain (no DB needed)
//
// Run: GITHUB_TOKEN=$(gh auth token) node scripts/smoke.js

import { prGithubState, checkOrphanPRs } from "../src/index.js";

let pass = 0, fail = 0;
const log = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} · ${label}`); };

// ── prGithubState ──────────────────────────────────────────────────────
console.log("# prGithubState");
const ghCases = [
  { url: "https://github.com/broneotodak/naca/pull/45", expect: "MERGED" },
  { url: "https://github.com/broneotodak/claude-tools-kit/pull/86", expect: "MERGED" },
  { url: "https://example.com/not-a-pr", expect: null },
  { url: "", expect: null },
];
for (const c of ghCases) {
  const got = await prGithubState(c.url);
  log(got === c.expect, `${c.url || "(empty)"} → ${got} (expected ${c.expect})`);
}

// ── checkOrphanPRs ─────────────────────────────────────────────────────
console.log("\n# checkOrphanPRs (mock brain)");

function mockBrain({ awaiting = [], decisions = [] } = {}) {
  return {
    from(table) {
      return {
        select() { return this; },
        eq(col, val) {
          this._filters ??= [];
          this._filters.push([col, val]);
          return this;
        },
        gte() { return this; },
        lt() { return this; },
        limit() { return Promise.resolve({ data: this._resolve() }); },
        then(resolve) { resolve({ data: this._resolve() }); return Promise.resolve({ data: this._resolve() }); },
        _resolve() {
          if (table !== "memories") return [];
          const cat = this._filters?.find(([c]) => c === "category")?.[1];
          if (cat === "pr-awaiting-decision") return awaiting;
          if (cat === "pr-decision-recorded") {
            const urlFilter = this._filters?.find(([c]) => c === "metadata->>pr_url")?.[1];
            return decisions.filter(d => d.metadata?.pr_url === urlFilter);
          }
          return [];
        },
      };
    },
  };
}

const oldIso = new Date(Date.now() - 12 * 3600_000).toISOString();
const veryOldIso = new Date(Date.now() - 18 * 3600_000).toISOString();

// Case 1: no awaiting rows → no findings
{
  const findings = await checkOrphanPRs({ brain: mockBrain({ awaiting: [] }), githubToken: null });
  log(findings.length === 0, "empty awaiting list → []");
}

// Case 2: one awaiting, no decision, no GH token → flag
{
  const findings = await checkOrphanPRs({
    brain: mockBrain({ awaiting: [{ id: "a1", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: oldIso }] }),
    githubToken: null,
  });
  log(findings.length === 1 && findings[0].meta.count === 1, "1 awaiting + no GH check → 1 finding");
}

// Case 3: three awaiting rows for the SAME URL → dedup to 1
{
  const findings = await checkOrphanPRs({
    brain: mockBrain({
      awaiting: [
        { id: "a1", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: veryOldIso },
        { id: "a2", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: oldIso },
        { id: "a3", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: oldIso },
      ],
    }),
    githubToken: null,
  });
  log(findings.length === 1 && findings[0].meta.count === 1, "3 rows same URL → dedup to 1 finding");
  log(findings[0].detail.includes("18h"), `oldest age preserved (~18h) in detail: ${findings[0].detail}`);
}

// Case 4: awaiting + matching decision → skip
{
  const findings = await checkOrphanPRs({
    brain: mockBrain({
      awaiting: [{ id: "a1", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: oldIso }],
      decisions: [{ id: "d1", metadata: { pr_url: "https://github.com/x/y/pull/1" } }],
    }),
    githubToken: null,
  });
  log(findings.length === 0, "decision exists → 0 findings");
}

// Case 5: severity bands — 3+ orphans = FAIL
{
  const findings = await checkOrphanPRs({
    brain: mockBrain({
      awaiting: [
        { id: "a1", metadata: { pr_url: "https://github.com/x/y/pull/1" }, created_at: oldIso },
        { id: "a2", metadata: { pr_url: "https://github.com/x/y/pull/2" }, created_at: oldIso },
        { id: "a3", metadata: { pr_url: "https://github.com/x/y/pull/3" }, created_at: oldIso },
      ],
    }),
    githubToken: null,
  });
  log(findings[0]?.severity === "FAIL" && findings[0]?.meta.count === 3, "3 distinct orphans → FAIL severity");
}

console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
