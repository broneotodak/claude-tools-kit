# WORKFLOW.md

How to work on a project — for any CC session and any NACA agent.

This is the operational rhythm. It has 5 phases. Whether all 5 are mandatory depends on the project's **tier**, which lives in `project_registry.tier`.

---

## TL;DR

```
START
  └─ Identify project → look up tier in project_registry
       ├─ tier_1 (shared infra, fleet-critical)  → ALL 5 phases NORMATIVE
       ├─ tier_2 (standalone production)         → 5 phases RECOMMENDED
       │                                            (NORMATIVE when touching
       │                                             neo-brain or other shared
       │                                             infra inside the project)
       └─ tier_3 (sandbox / planning)             → Orient only.
                                                    Save memory if knowledge
                                                    was gained.
```

The full registry can be queried at any time:

```bash
node -e "
import('dotenv/config').then(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  const { data } = await sb.from('project_registry')
    .select('project,tier,active,deploy_method,deploy_url,description')
    .eq('active', true)
    .order('tier').order('project');
  for (const r of data) console.log(\`[\${r.tier||'?'}] \${r.project.padEnd(28)} \${r.deploy_method||'-'}\`);
});
"
```

---

## Tier rules — what changes between tiers

| Phase | tier_1 | tier_2 | tier_3 |
|---|---|---|---|
| **1. Orient** | Required | Required | Required |
| **2. Plan** | Required (state intent + confirm with Neo unless reversible) | Required for non-cosmetic | Optional |
| **3. Execute** | Required (PR + reviewer + admin merge) | Required (PR; admin merge OK if reviewer ✅) | Direct commit OK on local-only / experimental |
| **4. Save** | Required (memory + tier-appropriate category + scope tag) | Required if behaviour changed | Required if knowledge was gained |
| **5. Verify** | Required (post-deploy health check) | Required if customer-facing | Optional |

When in doubt: **upgrade one tier**. T2 + writing to shared infra → treat as T1.

---

## The 5 phases

### 1 — Orient *(before any edit)*

Before changing anything, know what you're walking into. Run these in order:

```bash
# 1a. cd into the project so its CLAUDE.md (if any) auto-loads.
cd ~/Projects/<project-name>

# 1b. Look at recent state.
git log --oneline -5
git status

# 1c. Look up the project's tier + deploy info.
# (Use the registry query in the TL;DR section.)

# 1d. Check live state of related agents.
node -e "
import('dotenv/config').then(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  const { data } = await sb.from('agent_heartbeats').select('agent_name,status,reported_at').order('reported_at',{ascending:false}).limit(20);
  for (const r of data) {
    const ageSec = Math.round((Date.now() - new Date(r.reported_at).getTime()) / 1000);
    console.log(r.agent_name.padEnd(22), r.status.padEnd(10), 'age=' + ageSec + 's');
  }
});
"

# 1e. Recall memory for context. Use semantic search if available, else PostgREST.
node ~/Projects/claude-tools-kit/tools/recall-memory.js "<topic>" --limit 5
# Or: search by category if you know the right one
# (categories: project_*, feedback_*, reference_*, pr-*, planner_*, session_handoff*)
```

For **shared-infra changes** (writing to `agent_commands`, `memories`, `kg_triples`, `agent_heartbeats`, `scheduled_actions`, `agent_intents`, `agent_registry`): **also read** `~/Projects/claude-tools-kit/enforcement/CTK_ENFORCEMENT.md §9` (multi-session coordination). It's the rules layer above this doc — don't skip.

For **host-specific work** (tr-home, NAS, CLAW, slave-mbp): paste the host's focus prompt from `~/Projects/claude-tools-kit/prompts/focus/<HOST>.md` into the session as the first message. *(Coming in Step 4 of the revamp.)*

### 2 — Plan *(state intent before action)*

In one or two sentences, write down what you're about to do and what success looks like. Then:

- **tier_1**: Confirm with Neo unless the change is small + reversible (e.g., a typo fix in a comment). Default: confirm.
- **tier_2**: Confirm if the change is non-cosmetic OR if it touches shared infra inside the project.
- **tier_3**: Proceed.

If a change has destructive blast radius (drop table, force push, deploy to production with no rollback), confirmation is **always required** regardless of tier.

### 3 — Execute *(the standard PR shape)*

