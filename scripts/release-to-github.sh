#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Warehouse14 — first-release-to-GitHub script.
#
# Run this ONCE from /Users/basel/Desktop/warehouse14/. It:
#   1. Verifies the repo + token are valid before touching anything.
#   2. Initialises git locally, sets identity, stages everything (gitignore
#      already hardened — no node_modules, no .DS_Store, no secrets).
#   3. Confirms the staged tree contains NO sensitive files.
#   4. Pushes `main` to https://github.com/963s/Roman.git.
#   5. Uploads `TAURI_SIGNING_PRIVATE_KEY` + `..._PASSWORD` as repo secrets.
#   6. Tags v0.1.0 and pushes the tag — which triggers .github/workflows/release.yml,
#      building macOS-arm64 + macOS-x64 + Windows-x64 simultaneously.
#
# Stops at the first failure. Safe to re-run if anything below #4 fails;
# delete `.git/` and re-run for a full reset.
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Inputs ───────────────────────────────────────────────────────────
# The script reads the GitHub token from the environment — NEVER inline it
# in this file. The repository is public; embedding a PAT here would leak
# it the moment this file is committed.
#
# Usage:
#   export GH_TOKEN='ghp_...'
#   bash scripts/release-to-github.sh
#
# A token-rotation produces a fresh value; only the env var changes,
# never this script.
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo 'error: export GH_TOKEN=<your_pat> before running this script.' >&2
  echo '       The token needs scopes: repo + workflow + admin:public_key.' >&2
  exit 1
fi

readonly REPO_OWNER='963s'
readonly REPO_NAME='Roman'
readonly REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
readonly KEY_PATH='/tmp/w14-updater-keys/warehouse14_updater.key'
readonly RELEASE_TAG='v0.1.0'

