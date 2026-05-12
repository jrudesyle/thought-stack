# Build Number System

## Overview
ThoughtStack now has an auto-incrementing build number system that displays in the app's status bar.

## How It Works

### Build Number File
- `build-info.json` at project root tracks the current build
- Contains: `buildNumber`, `version` (from package.json), `timestamp`
- Auto-increments on each build via `scripts/increment-build.js`

### Build Script
- `scripts/increment-build.js` runs before builds (`prebuild` and `preelectron:build` hooks)
- Increments build number
- Copies to `src/client/public/build-info.json` for client access
- Copies to `dist/client/build-info.json` during build

### Display
- Shown in the bottom-right of the status bar
- Format: "v1.0.0 (build 3)"
- Subtle styling (smaller, lower opacity)
- Loads automatically on app start via `getBuildInfo()` API

## Files Modified

### New Files
- `build-info.json` - root build info (gitignored)
- `scripts/increment-build.js` - increment script
- `src/client/build-info.ts` - client API for loading build info
- `src/client/public/build-info.json` - served to client (gitignored)

### Modified Files
- `package.json` - added `prebuild` and `preelectron:build` hooks
- `src/client/App.tsx` - loads and displays build info
- `src/client/styles.css` - styling for `.status-bar-build`
- `.gitignore` - ignore generated build-info.json files

## Usage

### Check Current Build
```bash
cat build-info.json
```

### Manual Increment
```bash
node scripts/increment-build.js
```

### Build Process
Build number automatically increments on:
- `npm run build`
- `npm run electron:build`

The build info displays in the app footer as: **v1.0.0 (build 3)**

## Version Bumping
To bump the version:
1. Update `version` in `package.json`
2. Next build will show the new version with incremented build number
