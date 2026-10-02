# EdgeXpert cron tools

Five single-file cron jobs that ran on EdgeXpert (`~/naca/<name>/`) without any git home
until the 2 Oct 2026 fix-in-place code comparison. They are now tracked here; the box runs
a checkout of this folder. Each reads its own `.env` from its working directory (secrets come
from the neo-brain vault, never from this repo) and writes `logs/cron.log` + `state.json`
beside itself.

| Tool | Schedule (user `neo` crontab) | What it does |
|---|---|---|
| wa-line-watch | `*/5 * * * *` | Watches Siti's WhatsApp line (`/healthz`, `/send` probe); reports `wa-line-watch` heartbeat the judge reads |
| cospace-minutes-sync | `*/5 * * * *` | Mirrors cospace meeting minutes into neo-brain |
| store-review-watch | `*/30 * * * *` | Polls App Store Connect + Google Play review state for the company apps, pages on change |
| tasp-migration-watch | `*/30 * * * *` | Auto-applies Kai's Academy (TASP v2) migrations |
| tasp-friday-promote | `0 9 * * 5` | Weekly Academy promotion job |

Crontab lines (each wrapped in `flock -n /tmp/<name>.lock`, `cd` into the tool folder, `node <file> >> logs/cron.log 2>&1`):

```
*/5  * * * *  wa-line-watch        node index.mjs
*/5  * * * *  cospace-minutes-sync node index.mjs
*/30 * * * *  store-review-watch   node index.mjs
*/30 * * * *  tasp-migration-watch node index.mjs
0 9  * * 5    tasp-friday-promote  node promote.mjs
```

Deploy: `git pull` in the box's checkout; the crontab points at these paths. Sentinel/judge
fingerprint the crontab, so a path change pages once (open a maintenance window first).
