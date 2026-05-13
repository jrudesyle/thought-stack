#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildInfoPath = path.join(__dirname, '../build-info.json');
const packagePath = path.join(__dirname, '../package.json');
const publicPath = path.join(__dirname, '../src/client/public/build-info.json');

// Read package.json for version
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

// Build info with timestamp only
const buildInfo = {
  version: pkg.version,
  timestamp: new Date().toISOString()
};

const content = JSON.stringify(buildInfo, null, 2) + '\n';

// Write build info to root
fs.writeFileSync(buildInfoPath, content);

// Copy to public folder for client access
fs.writeFileSync(publicPath, content);

console.log(`Build v${buildInfo.version} - ${buildInfo.timestamp}`);
