# CI workflow files (install manually)

These two files belong in `.github/workflows/`, but the automation token used to
push lacks the GitHub **`workflow`** scope, so they couldn't be pushed there
directly. Install them yourself (one-time):

```bash
cp infrastructure/ci/deploy-images.yml .github/workflows/deploy-images.yml
cp infrastructure/ci/release.yml       .github/workflows/release.yml   # adds Linux to the matrix
git add .github/workflows/ && git commit -m "ci: GHCR images + 4-platform release"
git push   # use a token/SSH key with the `workflow` scope, or commit via the GitHub web UI
```

- **deploy-images.yml** — builds the api/worker/migrate images for linux/arm64
  and pushes them to GHCR on every push to `main` / `v*` tag.
- **release.yml** — the desktop release pipeline; this copy adds **Linux** to the
  matrix (macOS arm64 + macOS x64 + Windows + Linux), all minisign-signed,
  publishing `latest.json` for the in-app auto-updater.

Required repo secrets: `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) for the
desktop updater signing. GHCR uses the built-in `GITHUB_TOKEN`.
