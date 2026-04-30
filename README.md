# ThoughtStack

A native desktop note-taking app built with Electron. Notes are stored as Markdown flat files in a local vault directory — human-readable, portable, and ready for cloud drive sync.

## Features

- Rich text editing with TipTap (bold, italic, headings, lists, checklists, tables, code blocks, images, links)
- **Markdown flat file storage** — each note is a `.md` file with YAML frontmatter
- **Vault-based organization** — notebooks are folders, stacks are parent folders
- **Cloud drive sync** — place your vault on Google Drive, iCloud, Dropbox, or OneDrive
- Tag-based cross-notebook categorization with auto-complete
- Full-text search powered by a local SQLite FTS5 index (rebuilt from files, not the source of truth)
- Trash with soft-delete and restore
- Light and dark themes (follows OS preference by default)
- JSON export/import for data portability
- Native desktop app for macOS, Windows, and Linux

## Prerequisites

- **Node.js** 22.5 or later
- **npm** 9 or later

## Quick Start

```bash
# Install dependencies
npm install

# Start the Electron app in development mode
npm run electron:dev
```

This builds the Electron main process and launches the app. The frontend uses Vite's dev server for hot reload.

## Development

ThoughtStack uses a two-process architecture:

1. **Vite dev server** — serves the React frontend with hot module replacement
2. **Electron main process** — handles file I/O, search indexing, and native features

### Two-terminal workflow

```bash
# Terminal 1: Start the Vite dev server for the frontend
npm run dev

# Terminal 2: Build and launch Electron (loads from Vite dev server)
npm run electron:dev
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the Vite dev server for the frontend |
| `npm run build` | Build the frontend and Electron main process |
| `npm run electron:dev` | Build Electron and launch the app |
| `npm run electron:build` | Package the app for distribution |
| `npm run electron:preview` | Build everything and preview the production app |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:property` | Run property-based tests only |
| `npm run test:integration` | Run integration tests only |

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:property
npm run test:integration
```

## Vault Location

ThoughtStack stores notes in a **vault** — a directory you choose on first launch. The vault structure looks like this:

```
~/ThoughtStack/                    # Vault root (you pick this)
├── .thoughtstack/                 # App metadata (hidden)
│   ├── config.json               # Vault config
│   └── cache.db                  # Search index (local only, rebuildable)
├── Meeting Notes/                 # Notebook = folder
│   ├── Standup 2026-04-30.md     # Note = Markdown file
│   └── .images/                  # Images for this notebook
│       └── abc123.png
├── Personal/                      # Another notebook
│   └── Ideas.md
├── Work/                          # Notebook stack = parent folder
│   ├── Project Alpha/             # Notebook inside stack
│   │   └── Requirements.md
│   └── Project Beta/
│       └── Kickoff Notes.md
└── .trash/                        # Soft-deleted notes
    └── .trash-meta.json
```

### Cloud Drive Sync

Place your vault inside a cloud-synced folder to sync notes across devices:

- **Google Drive**: `~/Library/CloudStorage/GoogleDrive-.../My Drive/ThoughtStack/`
- **iCloud**: `~/Library/Mobile Documents/com~apple~CloudDocs/ThoughtStack/`
- **Dropbox**: `~/Dropbox/ThoughtStack/`
- **OneDrive**: `~/Library/CloudStorage/OneDrive-Personal/ThoughtStack/`

The search index (`cache.db`) is excluded from sync — each device rebuilds its own. If the cloud provider creates conflict files (e.g., "Note (conflict).md"), the app detects and surfaces them for resolution.

## Data Export / Import

- Open Settings (⚙) and use the **Export Data** / **Import Data** buttons
- Export produces a JSON file with all notebooks, notes (Markdown content + frontmatter), tags, and images (base64-encoded)
- Import accepts the same JSON format; malformed entries are skipped with error reports

## Plugins

Plugin support is planned for a future release. The `plugins/` directory is reserved for theme plugins, toolbar actions, sidebar sections, and lifecycle hooks.

## License

Private — all rights reserved.
