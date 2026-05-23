/**
 * Bump package.json version before electron-builder packaging.
 * Usage: node scripts/bump-version.js
 * Env:   BUMP=patch|minor|major (default: patch)
 */
const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const bump = (process.env.BUMP || 'patch').toLowerCase();

const match = String(pkg.version || '0.1.0').match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error(`Invalid version "${pkg.version}" — expected semver major.minor.patch`);
  process.exit(1);
}

let major = Number(match[1]);
let minor = Number(match[2]);
let patch = Number(match[3]);

if (bump === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bump === 'minor') {
  minor += 1;
  patch = 0;
} else if (bump === 'patch') {
  patch += 1;
} else {
  console.error(`Unknown BUMP="${bump}". Use patch, minor, or major.`);
  process.exit(1);
}

const next = `${major}.${minor}.${patch}`;
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[bump-version] ${match[0]} → ${next} (${bump})`);
