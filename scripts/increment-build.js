#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildInfoPath = path.join(__dirname, '../build-info.json');
const packagePath = path.join(__dirname, '../package.json');
const publicPath = path.join(__dirname, '../src/client/public/build-info.json');

// Read current build info
let buildInfo = { buildNumber: 0, version: '1.0.0', timestamp: '' };
if (fs.existsSync(buildInfoPath)) {
  buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
}

// Read package.json for version
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

// Increment build number
buildInfo.buildNumber += 1;
buildInfo.version = pkg.version;
buildInfo.timestamp = new Date().toISOString();

const content = JSON.stringify(buildInfo, null, 2) + '\n';

// Write updated build info to root
fs.writeFileSync(buildInfoPath, content);

// Copy to public folder for client access
fs.writeFileSync(publicPath, content);

console.log(`Build #${buildInfo.buildNumber} (v${buildInfo.version}) - ${buildInfo.timestamp}`);
