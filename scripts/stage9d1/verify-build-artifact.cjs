const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, '.next');
const requiredFiles = [
  'BUILD_ID',
  'build-manifest.json',
  'prerender-manifest.json',
  'routes-manifest.json',
  'required-server-files.json',
];

let failed = 0;
for (const file of requiredFiles) {
  const target = path.join(dist, file);
  const passed = fs.existsSync(target) && fs.statSync(target).size > 0;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${file}`);
  if (!passed) failed += 1;
}

const buildIdPath = path.join(dist, 'BUILD_ID');
if (fs.existsSync(buildIdPath)) {
  const buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
  const passed = /^[A-Za-z0-9_-]+$/.test(buildId);
  console.log(`${passed ? 'PASS' : 'FAIL'} BUILD_ID possui formato seguro`);
  if (!passed) failed += 1;
}

const total = requiredFiles.length + 1;
console.log(`RESULT passed=${total - failed} failed=${failed} total=${total}`);
if (failed) process.exit(1);