# ── Pretty printing ──────────────────────────────────────────────────
step() { printf '\n\033[1;33m═══ %s ═══\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Pre-flight ────────────────────────────────────────────────────
step "0. Pre-flight"
cd "$(dirname "$0")/.."  # → /Users/basel/Desktop/warehouse14
[[ -f docs/memory.md ]] || die "Run from inside the warehouse14 tree."
[[ -f apps/tauri-pos/src-tauri/tauri.conf.json ]] || die "tauri-pos missing."
[[ -f $KEY_PATH ]] || die "Updater private key missing at $KEY_PATH."
[[ -f .github/workflows/release.yml ]] || die "release.yml missing."
ok "tree shape verified"

# ── 1. gh CLI auth + git credential setup ────────────────────────────
step "1. Authenticate gh"
command -v gh >/dev/null || die "gh CLI not installed. brew install gh"
echo "$GH_TOKEN" | gh auth login --with-token
gh auth status
gh auth setup-git
ok "gh authenticated"

# ── 2. Repo exists + push permission? ───────────────────────────────
step "2. Repo permission check"
RESP=$(gh api "repos/${REPO_OWNER}/${REPO_NAME}" --jq '{full_name,private,default_branch,push:.permissions.push}')
echo "$RESP"
echo "$RESP" | grep -q '"push":true' || die "Token has no push perm on the repo."
ok "push permission OK"

# ── 3. git init + identity ───────────────────────────────────────────
step "3. git init + identity"
if [[ -d .git ]]; then
  echo "  .git already exists — keeping it"
else
  git init -b main
fi
USER_ID=$(gh api user --jq '.id')
git config user.name "${REPO_OWNER}"
git config user.email "${USER_ID}+${REPO_OWNER}@users.noreply.github.com"
ok "git identity: $(git config user.name) <$(git config user.email)>"

# ── 4. Sensitive-file leak check ─────────────────────────────────────
step "4. Sensitive-file leak check"
STAGED_PREVIEW=$(git add -An . 2>&1)
LEAKS=$(printf '%s\n' "$STAGED_PREVIEW" | grep -E \
  "warehouse14_updater\.key|\.env$|node_modules/|src-tauri/target/|/dist/|\.DS_Store" \
  || true)
if [[ -n "$LEAKS" ]]; then
  echo "$LEAKS"
  die "SENSITIVE FILES would be staged. ABORTING. Fix .gitignore first."
fi
TOTAL_FILES=$(printf '%s\n' "$STAGED_PREVIEW" | grep -c "^add " || echo 0)
ok "would stage $TOTAL_FILES files; no sensitive leaks detected"

# ── 5. Set GitHub Actions secrets (BEFORE push, so first build can sign) ─
step "5. Upload signing secrets to GitHub Actions"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "${REPO_OWNER}/${REPO_NAME}" < "$KEY_PATH"
printf '' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "${REPO_OWNER}/${REPO_NAME}"
ok "TAURI_SIGNING_PRIVATE_KEY uploaded"
ok "TAURI_SIGNING_PRIVATE_KEY_PASSWORD uploaded (empty)"
gh secret list --repo "${REPO_OWNER}/${REPO_NAME}"

# ── 6. Stage + commit + remote + push ────────────────────────────────
step "6. Stage + commit + push main"
git add .
git commit -m "feat: Warehouse14 POS v0.1.0 — Phase 1 + 2.A + 2.B Day-14 complete

• Tier-1 POS Core (PIN, Verkauf, Kasse, Ankauf, Bewertung, Lager, Kunden, Werkstatt)
• Native hardware bridge (TSE / ZVT / ESC-POS / A4 PDF), memory.md §18
• Brutal Audit C-1..C-4 + W-1/W-2/W-7 resolved, memory.md §19
• Phase 2.A Commerce + MCP backend, memory.md §20
• Day-14 Web & SEO UI in Lager, memory.md §23
• Auto-update via tauri-plugin-updater + GitHub Releases, memory.md §25
• Real brand icon (Parchment + Gold seal), generated from src-tauri/icons/generate.py

Migrations 0001–0030 ship as part of this drop." || ok "no changes to commit (re-run safe)"

git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git push -u origin main
ok "main pushed to $REPO_URL"

# ── 7. Tag v0.1.0 + push → triggers release.yml on GitHub Actions ───
step "7. Tag $RELEASE_TAG + push (kicks off release pipeline)"
if git rev-parse "$RELEASE_TAG" >/dev/null 2>&1; then
  echo "  tag $RELEASE_TAG already exists locally — skipping"
else
  git tag -a "$RELEASE_TAG" -m "Warehouse14 POS $RELEASE_TAG — first public release.

See CHANGELOG.md for the full delta. Auto-update target for every
installed copy: this is the source of truth latest.json points at."
  ok "tag created"
fi
git push origin "$RELEASE_TAG"
ok "tag pushed → release.yml is now building macOS-arm64, macOS-x64, Windows-x64"

# ── 8. Workflow status follow ───────────────────────────────────────
step "8. Follow the release build (Ctrl+C to detach — it keeps running)"
sleep 4  # give GitHub a moment to register the workflow run
gh run watch --repo "${REPO_OWNER}/${REPO_NAME}" --exit-status || {
  echo
  echo "  Workflow may still be running. Watch live:"
  echo "    https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
}

# ── 9. Done ─────────────────────────────────────────────────────────
step "9. Release published"
echo
echo "  Repo:        https://github.com/${REPO_OWNER}/${REPO_NAME}"
echo "  Releases:    https://github.com/${REPO_OWNER}/${REPO_NAME}/releases"
echo "  Actions:     https://github.com/${REPO_OWNER}/${REPO_NAME}/actions"
echo
echo "Artifacts expected in the GitHub Release (auto-uploaded by tauri-action):"
echo "  • Warehouse14 POS_0.1.0_aarch64.dmg            (macOS Apple Silicon)"
echo "  • Warehouse14 POS_0.1.0_x64.dmg                (macOS Intel)"
echo "  • Warehouse14 POS_0.1.0_x64-setup.exe          (Windows installer)"
echo "  • latest.json                                  (auto-updater manifest)"
echo "  • + matching .sig files for every binary       (minisign signatures)"
echo
echo "Installed copies pick up new tags within an hour automatically."