```bash
# 3a. Branch off main. Never edit main directly — anomaly auto-revert PR will fire.
cd ~/Projects/<project>
git checkout main && git pull origin main
git checkout -b <type>/<short-slug>            # types: fix | feat | docs | chore | refactor

# 3b. Edit. Self-review the diff before committing.
git diff

# 3c. Test. Minimum: syntax. Add unit / lint where the project has them.
node --check <file>.js                          # for JS
flutter analyze <path>                          # for Flutter
# Run any project-specific tests/lints listed in its CLAUDE.md.

# 3d. Commit + push. Imperative subject, paragraph for "why", not "what".
git add <specific files>                        # avoid `git add .` to prevent accidental .env commits
git commit -m "<type>(<area>): <imperative subject>

<one-paragraph why this matters>
<bullets if listing changes is helpful>"

git push -u origin <branch>

# 3e. Open PR. The reviewer-agent will pick it up automatically when github-actions
#     fires the webhook into naca-app/backend.
gh pr create --title "..." --body "..."

# 3f. Wait for reviewer-agent's verdict (or reply with your own justification if
#     it requests changes you intend to override). Verdict comes via Siti as
#     "🔍 Reviewer · PR awaiting your call" on the operator-brief WhatsApp thread.

# 3g. Merge. --admin only when the reviewer signed off OR you have explicit
#     reason to override. --squash by default (keeps main history linear).
gh pr merge <N> --repo broneotodak/<repo> --squash --admin

# 3h. Deploy. The deploy method depends on project_registry.deploy_method:
#       netlify_git_push  → CI auto-deploys on merge to main
#       pm2_vps           → ssh + git pull --rebase + pm2 restart <name>
#       pm2_slave_mbp     → ssh slave + git pull + pm2 restart
#       launchd_claw      → ssh CLAW + git pull (launchd auto-respawns)
#       manual            → check the project's CLAUDE.md
#     Example for pm2_vps:
ssh root@178.156.241.204 "su - openclaw -c 'cd <project> && git pull --rebase && pm2 restart <name>'"

# 3i. Verify. Sanity-check the deploy actually worked (see phase 5).
```

### 4 — Save *(milestone discipline)*

Save memory whenever you:
- Ship a fix or feature (✓)
- Make an architectural decision (✓)
- Discover a non-obvious behaviour or constraint (✓)
- Learn something Neo or a future CC session would want to find later (✓)

```bash
node ~/Projects/claude-tools-kit/tools/save-memory.js \
  "<category>" "<title>" "<content with details + why-it-matters>" <importance:1-10> \
  --agent claude-code-naca
```

