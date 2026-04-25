#!/usr/bin/env bash
# install-fleet-node.sh
# One-shot onboarding for a new MacBook joining Neo Todak's agentic fleet.
# Designed to be paste-runnable by a non-technical operator. Idempotent —
# safe to re-run if anything fails partway through.
#
# Operator paste line (single command):
#   curl -fsSL https://raw.githubusercontent.com/broneotodak/claude-tools-kit/main/tools/install-fleet-node.sh | bash
#
# What it does, in order:
#   1. Verifies macOS + Tailscale already installed
#   2. Installs Homebrew (if missing) + Node + Git
#   3. Clones / updates claude-tools-kit
#   4. Symlinks enforcement docs into ~/.claude/
#   5. Generates an ed25519 SSH key for fleet auth
#   6. Prints hostname / Tailscale IP / public key for the operator to relay

set -euo pipefail

# ── colors ─────────────────────────────────────────────────────────
RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; BLU=$'\e[34m'; BLD=$'\e[1m'; OFF=$'\e[0m'
say()  { echo "${BLU}▸${OFF} $*"; }
ok()   { echo "${GRN}✓${OFF} $*"; }
warn() { echo "${YEL}⚠${OFF}  $*"; }
err()  { echo "${RED}✗${OFF} $*" >&2; }
hr()   { printf '%.0s═' {1..60}; echo; }

echo
hr
echo "${BLD}🚀 Neo Todak — Fleet Node Setup${OFF}"
hr

# ── 0) macOS only ──────────────────────────────────────────────────
[[ "$(uname)" != "Darwin" ]] && { err "This script is for macOS only."; exit 1; }
ok "macOS detected ($(sw_vers -productVersion))"

# ── 1) Tailscale must be installed already ─────────────────────────
TS_BIN="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [ ! -x "$TS_BIN" ] && ! command -v tailscale &>/dev/null; then
  err "Tailscale belum dipasang."
  echo "    Install dulu dari: https://tailscale.com/download/mac"
  echo "    Setelah login, jalankan script ini lagi."
  exit 1
fi
ok "Tailscale terpasang"

# ── 2) Homebrew ────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  say "Memasang Homebrew (sekitar 3-5 menit)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Apple Silicon path
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    # Persist for future shells
    grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null \
      || echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
  ok "Homebrew installed"
else
  ok "Homebrew sudah ada ($(brew --version | head -1))"
fi

# ── 3) Node + Git ──────────────────────────────────────────────────
say "Memasang Node + Git…"
brew install --quiet node git 2>&1 | grep -vE '^(Warning|==>|Already|Pouring|Fetching)' || true
ok "Node $(node --version), Git $(git --version | awk '{print $3}')"

# ── 4) CTK clone ───────────────────────────────────────────────────
CTK="$HOME/Projects/claude-tools-kit"
if [ ! -d "$CTK/.git" ]; then
  say "Mengunduh claude-tools-kit…"
  mkdir -p "$HOME/Projects"
  git clone https://github.com/broneotodak/claude-tools-kit "$CTK"
else
  say "CTK sudah ada — memperbarui…"
  ( cd "$CTK" && git pull --rebase --autostash --quiet ) || warn "git pull non-fatal failure"
fi
ok "CTK ready at $CTK"

# ── 5) Enforcement symlinks ────────────────────────────────────────
mkdir -p "$HOME/.claude"
ln -sf "$CTK/enforcement/CTK_ENFORCEMENT.md"        "$HOME/.claude/CTK_ENFORCEMENT.md"
ln -sf "$CTK/enforcement/MONITORING_ENFORCEMENT.md" "$HOME/.claude/MONITORING_ENFORCEMENT.md"
ok "CTK rules symlinked into ~/.claude/"

# ── 6) Fleet SSH key ───────────────────────────────────────────────
KEY="$HOME/.ssh/id_fleet"
if [ ! -f "$KEY" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "fleet-$(scutil --get LocalHostName 2>/dev/null || hostname -s)" -q
  ok "Generated fleet SSH key"
else
  ok "Fleet SSH key already exists"
fi

# ── 7) Detect Tailscale state ──────────────────────────────────────
TS_IP=""
if [ -x "$TS_BIN" ]; then
  TS_IP=$("$TS_BIN" ip 2>/dev/null | head -1 || true)
fi
[ -z "$TS_IP" ] && TS_IP="(belum konek — pastikan Tailscale app dibuka & login)"

# ── 8) Final output ────────────────────────────────────────────────
HOSTNAME=$(scutil --get LocalHostName 2>/dev/null || hostname -s)

echo
hr
echo "${BLD}${GRN}✅ SETUP SELESAI — Bagian 1 dari 2${OFF}"
hr
echo "Kirim semua info di bawah ini ke Neo via WhatsApp (paling gampang: screenshot semua):"
echo
echo "  SSH user      : $(whoami)"
echo "  Tailscale IP  : $TS_IP"
echo "  Hostname      : $HOSTNAME"
echo "  macOS         : $(sw_vers -productVersion)"
echo "  SSH Pubkey    :"
echo
sed 's/^/    /' "$KEY.pub"
echo
hr
echo
echo "${BLD}Apa yang Neo akan lakukan setelah terima info ini:${OFF}"
echo "  1. Authorize SSH pubkey kamu"
echo "  2. Jalankan ${YEL}add-fleet-node.sh $(whoami) $TS_IP${OFF}"
echo "     (ini push secrets + start heartbeat reporter di laptop kamu)"
echo "  3. Dalam 60 detik laptop kamu mulai laporan ke fleet"
echo "  4. Neo dapet WhatsApp 🆕 'New fleet node detected'"
echo
echo "Kalo udah selesai semua, screenshot lagi WA Neo dan kirim 👍"
echo
