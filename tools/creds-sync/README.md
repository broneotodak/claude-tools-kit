# creds-sync — propagate fresh Claude Code OAuth creds to VPS Claude instances

## Problem

VPS Claude Code instances (TASP, TDCC, NACA backend) need a `~/.claude/.credentials.json`
holding a fresh access token + refresh token to spawn `claude -p ...` per request.
OAuth login over SSH is broken (memory `ee775d9d` — `Unknown scope: org:create_api_key`
on Team workspaces; PKCE quirks on `claude setup-token`). Only macOS interactive OAuth
works reliably for our account.

The lazy-refresh path inside Claude Code keeps a VPS alive if claude is spawned
regularly, but if the refresh-token grace window closes or a session sits idle
too long, all consumers go cold and someone has to manually re-OAuth via Chrome.

## Solution

Treat a home Mac as the canonical credential source — its keychain holds a
known-good refresh token that Claude Code itself rotates on use. Run a tiny
LaunchAgent loop:

1. **keep-warm** — every 6h, spawn `claude -p ":"`. This forces Claude Code's own
   refresh path to exercise the refresh token and write rotated tokens back to
   the keychain. Cheap (one inference call) and uses Anthropic's own refresh logic,
   not a reimplementation.
2. **creds-share** — every 60s, dump the keychain entry into `/tmp/<host>-creds-share.json`
   (atomic via `.tmp + mv`, mode 0600).
3. **push** — every 60s, pipe that file via SSH to the VPS, where a single
   forced-command receiver validates the JSON and writes it to
   `/root/.claude/.credentials.json` plus any other consumer paths.

Pushing (rather than VPS-pulling) sidesteps slave-mbp's known
Tailscale-inbound-stays-broken-after-network-blip quirk (memory `183b67d5`) —
outbound from the Mac is the reliable direction.

## Files

| File | Where it lives | Purpose |
|---|---|---|
| `com.todak.claude-keep-warm.plist` | `~/Library/LaunchAgents/` on each home Mac | 6h keep-warm |
| `com.todak.slave-creds-share.plist` | `~/Library/LaunchAgents/` on slave-mbp | 60s keychain → `/tmp/slave-creds-share.json` |
| `com.todak.slave-creds-push-tasp.plist` | `~/Library/LaunchAgents/` on slave-mbp | 60s push to TASP VPS |
| `tasp-creds-receiver.sh` | `/usr/local/bin/` on TASP VPS | SSH forced-command receiver |
| `share-from-keychain.sh` | `/usr/local/bin/` on each home Mac | helper invoked by `creds-share` plist |
| `push-to-tasp.sh` | `/usr/local/bin/` on slave-mbp | helper invoked by `push-tasp` plist |

## Security shape

- The push SSH key on slave-mbp is single-purpose; on TASP it's pinned in
  `/root/.ssh/authorized_keys` with `command="/usr/local/bin/tasp-creds-receiver"`
  plus `no-pty`, `no-port-forwarding`, `no-X11-forwarding`, `no-agent-forwarding`.
- Push goes over the **public IP** (5.223.43.54), not tailnet — TASP runs
  Tailscale SSH which intercepts tailnet→tailnet :22 and demands re-auth,
  which breaks unattended pushes. `from=` IP-restriction is omitted because
  slave-mbp's home ISP IP is dynamic; the forced-command + monotonic-receiver
  combo is the real boundary. A compromised key only enables DoS (and
  monotonic check kills downgrade attempts).
- Receiver validates the JSON shape AND requires the pushed `expiresAt` to be
  ≥ the existing one (monotonic) so a poisoned or stale push can't downgrade
  the VPS.
- All credential files are mode 0600.
- Worst-case slave-mbp compromise: attacker can DoS the VPS by writing
  garbage that fails validation (receiver rejects it and exits non-zero, leaving
  the existing file intact).

## Install — slave-mbp

Helpers live under `~/bin/` (no sudo needed) and plists in `~/Library/LaunchAgents/`.

```bash
# As slave on slave-mbp:
mkdir -p ~/bin ~/.ssh
install -m 755 share-from-keychain.sh push-to-tasp.sh ~/bin/

# Generate the push-only SSH key (separate from any admin key already on this Mac):
ssh-keygen -t ed25519 -N "" -C "slave-mbp tasp-creds-push" -f ~/.ssh/id_ed25519_tasp_creds_push

# Pin the TASP host key into known_hosts so StrictHostKeyChecking=yes can succeed
# on the first automated push. Without this the first run fails with a host-key prompt.
ssh-keyscan -H 5.223.43.54 >> ~/.ssh/known_hosts

cp com.todak.claude-keep-warm.plist ~/Library/LaunchAgents/
cp com.todak.slave-creds-share.plist ~/Library/LaunchAgents/
cp com.todak.slave-creds-push-tasp.plist ~/Library/LaunchAgents/

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.todak.claude-keep-warm.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.todak.slave-creds-share.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.todak.slave-creds-push-tasp.plist
```

The pubkey at `~/.ssh/id_ed25519_tasp_creds_push.pub` then needs to be appended
to TASP's `/root/.ssh/authorized_keys` per the TASP install section below.

