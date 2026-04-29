# ThoughtRepo

A self-hosted note-taking Progressive Web App (PWA). All data stays on your machine in a local SQLite database — no cloud services, no external data transmission.

## Features

- Rich text editing with TipTap (bold, italic, headings, lists, checklists, tables, code blocks, images, links)
- Notebook and notebook stack organization
- Tag-based cross-notebook categorization with auto-complete
- Full-text search powered by SQLite FTS5
- Trash with soft-delete and restore
- Light and dark themes (follows OS preference by default)
- PWA with offline support via service worker
- Plugin system for themes, toolbar actions, sidebar sections, and lifecycle hooks
- JSON export/import for data portability

## Prerequisites

- **Node.js** 22.5 or later (uses built-in `node:sqlite`)
- **npm** 9 or later

## Quick Start

```bash
# Install dependencies
npm install

# Build the frontend
npx vite build --config src/client/vite.config.ts

# Start the server
node --experimental-strip-types src/server/index.ts
```

The app will be available at `http://localhost:3000` by default.

## Configuration

Edit `config.json` in the project root:

```json
{
  "port": 3000,
  "dbPath": "./data/notes.db",
  "pluginsDir": "./plugins"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `port` | HTTP server port | `3000` |
| `dbPath` | Path to the SQLite database file | `./data/notes.db` |
| `pluginsDir` | Directory to scan for plugins | `./plugins` |

The database file and `data/` directory are created automatically on first run.

## Development

```bash
# Start the backend server
node --experimental-strip-types src/server/index.ts

# In another terminal, start the Vite dev server with API proxy
npx vite --config src/client/vite.config.ts
```

The Vite dev server proxies `/api` requests to the backend on port 3000.

### Running Tests

```bash
# Run all tests
npx vitest --run

# Run tests in watch mode
npx vitest
```

## Deployment on Linux (systemd)

A systemd service file is provided at the project root (`thoughtrepo.service`).

### Setup

1. Copy the project to your desired location (e.g., `/opt/thoughtrepo`):

   ```bash
   sudo mkdir -p /opt/thoughtrepo
   sudo cp -r . /opt/thoughtrepo/
   ```

2. Create a dedicated user:

   ```bash
   sudo useradd -r -s /usr/sbin/nologin notes
   sudo chown -R notes:notes /opt/thoughtrepo
   ```

3. Install dependencies and build:

   ```bash
   cd /opt/thoughtrepo
   sudo -u notes npm install --production
   sudo -u notes npx vite build --config src/client/vite.config.ts
   ```

4. Install the systemd service:

   ```bash
   sudo cp thoughtrepo.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

5. Start and enable the service:

   ```bash
   sudo systemctl start thoughtrepo
   sudo systemctl enable thoughtrepo
   ```

6. Check status and logs:

   ```bash
   sudo systemctl status thoughtrepo
   sudo journalctl -u thoughtrepo -f
   ```

### Customizing the Service

Edit `/etc/systemd/system/thoughtrepo.service` if you need to change:

- `WorkingDirectory` — path to the app installation
- `ReadWritePaths` — data and plugin directories
- `Environment` — environment variables

After editing, reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart thoughtrepo
```

## Plugins

Place plugin directories in the `plugins/` folder. Each plugin needs a `plugin.json` manifest:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A sample plugin",
  "extensionPoints": [
    { "type": "theme", "entrypoint": "./theme.css" }
  ]
}
```

Supported extension point types: `theme`, `editor-toolbar-action`, `sidebar-section`, `note-lifecycle-hook`.

Manage plugins from the Settings panel in the app (⚙ button in the toolbar).

## Data Export / Import

- Open Settings (⚙) and use the **Export Data** / **Import Data** buttons
- Export produces a JSON file with all notebooks, notes, tags, and associations
- Import accepts the same JSON format; malformed entries are skipped with error reports

## License

Private — all rights reserved.
