# NACA-App Focus CC Session Prompt

Paste below into a fresh Claude Code session as the first message when working on the NACA app (the Flutter cross-platform client at `broneotodak/naca-app`). After this, the session knows the layout, deploy methods, and what NOT to break.

**Before doing anything else, read `~/Projects/claude-tools-kit/WORKFLOW.md`** (canonical 5-phase work flow). NACA-app is `tier_1` in `project_registry.tier` — NORMATIVE rules apply.

---

You are scoped to **NACA-app** — Neo's Agentic Centre Application. The Flutter app + Node.js backend that's the operator console for the whole NACA fleet. iOS / macOS / Android / Web.

## What NACA-app is (and is not)

- **Is**: a frontend that reads neo-brain (`agent_heartbeats`, `agent_commands`, `memories`, `naca_milestones`, `project_registry`), proxies through to Siti, and wraps Lan's original CCC terminal interface with NACA-specific tabs.
- **Is not**: a server that drives the fleet. It doesn't dispatch agents or write shared infra except via direct user actions in-app. Most of the fleet logic lives in `siti`, `dev-agent`, `planner-agent`, `reviewer-agent` etc.

The app hosts 8 tabs (the "hacker terminal" UI):

| Tab | Purpose |
|---|---|
| HQ | Dashboard — fleet status, agent_heartbeats, recent commands |
| SITI | WhatsApp inbox view, contact list, settings |
| TERM | Lan's original CCC terminal — Claude Code sessions |
| PROJ | Project list — eventually reads project_registry |
| MEM | Memory viewer — recent neo-brain rows |
| SCHED | scheduled_actions queue + content_drafts |
| WSPC | Workspace (Drive / Gmail via GAM gateway) |
| CFG | Settings + connection tests |

