# OpenCode Agent Instructions

## Notify Jeff on milestones

```bash
curl -s -H "Title: 🤖 OpenCode" -H "Priority: default" -H "Tags: robot,computer" \
  -d "YOUR MESSAGE HERE" https://ntfy.sh/rudesyle-opencode
```

## Architecture

**Dual-build target:** Electron (`electron/`) + Tauri (`src-tauri/`). Conditional imports in `src/client/api/index.ts` auto-detect runtime: Tauri → Electron → FSA → OPFS → HTTP.

**Workspaces:**
- `src/client/` — React 19 + Vite 6 + TipTap 2 (npm workspace `@thoughtstack/client`)
- `electron/` — Electron main/preload (TypeScript, Node16 module resolution, CommonJS output)
- `src-tauri/` — Tauri 2 Rust backend (rusqlite, serde, gray_matter, walkdir)

**Module resolution quirks:**
- Root and client: `"module": "ESNext"`, `"moduleResolution": "bundler"`
- Electron: `"module": "Node16"` — must emit CommonJS. `build:electron` injects `{"type":"commonjs"}` into `dist/electron/package.json` after tsc. Source `electron/package.json` already contains `{"type":"commonjs"}`.
- Server (`src/server/`): also CommonJS

**HTTP server mode:** `npm run server:dev` starts a Node.js HTTP server on port 3000 (no framework, built-in modules only). Reuses Electron vault/search layer. Vite dev server proxies `/api` → `localhost:3000`.

## Development Commands

```bash
# Electron (two-terminal)
npm run dev              # Terminal 1: Vite dev server (port 5173, strict)
npm run electron:dev     # Terminal 2: build Electron + launch from Vite
npm run electron:build   # Package for distribution (DMG/NSIS/AppImage)
npm run electron:preview # Full build + launch production app

# Tauri
npm run tauri:dev        # Build frontend + launch Tauri
npm run tauri:build      # Build for distribution
npm run tauri:android:dev # x86_64 debug APK + launch on device/emulator

# HTTP server (browser-only mode)
npm run server:dev       # Start on port 3000

# Android APK (ARM64 for physical devices)
npx tauri android build --debug --apk --target aarch64
# → src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk

adb reverse tcp:5173 tcp:5173   # required: routes device → host Vite server

# Headless emulator
~/Android/Sdk/emulator/emulator -avd thoughtstack_dev -no-window -no-audio \
  -no-boot-anim -no-snapshot-save &
# AVDs: thoughtstack_dev, test_avd (x86_64 only — no ARM64 emulator on this host)
```

## Testing

```bash
npm test                 # vitest run (all 4 projects)
npm run test:unit        # tests/unit/
npm run test:property    # tests/property/ (fast-check, 30s timeout)
npm run test:integration # tests/integration/ (10s timeout)
# Electron tests: electron/__tests__/
```

Vitest uses `pool: 'forks'` for native addon (better-sqlite3) compatibility. Playwright config exists but not wired into CI.

## Key Conventions

- **Vault = flat Markdown files** with YAML frontmatter under a user-chosen directory. Notebooks = folders, stacks = parent folders.
- **Search index:** `.thoughtstack/cache.db` (SQLite FTS5, local only, rebuildable). Electron manages via IPC; Tauri via Rust.
- **IPC handlers:** `electron/ipc/*.ipc.ts` — notes, notebooks, tags, search, system, images, conflicts
- **`vault://` protocol** registered in Electron main for serving vault images
- **`.thoughtstackignore`** — gitignore-style file to exclude folders from listing/search (no glob support yet)
- **Commit style:** Concise imperative. `feat:`/`fix:` prefix only occasionally. No issue refs or emoji.
- **No formatter (Prettier) or linter (ESLint)** — follow existing style. No typecheck script either.
- **Plugins (`plugins/`):** reserved for future use (currently empty).

## Dependencies

- Frontend: React 19, TipTap 2, `@tauri-apps/api` 2, `@vitejs/plugin-react`
- Electron: better-sqlite3, gray-matter
- Tauri: rusqlite, serde, serde_yaml, uuid, chrono, walkdir, gray_matter, regex
- Dev: TypeScript 6.0, Vitest 4, tsx (for scripts), fast-check

## Scripts & Utilities

- `scripts/` — migration tools using `tsx`: `run-migration.mjs`, `migrate-vault.ts`, `import-notion.ts`, `add-cto-prompt.ts`, `seed-ai-prompts.ts`
- `test_fts.mjs` — standalone FTS5 indexing experiment (run with `node test_fts.mjs`)
- `thoughtrepo.service` — systemd unit for self-hosted PWA mode

## Vault Ignore Patterns

Electron: `electron/vault/ignore.ts` (readIgnorePatterns, isIgnored, addIgnorePattern)
Tauri: `src-tauri/src/vault/ignore.rs` (same API)
Applied in notes/notebooks/search/conflicts on both backends.

## Android Gotchas

- Vault picker detects `isAndroid` via user agent; shows path buttons instead of folder picker
- Recommended paths: `/sdcard/Android/data/com.thoughtstack.app/files/ThoughtStack` (always works), `/sdcard/ThoughtStack` (requires MANAGE_EXTERNAL_STORAGE)
- `MainActivity.kt` requests All Files Access on launch — user must tap Allow
- Vault path persisted in `vault_path.txt` (app data dir), reloaded in `lib.rs`
- `tauri android dev` only builds x86_64 if emulator connected. Disconnect emulator or use `--target aarch64` for ARM APK.
- `android-studio-script` requires running Tauri dev session (Gradle can't call it directly)
- Safe area: `index.html` has `viewport-fit=cover`; styles use `height: 100%` (not dvh) for keyboard push; status bar via `env(safe-area-inset-top)`

## Gotchas

- Vite dev server is strict port 5173; Electron loads from `http://localhost:5173` in dev
- `tauri android dev` auto-runs `adb reverse tcp:5173 tcp:5173` but it doesn't persist across sessions
- Tauri & Electron backends share similar IPC surface but different implementation
- `data/` directory reserved for offline database storage (`.gitkeep` only)

## Agent Plugins

**oh-my-opencode-slim** — agent orchestration. Delegation: `@oracle`, `@explorer`, `@librarian`, `@designer`, `@fixer`. Presets: `openai` (active), `opencode-go`.
**opencode-history-search** — search conversation history. Keywords: `"search history for ..."`, fuzzy/regex modes available.
