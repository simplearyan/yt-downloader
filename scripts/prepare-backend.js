/**
 * Stage the Express backend into `backend/` so Tauri can bundle it as a
 * resource. The packaged app spawns `node backend/server.js` (stopgap until
 * the Rust backend lands). Skips re-installing if nothing changed.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const backend = path.join(root, 'src-tauri', 'backend');
const serverSrc = path.join(root, 'server.js');
const serverDst = path.join(backend, 'server.js');

const upToDate =
  fs.existsSync(serverDst) &&
  fs.existsSync(path.join(backend, 'node_modules', 'express')) &&
  fs.readFileSync(serverSrc, 'utf8') === fs.readFileSync(serverDst, 'utf8');

if (upToDate) {
  console.log('backend/ already up to date — skipping');
  process.exit(0);
}

fs.rmSync(backend, { recursive: true, force: true });
fs.mkdirSync(backend, { recursive: true });
fs.copyFileSync(serverSrc, serverDst);
// npm needs a package.json here or it walks up to the project root
fs.writeFileSync(
  path.join(backend, 'package.json'),
  JSON.stringify({ name: 'ytdl-backend', private: true, version: '0.1.0' }, null, 2)
);
console.log('Installing express into backend/ …');
execSync('npm install --omit=dev --no-audit --no-fund express', {
  cwd: backend,
  stdio: 'inherit',
});
console.log('Backend staged at backend/');