## Install — TASP VPS

```bash
# As root on 5.223.43.54:
install -m 755 tasp-creds-receiver.sh /usr/local/bin/tasp-creds-receiver
install -m 644 tasp-creds-receiver.logrotate /etc/logrotate.d/tasp-creds-receiver
# append the slave-mbp pubkey line to /root/.ssh/authorized_keys
# format:
#   command="/usr/local/bin/tasp-creds-receiver",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... slave-creds-push
```

The logrotate entry weekly-rotates `/var/log/tasp-creds-receiver.log` and keeps
4 compressed generations. Without it the log grows ~1 KiB per real rotation
(every ~8h) plus REJECT noise.

## Rollback

```bash
# slave-mbp:
launchctl bootout gui/$(id -u)/com.todak.slave-creds-push-tasp
launchctl bootout gui/$(id -u)/com.todak.slave-creds-share
launchctl bootout gui/$(id -u)/com.todak.claude-keep-warm
rm ~/Library/LaunchAgents/com.todak.{claude-keep-warm,slave-creds-share,slave-creds-push-tasp}.plist
# TASP: delete the forced-command line from /root/.ssh/authorized_keys
```

The existing `/api/auth/refresh` Mac-pull path on TASP stays untouched as a
manual fallback (super_admin button in the panel).

## Manual operator steps (not automated)

1. On each home Mac that joins as a source: enable macOS auto-login for that
   user (Settings → Users & Groups → Automatically log in as `<user>`). Without
   this a power-trip leaves the keychain locked and the share loop fails silently.
2. Install Claude Code CLI on the Mac if it isn't already
   (`npm i -g @anthropic-ai/claude-code` under Homebrew node).

## TDCC (added 2026-05-27)

TDCC is the second consumer. Unlike TASP it isn't on Tailscale and
slave-mbp isn't its source — instead the **operator's MBP** pushes directly:

- `tdcc-creds-receiver.sh` on TDCC (`/usr/local/bin/tdcc-creds-receiver`) —
  same shape/monotonic validation as the TASP receiver, but writes only to
  `/home/lanccc/.claude/.credentials.json`. The existing `/etc/cron.d/claude-sync`
  on TDCC mirrors that hourly to `/home/kamiera` + `/home/neo`. For instant
  fan-out the TDCC web UI's "Renew auth" button (`POST /api/auth/refresh`,
  in `BroLanTodak/tdcc#neo/renew-auth-button`) runs the same mirror on demand.
- `push-to-tdcc.sh` on the operator MBP (`~/bin/`) — pipes
  `/tmp/tasp-creds-share.json` (same Neo-keychain dump that powers TASP) to
  TDCC root over SSH every 60s via `com.todak.push-creds-to-tdcc.plist`.
- `tdcc-creds-receiver.logrotate` — same weekly rotate as TASP.

**Identity context:** TDCC was previously running on Lan's Anthropic account
(`azlan.ariffin83@gmail.com`) — his keychain seeded the credentials and was
copied hourly to all three TDCC users. With Lan's offline agreement, TDCC
consolidated onto Neo's `software@todak.com` account effective the first
successful push (2026-05-27 ~13:59 UTC).

### Install — TDCC

```bash
# As root on 5.223.80.244:
install -m 755 tdcc-creds-receiver.sh /usr/local/bin/tdcc-creds-receiver
install -m 644 tdcc-creds-receiver.logrotate /etc/logrotate.d/tdcc-creds-receiver
# append the operator-MBP pubkey to /root/.ssh/authorized_keys:
#   command="/usr/local/bin/tdcc-creds-receiver",no-pty,no-port-forwarding,no-X11-forwarding,no-agent-forwarding ssh-ed25519 AAAA... macbook-pro-2-tdcc-creds-push
```

### Install — operator MBP (for TDCC push)

```bash
# As broneotodak on the operator Mac:
mkdir -p ~/bin
install -m 755 push-to-tdcc.sh ~/bin/

ssh-keygen -t ed25519 -N "" -C "macbook-pro-2 tdcc-creds-push" -f ~/.ssh/id_ed25519_tdcc_push
ssh-keyscan -H 5.223.80.244 >> ~/.ssh/known_hosts

cp com.todak.push-creds-to-tdcc.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.todak.push-creds-to-tdcc.plist
```

The operator MBP's existing `com.todak.tasp-creds-share.plist` keeps
`/tmp/tasp-creds-share.json` fresh — `push-to-tdcc.sh` reads from that same
file, so adding TDCC as a consumer required no changes to the share plist.

## Future

- claw-mba (`zieel@100.93.159.1`) — second source for TASP, same shape,
  separate keypair. VPS picks newer `expiresAt`. Pending Neo's call.
- slave-mbp → TDCC (passive auto-refresh from home) — if wanted alongside
  the operator MBP push, deploy `push-to-tdcc.sh` + parallel plist on
  slave-mbp.
- Install Tailscale on TDCC so a UI button could pull live from the operator
  MBP (instead of relying on the passive push). Deferred — current passive
  push covers the UX without adding a new tailnet node.
