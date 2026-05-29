// Lane B / admin-merge guard helper.
//
// pr-decision-recorded is not written when a trusted actor self-merges via
// `gh pr merge` or an admin merges directly. Before flagging a PR as orphan,
// consumers reconcile against GitHub: if it's already MERGED or CLOSED, skip.
//
// Fail-open: missing token / network / non-200 → null (caller falls back to
// flagging). With GITHUB_TOKEN: MERGED/CLOSED PRs are correctly skipped.
//
// Returns: "MERGED" | "CLOSED" | "OPEN" | null

export async function prGithubState(prUrl, {
  token = process.env.GITHUB_TOKEN,
  userAgent = "todak-detectors",
  timeoutMs = 10_000,
} = {}) {
  const m = String(prUrl || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  const [, owner, repo, num] = m;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (data.merged_at) return "MERGED";
    if (data.state === "closed") return "CLOSED";
    return "OPEN";
  } catch {
    return null;
  }
}