The app is forked from `BroLanTodak/ccc`. Bundle ID was `com.lantodak.lanCcc` until 2026-05-04 when we renamed to `com.broneotodak.naca` (PR #5).

## Live layout

| What | Where |
|---|---|
| Repo | `github.com/broneotodak/naca-app` (you are: `~/Projects/naca-app/`) |
| iOS bundle ID | `com.broneotodak.naca` (after naca-app#5) |
| Display name | `NACA` |
| Apple Developer Team | `YG4N678CT6` (Neo's team) |
| Web deploy | `https://naca.neotodak.com` (auto via GitHub Actions on push to `main`) |
| Backend | Node.js at `~/naca-app/backend/server.js` on the Hetzner VPS, port 3100 |
| Backend nginx vhost | `/etc/nginx/sites-available/naca.neotodak.com` |
| Backend pm2 name | `naca-backend` (PID changes; query pm2 list as openclaw) |
| iOS device | Neo's N17 (his iPhone) |
| Flutter SDK on Mac | (default install) |
| Flutter SDK on VPS | `~/flutter/bin` (need `export PATH="$HOME/flutter/bin:$PATH"`) |

**Deploy methods (3, all valid)**:

1. **GitHub Actions** (preferred for web) — push to `main` → `.github/workflows/deploy.yml` → Flutter build → SCP to VPS. Triggers on changes under `lib/`, `web/`, `pubspec.*`. Deploys to `https://naca.neotodak.com`.
2. **VPS deploy script** — `ssh openclaw@178.156.241.204 "cd naca-app && ./deploy.sh"` runs git pull + pub get + flutter build web. nginx serves from `~/naca-app/build/web/`.
3. **iOS / native** — Xcode build directly to N17 (or other device). Web auto-deploys; native requires manual build.

## What runs on which platform

- **Web** (Chrome / Safari) — uses HTTPS proxy `naca.neotodak.com/api/siti/*` to reach Siti's port 3800. Sound via `dart:js_interop` JS audio.
- **iOS / macOS / Android** — same proxy path (`AppConfig.apiBaseUrl + /api/siti/*`). Sound via `audioplayers` package using bundled MP3/M4A in `assets/sounds/`.
- **Conditional imports**: `lib/services/sound_service.dart` is a 5-line facade that exports either `sound_service_stub.dart` (audioplayers, mobile/desktop) or `sound_service_web.dart` (JS audio, web) via `if (dart.library.js_interop)`.

## Recent fixes (2026-05-04) — all live

- **naca-app#5** — bundle id NACA + cross-platform sound restored (Layer A of iOS distribution work)
- **naca-app#6** — SITI status reads via proxy on iOS, not raw HTTP IP. iOS App Transport Security blocks plain http; the proxy is HTTPS. Three screens fixed (SITI, HQ services panel, Settings → connection test).
- **naca-app#4** — github webhook tightened: dropped push-to-main intent (was duplicate of merge intent + CI deploy notif); merged-PR intent prompt forbids review/audit re-dispatch and dev-agent task dispatch with multi-paragraph bodies.

## Hard rules — DO NOT violate

1. **iOS App Transport Security** blocks plain `http://`. Always route through `${AppConfig.apiBaseUrl}/api/siti/*` (the HTTPS proxy adds the PIN header automatically). Never re-introduce raw `http://178.156.241.204:3800` on the mobile branch.
2. **Don't break Lan's terminal functionality** in `home_screen.dart` — that's the original CCC. NACA additions go as new tabs, not by modifying the terminal screen.
3. **Don't commit `assets/sounds/`** without `pubspec.yaml` declaring them — Flutter silently won't bundle. The audioplayers stub references `AssetSource('sounds/<name>.<ext>')` so the asset path matters.
4. **Bundle ID changes break code signing** — when changing, also clear `DEVELOPMENT_TEAM` so Xcode auto-resigns. Or set it to YG4N678CT6 directly.
5. **Sound architecture is facade pattern** — `sound_service.dart` is 5 lines (export only). The real impl is in `sound_service_stub.dart` (audioplayers) and `sound_service_web.dart` (JS audio). Don't put logic in the facade.
6. **GAM endpoints** are for Workspace integration — they hit TDCC VPS. Don't try to reach them directly from mobile; use the backend proxy.

## First-90-seconds debug entry points

- **"App icon shows wrong name"**: check `ios/Runner/Info.plist` `CFBundleDisplayName` + `CFBundleName`. Should be `NACA`.
- **"Sound doesn't play on iPhone"**: verify `pubspec.yaml` has `audioplayers: ^6.1.0` AND `assets: - assets/sounds/`. Run `flutter clean && flutter pub get`. Check `lib/services/sound_service_stub.dart` is the audioplayers version (~57 lines), not the no-op stub.
- **"SITI tab says not connected"**: `_sitiBase` in `lib/screens/siti_screen.dart` should always use `${AppConfig.apiBaseUrl}/api/siti` — never raw IP. Same in `dashboard_screen.dart` `_checkServices` and `settings_screen.dart` connection test. Check naca-backend pm2 process is running: `ssh root@178.156.241.204 "su - openclaw -c 'pm2 list'"`.
- **"Web build deployed but old bundle showing"**: check `https://naca.neotodak.com/index.html` raw fetch for the build hash. CI builds from `main` branch only. May need to clear browser cache.
- **"Backend webhook firing weird intents"**: `backend/server.js:1486` is `handleGithubWebhook`. Push events to main are intentionally NO-OP after #4. Merged-PR events still create intents but with a tightened prompt.
- **"Authorization 401 from backend"**: app needs `Bearer ${AppConfig.authToken}` for `/api/*` endpoints. Token in `lib/config.dart`.

## Memory discipline (when shipping a NACA-app fix)

- **Category**: `project_naca_app` for milestones, `feedback_naca_app` for corrections from Neo, `naca_session_<date>` for big session summaries.
- **Scope**: `ops` for fleet-flow / pipeline fixes; `knowledge` for architecture / "where things live"; `personal` for casual chat about the app (rare in this scope).
- **Importance**: 6 for routine fixes, 7 for architecture decisions, 8+ for shipped phases / regression fixes.

## Pointers (read these when relevant)

- `~/Projects/claude-tools-kit/WORKFLOW.md` — canonical 5-phase work flow
- `~/Projects/claude-tools-kit/REVAMP-V1.0.0.md` — current operation context
- `~/Projects/naca-app/CLAUDE.md` — project-specific rules (auto-loads when cwd is inside)
- `~/.claude/CLAUDE.md` — global rules
- neo-brain memory: search for `naca_session`, `project_naca_app`, `feedback_naca_app`

## Tone

Match Neo's: terse, direct, no marketing. Confirm before destructive actions (force-push, drop tables, kill PM2 processes that other agents depend on). When asked for a status, give it from real signals — heartbeats, git log, deploys — not narrative.
