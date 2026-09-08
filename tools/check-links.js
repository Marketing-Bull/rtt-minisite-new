#!/usr/bin/env node
/*
 * Verifies every local reference in the generated pages resolves to a file in
 * public/. Run after `npm run build`; exits non-zero on the first missing file.
 *
 *   npm run check
 */
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(pub).filter(f => f.endsWith('.html'));
let missing = 0, checked = 0;

for (const page of pages) {
  const html = fs.readFileSync(path.join(pub, page), 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|srcset|href)="([^"]+)"/g)) refs.add(m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|mailto:|tel:|#)/.test(ref)) continue;
    const rel = ref.replace(/^\.\//, '').replace(/^\//, '').replace(/[?#].*$/, '');
    checked += 1;
    if (!fs.existsSync(path.join(pub, rel))) {
      console.error(`✗ ${page}: missing ${ref}`);
      missing += 1;
    }
  }
}
console.log(`${checked} local references checked across ${pages.length} pages, ${missing} missing`);
process.exit(missing ? 1 : 0);
