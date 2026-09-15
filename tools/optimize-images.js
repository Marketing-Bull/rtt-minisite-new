#!/usr/bin/env node
/*
 * Offline image optimizer.
 *
 * Generates AVIF + WebP variants for every raster image under
 * public/assets/uploads, and converts the one animated GIF (the Warmies upsell
 * thumbnail) into a small animated WebP plus a still JPG fallback, then deletes
 * the multi-megabyte original.
 *
 * Two tiers are emitted for the first two gallery stills of each product — the
 * ones a buyer actually looks at: the light `name.avif`/`name.webp` pair the
 * markup ships for a fast first paint, and a sharper `name-hq.avif`/
 * `name-hq.webp` pair the page swaps in after `load`. See the
 * progressive-upgrade block in generate.js.
 *
 * This is a BUILD-TIME tool only — it depends on `sharp`. The runtime page
 * generator (generate.js) stays dependency-free; it just references whichever
 * variant files exist on disk. Re-runnable / idempotent: it skips outputs that
 * are already newer than their source.
 *
 *   npm run optimize     (== node tools/optimize-images.js)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', 'public', 'assets', 'uploads');
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'product-data.json'), 'utf8'));
const MAX_W = 1200;     // cap for static raster variants (mobile-first)
const GIF_MAX_W = 360;  // cap for the animated thumbnail
const AVIF_Q = 50;
const WEBP_Q = 80;
const GIF_WEBP_Q = 70;

// Second, sharper tier for the gallery stills a buyer actually dwells on. The
// light tier is tuned for first paint and is what the LCP preload points at;
// these are heavier and are fetched only in idle time after `load`, so they
// never compete with anything on the critical path.
const HQ_MAX_W = 2000;
const HQ_AVIF_Q = 72;
const HQ_WEBP_Q = 88;
// Only the first two stills, not the whole gallery: past the second slide the
// extra bytes buy detail on images most buyers never reach. The animation is
// excluded too — it is 119 frames, so every extra pixel of width is paid 119
// times, and it is a loop rather than something anyone inspects.
const HQ_SLIDES = 2;

// Mirrors the gallery generate.js builds ([hero, ...animation, ...tiles]) minus
// the animation, so we never encode a tier for a slide the page never renders.
function largeDisplayImages() {
  const set = new Set();
  const toDisk = u => {
    const m = String(u).match(/\/wp-content\/uploads(\/.*)$/) || String(u).match(/\/assets\/uploads(\/.*)$/);
    return path.join(ROOT, (m ? m[1] : u).replace(/^\//, ''));
  };
  for (const product of DATA.products || []) {
    const tiles = (product.galleryImages || []).filter(g => g !== product.heroImage);
    [product.heroImage].concat(tiles)
      .filter(Boolean)
      .slice(0, HQ_SLIDES)
      .forEach(u => set.add(toDisk(u)));
  }
  return set;
}
const HQ_SET = largeDisplayImages();

sharp.cache(false);
sharp.concurrency(1);

const relRoot = p => path.relative(path.join(__dirname, '..'), p);
const RASTER = new Set(['.jpg', '.jpeg', '.png']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function upToDate(src, dest) {
  return fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs;
}

function hasSiblingRaster(file) {
  const base = file.slice(0, -path.extname(file).length);
  return ['.jpg', '.jpeg', '.png', '.gif'].some(e => fs.existsSync(base + e));
}

let made = 0, skipped = 0, removed = 0;

async function staticVariants(src) {
  const ext = path.extname(src).toLowerCase();
  const base = src.slice(0, -ext.length);
  const avif = base + '.avif';
  const webp = base + '.webp';
  const pipe = () => sharp(src).resize({ width: MAX_W, withoutEnlargement: true });

  if (!upToDate(src, avif)) {
    await pipe().avif({ quality: AVIF_Q, effort: 4 }).toFile(avif);
    console.log(`  + ${relRoot(avif)}`); made++;
  } else skipped++;

  // Don't emit a .webp next to an original .webp (it IS the webp fallback).
  if (ext !== '.webp') {
    if (!upToDate(src, webp)) {
      await pipe().webp({ quality: WEBP_Q, effort: 4 }).toFile(webp);
      console.log(`  + ${relRoot(webp)}`); made++;
    } else skipped++;
  }

  if (!HQ_SET.has(src)) return;

  // HQ tier. No JPEG/PNG counterpart: the untouched original already IS the
  // high-quality fallback for a browser with neither AVIF nor WebP.
  const hqAvif = base + '-hq.avif';
  const hqWebp = base + '-hq.webp';
  const hqPipe = () => sharp(src).resize({ width: HQ_MAX_W, withoutEnlargement: true });

  if (!upToDate(src, hqAvif)) {
    await hqPipe().avif({ quality: HQ_AVIF_Q, effort: 4 }).toFile(hqAvif);
    console.log(`  + ${relRoot(hqAvif)} (hq)`); made++;
  } else skipped++;

  if (ext !== '.webp') {
    if (!upToDate(src, hqWebp)) {
      await hqPipe().webp({ quality: HQ_WEBP_Q, effort: 4 }).toFile(hqWebp);
      console.log(`  + ${relRoot(hqWebp)} (hq)`); made++;
    } else skipped++;
  }
}

async function gifVariants(src) {
  const base = src.slice(0, -path.extname(src).length);
  const webp = base + '.webp';
  const still = base + '-still.jpg';

  // Animated WebP (resized) — primary, preserves the animation.
  await sharp(src, { animated: true })
    .resize({ width: GIF_MAX_W, withoutEnlargement: true })
    .webp({ quality: GIF_WEBP_Q, effort: 4 })
    .toFile(webp);
  console.log(`  + ${relRoot(webp)} (animated)`); made++;

  // Still first-frame JPG — fallback for the <picture>'s <img>.
  await sharp(src) // first page only
    .resize({ width: GIF_MAX_W, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(still);
  console.log(`  + ${relRoot(still)} (still fallback)`); made++;

  // Drop the heavy original.
  fs.unlinkSync(src);
  console.log(`  - ${relRoot(src)} (removed original)`); removed++;
}

(async () => {
  if (!fs.existsSync(ROOT)) {
    console.error(`No image dir at ${ROOT} — run tools/fetch-images.js first.`);
    process.exit(1);
  }
  console.log('Optimizing images under', relRoot(ROOT), '\n');

  for (const file of walk(ROOT)) {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file);

    if (name.endsWith('-still.jpg')) continue;          // generated poster
    if (/-hq\.[a-z0-9]+$/i.test(name)) continue;        // generated HQ variant
    if (RASTER.has(ext)) {
      await staticVariants(file);
    } else if (ext === '.gif') {
      if (fs.existsSync(file)) await gifVariants(file);
    } else if (ext === '.webp') {
      // Original .webp (no raster sibling, not animated) → just add an .avif.
      if (hasSiblingRaster(file)) continue;             // generated from a raster
      const meta = await sharp(file).metadata();
      if ((meta.pages || 1) > 1) continue;              // animated (gif-derived) → leave alone
      await staticVariants(file);
    }
    // .avif and anything else: ignore
  }

  console.log(`\nDone. ${made} written, ${skipped} up-to-date, ${removed} original(s) removed.`);
})().catch(e => { console.error(e); process.exit(1); });