**Categories** (use existing patterns; don't invent new ones unless you have a reason):

- `project_<name>` — project-specific milestones, "X shipped" / "Y blocked"
- `feedback_<topic>` — corrections from Neo, *include the why* so future agents understand the rule
- `reference_<topic>` — pointers to systems, dashboards, hosts (the "where to find it" memories)
- `revamp_baseline` — major operations like the v1.0.0 revamp
- `session_handoff` — end-of-session summaries
- `shared_infra_change` — anything that touches `agent_commands`, `memories`, `kg_triples`, `agent_heartbeats`, `scheduled_actions`, `agent_registry`, `agent_intents` (per CTK §9)

**Scope tag** (Phase 7 Layer A — landed 2026-05-04 in siti#40): the `--agent` flag tags as `claude-code-*`. The classifier in Siti handles WhatsApp scope tagging automatically. For other writers, set `metadata.scope` explicitly when calling the SDK directly:

- `ops` — fleet flow, PR briefs, deploys, agent state, monitor alerts
- `knowledge` — research, references, external lookups
- `personal` — direct conversation, casual recall
- `fleet` — architecture decisions, infra, agent placement

**Importance scale**:
- 1–3: noise / debug logs
- 4–5: routine "X happened"
- 6: notable shipped work, decisions worth recalling later
- 7: structural pattern, recurring rule, project-shaping decision
- 8–9: blocking issue, root-cause discovery, post-incident learning
- 10: identity / philosophical / multi-month decisions

Also update `naca_milestones` if a phase step shipped:

```bash
node -e "
import('dotenv/config').then(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  await sb.from('naca_milestones').update({
    item_status: 'done', item_icon: '✓',
    tag: 'SHIPPED · ' + new Date().toISOString().slice(0,10),
    title: '<step title with brief shipped-summary>',
    updated_at: new Date().toISOString(),
  }).eq('phase_code','<phase-X>').eq('kind','item').eq('step_order', <N>);
});
"
```

If user-visible behaviour changed, also update the project's presentation page at `presentation.neotodak.com/<project>.html` *(or open a PR against the `presentation` repo)*.

### 5 — Verify *(post-deploy health check)*

After deploying, prove it works. **Don't claim success on the basis of "the merge succeeded."**

```bash
# 5a. Heartbeat is fresh (within 60s for live agents).
node -e "
import('dotenv/config').then(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  const { data } = await sb.from('agent_heartbeats').select('agent_name,reported_at').eq('agent_name','<name>').single();
  const ageSec = Math.round((Date.now() - new Date(data.reported_at).getTime()) / 1000);
  console.log(data.agent_name, 'age', ageSec + 's');
});
"

# 5b. The expected endpoint responds.
curl -fsS "<deploy_url>/<health-path>" | head -5

# 5c. The expected behaviour is observable. For app changes, open the live URL
#     and click through the changed flow. For agent changes, send a test trigger
#     and watch logs:
ssh root@178.156.241.204 "su - openclaw -c 'pm2 logs <name> --lines 30 --nostream'"

# 5d. No new stuck commands or orphan PRs (run periodically across the fleet,
#     not per-PR).
node -e "
import('dotenv/config').then(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.NEO_BRAIN_URL, process.env.NEO_BRAIN_SERVICE_ROLE_KEY);
  const { data: stuck } = await sb.from('agent_commands').select('id').in('status',['pending','claimed','running']).lt('created_at', new Date(Date.now()-10*60_000).toISOString());
  console.log('stuck commands:', stuck?.length || 0);
});
"
```

For UI / frontend changes, **type-check + test suite are not enough**. Open the live URL in a browser, walk the golden path, watch for regressions in adjacent flows.

---

## Hard rules — always, regardless of tier

1. **Never push directly to `main`.** Branch + PR + admin merge. Anomaly detection auto-files revert PRs against direct main commits.
2. **Never edit files on the live VPS in-place.** Edit local repo, PR, merge, ssh + `git pull --rebase` + `pm2 restart`. The "deploy by editing live" pattern is what created today's hold-guard regression.
3. **Never bypass `--no-verify` or `--no-gpg-sign`** unless explicitly asked. Pre-commit hooks block credential leaks.
4. **Never invent memory categories.** Use existing ones. Pattern drift makes recall worse.
5. **Never make destructive shared-infra changes (DROP, force-push, mass DELETE) without explicit operator confirmation in this session**, regardless of tier. CTK §9 governs.
6. **Never claim success on `git push` alone.** A merge isn't a deploy. Run phase 5.
7. **Never put multi-line / shell-quoted prose into a `git commit -m` argument.** Use `--body-file` or HEREDOC. (Today's dev-agent failure pattern.)
8. **Vault first** for any user-supplied secret. Never hardcode credentials. CTK §4.
9. **Don't pre-decide which option Neo wants.** When offering A/B/C, present them honestly. Neo defaults to C (full build) — don't hedge toward A.
10. **If something looks unfamiliar (file, branch, config) — investigate first, don't delete.** It might be in-progress work from another session.

---

## Common scenarios — shortcuts

**Cosmetic local change to a tier_2 project** (rename a label, fix a typo):
- Phase 1 (orient: cd in, git status) → Phase 3 (commit + PR + merge) → Phase 4 (save memory only if non-obvious learning)
- Skip Phase 2 + 5 confirm/verify ceremony.

**Hotfix on a tier_1 production agent** (live failure, time-sensitive):
- Phase 1 (orient — minimal: just confirm what's broken) → Phase 2 (state intent, confirm with Neo) → Phase 3 (branch, PR, **admin merge OK without reviewer** if reviewer is the broken thing or if the fix is mechanical) → Phase 5 (verify live)
- Defer Phase 4 (save memory) to *after* the fire is out, but do it within 24h.

**Pure exploration / read-only** (running queries, exploring code, semantic search):
- No edits = no PR = no merge. Skip phases 3–5 entirely.
- Save memory in Phase 4 only if you discovered something worth recalling.

**Multi-session coordination** (you know another CC session is active on the same project):
- Phase 1 + read CTK §9. The pre-flight check + post-deploy `shared_infra_change` memory are mandatory regardless of tier.

---

## How this doc is loaded

- **CC sessions on Neo's Mac**: `~/.claude/CLAUDE.md` references this doc → reads it on every session start.
- **NACA agents** (reviewer, planner, dev-agent, verifier, supervisor, dispatcher, toolsmith): each agent's system prompt references this doc by path. *(Step 5 of REVAMP-V1.0.0 wires this in.)*
- **Per-host focus prompts** (`prompts/focus/<HOST>.md`): each one points back here for the canonical flow + adds host-specific quirks. *(Step 4 of REVAMP-V1.0.0.)*

If you change this doc, update `naca_milestones` (the workflow doc itself is part of REVAMP-V1.0.0 Step 2). Bump the version in the doc title if the rules change materially.

---

## Version

**WORKFLOW.md v1.0** — first canonical version, 2026-05-04. Lives at `claude-tools-kit/WORKFLOW.md`. Referenced by the v1.0.0 revamp at `claude-tools-kit/REVAMP-V1.0.0.md`.
