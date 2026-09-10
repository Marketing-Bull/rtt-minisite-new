#!/usr/bin/env node
/*
 * Static-site generator for the Rock The Treatment minisite in the "1b"
 * (High-Conversion) design.
 *
 * Reads product-data.json and writes one page per product plus a hub page to
 * public/. Dependency-free on purpose: `node generate.js` is the whole build.
 *
 * Every fact on a page (price, product ID, rating, review count, items, FAQs,
 * add-ons, related products) comes from product-data.json. The 1b mockup
 * carried a few conversion elements that need evidence before they can be
 * shown to real shoppers — a compare-at price, a same-day-shipping countdown,
 * and a low-stock notice. Those render only when a product opts in through
 * its `mobileUi` block (see README "Opt-in promo elements"); otherwise the
 * design falls back to verifiable copy.
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'product-data.json'), 'utf8'));
const outDir = path.join(__dirname, 'public');
fs.mkdirSync(outDir, { recursive: true });

// Pages mirror the www product pages; canonical points at www, so keep them
// out of the index by default.
const ALLOW_INDEXING = false;

// Google Tag Manager container for the minisite. The pages already push a full
// event set (view_item, add_to_cart, add_to_cart_sticky, product_gallery_view,
// faq_open, rating_click, celebration_bell, addon_click) into window.dataLayer —
// but without a container nothing consumes them, so none of it reaches GA4.
// Set RTT_GTM_ID (or hardcode below) to emit the container.
//
// Cart/checkout lives on a different host (www.rockthetreatment.com), so the GA4
// config tag in this container MUST enable cross-domain measurement for both
// m.rockthetreatment.com and www.rockthetreatment.com — otherwise the session
// splits at the exact moment of conversion and add_to_cart never ties to revenue.
const GTM_ID = process.env.RTT_GTM_ID || '';

const { wwwBase, mBase, imageBase, logo, itemImages, upsellProducts, faqs, radiationFaqs, products } = data;

// /cart/ adds the item AND shows the cart; the site root would drop buyers on
// the homepage mid-funnel.
function cartUrlFor(productId, quantity) {
  return `${wwwBase}/cart/?add-to-cart=${productId}&quantity=${quantity == null ? 1 : quantity}`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtRating(value) {
  const s = (Math.round(value * 100) / 100).toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

function fmtInt(n) {
  return Number(n).toLocaleString('en-US');
}

function parsePrice(p) {
  return parseFloat(String(p).replace(/[^0-9.]/g, ''));
}

function fmtPrice(n) {
  return '$' + n.toFixed(2);
}

function img(relPath) {
  if (/^https?:\/\//.test(relPath) || relPath.startsWith('data:')) return relPath;
  return imageBase + relPath;
}

function itemImg(name) {
  if (itemImages[name] && assetExists(img(itemImages[name]))) return img(itemImages[name]);
  const svg = `<svg width="70" height="70" xmlns="http://www.w3.org/2000/svg"><rect width="70" height="70" fill="#f0ece8"/><text x="35" y="42" text-anchor="middle" font-size="12" fill="#999" font-family="sans-serif">${escHtml(name.substring(0, 10))}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ---- Responsive images (AVIF/WebP via <picture>) ---------------------------
// Variants come from tools/optimize-images.js; only variants that exist on disk
// are referenced, so a missing variant degrades to the original.
const LOCAL_PREFIX = '/assets/uploads/';

function diskPath(url) {
  return path.join(outDir, url.replace(/^\//, ''));
}

function variants(url) {
  if (!url || !url.startsWith(LOCAL_PREFIX)) return null;
  const ext = path.extname(url).toLowerCase();
  const base = url.slice(0, -ext.length);
  const fallbackU = ext === '.gif' ? base + '-still.jpg' : url;
  const has = u => fs.existsSync(diskPath(u));
  return {
    avif: has(base + '.avif') ? base + '.avif' : '',
    webp: (ext !== '.webp' && has(base + '.webp')) ? base + '.webp' : '',
    fallback: has(fallbackU) ? fallbackU : url,
  };
}

function imgTag(src, o = {}) {
  const a = [];
  if (o.id) a.push(`id="${o.id}"`);
  if (o.cls) a.push(`class="${o.cls}"`);
  a.push(`src="${src}"`, `alt="${escHtml(o.alt || '')}"`);
  if (o.width) a.push(`width="${o.width}"`);
  if (o.height) a.push(`height="${o.height}"`);
  if (o.priority) a.push('fetchpriority="high"');
  if (o.lazy !== false) a.push('loading="lazy"');
  a.push('decoding="async"');
  return `<img ${a.join(' ')}>`;
}

function picture(url, o = {}) {
  const v = variants(url);
  if (!v) return imgTag(url, o);
  const sources = [];
  if (v.avif) sources.push(`<source ${o.avifId ? `id="${o.avifId}" ` : ''}type="image/avif" srcset="${v.avif}">`);
  if (v.webp) sources.push(`<source ${o.webpId ? `id="${o.webpId}" ` : ''}type="image/webp" srcset="${v.webp}">`);
  if (!sources.length) return imgTag(v.fallback, o);
  return `<picture>${sources.join('')}${imgTag(v.fallback, o)}</picture>`;
}

// Local page for one of our products, otherwise the live store.
// True when a local asset (or its optimized variant) exists in public/.
function assetExists(url) {
  const v = variants(url);
  return !url.startsWith(LOCAL_PREFIX) || fs.existsSync(diskPath(v.fallback));
}

function productHref(url) {
  const slug = url.replace(/^\//, '').replace(/\/$/, '');
  return products.some(p => p.slug === slug) ? `./${slug}.html` : `${wwwBase}${url}`;
}

function currentPrice(slugOrProduct) {
  const p = typeof slugOrProduct === 'string' ? products.find(x => x.slug === slugOrProduct) : slugOrProduct;
  if (!p) return null;
  return (p.mobileUi && p.mobileUi.displayPrice) || p.price;
}

// Pronoun for copy like "What she'll open". Products can override via
// mobileUi.pronoun; otherwise inferred from the slug, neutral by default.
function pronounsFor(product) {
  const ui = product.mobileUi || {};
  const key = ui.pronoun || (product.slug.startsWith('womens') ? 'she' : product.slug.startsWith('mens') ? 'he' : 'they');
  return {
    she: { subj: 'she', obj: 'her', poss: 'her' },
    he: { subj: 'he', obj: 'him', poss: 'his' },
    they: { subj: 'they', obj: 'them', poss: 'their' },
  }[key];
}

const FAQ_ANSWERS = {
  'What gifts to avoid?': 'Avoid flowers (infection risk), strong perfumes/scents (nausea triggers), and sugary foods. Our care packages are specifically curated to include only safe, doctor-recommended items.',
  'What are the most common side effects of chemo?': 'Common side effects include nausea, dry mouth, fatigue, skin sensitivity, hair loss, and cognitive fog ("chemo brain"). Our packages include items that address each of these.',
  'What items help with the side effects of chemo?': 'Lip balm and lotion for dry skin, peppermint for nausea, protein snacks for energy, puzzles for mental stimulation, cozy socks for cold extremities, and eye pillows for headaches.',
  'Are there any restrictions on gifts chemo patients can receive?': 'Avoid strong scents, raw foods, and items that could harbor bacteria. All items in our packages are safe, sealed, and designed specifically for chemo patients.',
  'What about dietary restriction substitutions?': 'We offer substitutions for oral cancer, sugar-free, vegan, dairy-free, nut-free, gluten-free, kosher, and organic preferences. Note your needs during checkout.',
  'What gifts to avoid for radiation patients?': 'Avoid anything with strong chemicals near treatment areas. Our radiation packages include gentle, soothing products specifically chosen for radiation therapy patients.',
  'What are the most common side effects of radiation?': 'Skin irritation, fatigue, nausea, and localized soreness are common. Our packages include premium skincare and comfort items designed for these specific effects.',
  'What items help with the side effects of radiation?': 'Gentle skin lotions and serums for irritation, peppermint for nausea, protein snacks for energy, and relaxation items for comfort during recovery.',
  'Are there any restrictions on gifts radiation patients can receive?': 'Avoid harsh skincare products near treatment areas. All items in our radiation package are gentle, soothing, and safe for use during therapy.',
};

// Shipping/fulfillment FAQs shared by every page (facts from the live store).
const SHIPPING_FAQS = [
  { q: 'When will it ship?', a: 'Orders are processed and shipped from New York in 1–2 business days. Delivery time varies by the carrier and destination.' },
  { q: 'How much is shipping?', a: 'Orders over $200 ship free. Shipping on smaller orders depends on the delivery address and is calculated at checkout.' },
  { q: 'Can I include a personal gift note?', a: 'Yes. A personal gift note is free and can be entered during checkout on RockTheTreatment.com.' },
  { q: 'Is the Celebration Bell included?', a: 'The Celebration Bell is a separate end-of-treatment gift and must be ordered separately.' },
];

// Popular add-ons that complement every package (Stacy's whiteboard list:
// Rock, Nausea Wrist Band, Tote, RTT Wristband, Hat, Warmies). These replace
// the mockup's "other size" suggestions. Override per product via mobileUi.addOns.
const DEFAULT_ADD_ONS = [
  'Cozy Companion™ Blanket',
  'YOU ROCK! Worry Stone',
  'Anti-Nausea Wristband',
  'Reusable Folding Tote',
  '#ROCKtheTREATMENT Wristband',
  'Knit Beanie',
  'Warmies® Plush Animal',
  'Warmies® + YOU ROCK! Stone',
];

const gtmHead = GTM_ID ? `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');</script>\n` : '';
const gtmBody = GTM_ID ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>\n` : '';

const FONTS = 'https://fonts.googleapis.com/css2?family=Catamaran:wght@400;500;600;700;800&display=swap';
const FAVICON = "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%20100%20100%27%3E%3Crect%20width=%27100%27%20height=%27100%27%20rx=%2720%27%20fill=%27%235ba346%27/%3E%3Ctext%20x=%2750%27%20y=%2764%27%20font-family=%27Georgia,serif%27%20font-size=%2734%27%20font-weight=%27700%27%20text-anchor=%27middle%27%20fill=%27%23fff%27%3ERTT%3C/text%3E%3C/svg%3E";

// ---- Shared CSS (the 1b look, lifted out of inline styles) -----------------
const SHARED_CSS = `
:root{--green:#5ba346;--green-dark:#3f7a2c;--brand-green:#81d742;--grad-a:#65993a;--grad-b:#96f24c;--orange:#ff6319;--orange-dark:#fb4f14;--purple:#701f8e;--header:#606060;--star:#ffb300;--text:#1a1a1a;--muted:#666;--soft:#888;--faint:#999;--border:#eee;--sans:'Catamaran',system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;padding:0;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{font-family:var(--sans);background:#f4f4f4;color:var(--text);scrollbar-width:none;line-height:1.35}
body::-webkit-scrollbar{width:0;height:0}
a{color:var(--green);text-decoration:none}
img{max-width:100%}
picture{display:contents}
button{font-family:inherit}
.wrap{position:relative;max-width:480px;margin:0 auto;background:#fff;min-height:100vh}
.topbar{position:sticky;top:0;z-index:6;background:linear-gradient(90deg,var(--grad-a),var(--grad-b));color:#fff;text-align:center;font-size:12.5px;font-weight:700;letter-spacing:.02em;padding:7px 16px;text-shadow:0 1px 1px rgba(0,0,0,.15)}
.topbar strong{font-variant-numeric:tabular-nums}
.header{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 14px;background:var(--header);color:#fff;font-size:14px;font-weight:700}
.header .logo img{height:40px;width:auto;display:block}
.header .hlink{display:inline-flex;align-items:center;min-height:44px;min-width:44px;color:#fff}
.header .hlink.right{justify-self:end}
.header .hlink svg{width:24px;height:24px}
`;

const PRODUCT_CSS = `
.gallery-main{width:100%;display:block;aspect-ratio:1/1;max-height:42vh;object-fit:cover;background:#f4f4f4}
@media(max-height:700px){.gallery-main{max-height:34vh}.thumb{width:44px;height:44px}.buy{padding-top:4px}}
.rating-row{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#333;padding:8px 20px 0}
.rating-row a{color:inherit;display:inline-flex;align-items:center;gap:8px}
.stars{color:var(--star)}
.rating-row .count{color:var(--faint);font-weight:500}
.thumbs{display:flex;gap:8px;padding:8px 16px 0;overflow-x:auto;scrollbar-width:none}
.thumbs::-webkit-scrollbar{display:none}
.thumb{flex:0 0 auto;width:50px;height:50px;padding:0;border:2px solid #e6e6e6;border-radius:9px;overflow:hidden;background:#fff;cursor:pointer}
.thumb[aria-current="true"]{border-color:var(--green)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.buy{padding:6px 20px 4px}
h1{font-weight:800;font-size:21px;line-height:1.2;color:var(--text);margin:4px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chips span{font-size:11.5px;font-weight:700;color:#3f7a2c;background:#eef6ea;border-radius:999px;padding:4px 9px;line-height:1.2}
.price-row{display:flex;align-items:baseline;gap:10px;margin-top:8px;flex-wrap:wrap}
.price{font-weight:800;font-size:30px;font-variant-numeric:tabular-nums;line-height:1}
.compare{font-size:16px;color:var(--faint);text-decoration:line-through}
.save{font-size:12px;font-weight:700;color:#fff;background:var(--orange);padding:3px 8px;border-radius:6px}
.buy-row{display:flex;align-items:center;gap:10px;margin-top:10px}
.buy-note{display:flex;justify-content:space-between;font-size:11.5px;color:var(--green);font-weight:700;margin-top:8px}
.buy-note .r{color:var(--muted);font-weight:600}
.atc{flex:1;display:flex;align-items:center;justify-content:center;height:54px;background:var(--orange);color:#fff;border-radius:12px;font-weight:800;font-size:16px;letter-spacing:.02em;text-transform:uppercase;box-shadow:0 8px 20px -6px rgba(255,99,25,.7);white-space:nowrap}
.atc:hover{color:#fff;background:var(--orange-dark)}
.stats{display:flex;gap:8px;margin-top:14px}
.stat{flex:1;text-align:center;border:1px solid var(--border);border-radius:12px;padding:10px 6px}
.stat b{display:block;font-weight:800;font-size:15px}
.stat span{display:block;font-size:10.5px;color:var(--soft);margin-top:2px}
.stat svg{width:22px;height:22px;display:block;margin:0 auto 2px;stroke:#333;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
h2{font-weight:800;font-size:16px;color:var(--text);margin:22px 0 10px}
.bell{display:flex;align-items:center;gap:12px;margin-top:14px;padding:10px 12px;border-radius:14px;background:rgba(129,215,66,.13);border:1px solid rgba(129,215,66,.35)}
.bell img{width:56px;height:56px;object-fit:cover;border-radius:10px;flex:0 0 auto;background:#fff}
.bell .t{font-size:13.5px;font-weight:800;color:#2f5f21;line-height:1.25}
.bell .s{font-size:12px;color:#4a6b3f;margin-top:2px;line-height:1.35}
.bell a{display:inline-block;margin-top:4px;font-size:12.5px;font-weight:800;color:var(--green-dark);text-decoration:underline;text-underline-offset:2px}
.rail{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 20px 8px;margin:0 -20px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.rail::-webkit-scrollbar{display:none}
.feat{flex:0 0 150px;scroll-snap-align:start;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff}
.feat img{width:100%;height:110px;object-fit:cover;display:block;background:#fafafa}
.feat .name{font-size:12.5px;font-weight:800;line-height:1.2;padding:8px 9px 0}
.feat .desc{font-size:11.5px;color:var(--muted);line-height:1.35;padding:3px 9px 10px}
.fan{margin:22px -20px 0;padding:18px 20px 20px;background:linear-gradient(135deg,rgba(255,105,0,.10),rgba(129,215,66,.12) 50%,rgba(6,147,227,.10));border-top:1px solid rgba(0,0,0,.05);border-bottom:1px solid rgba(0,0,0,.05)}
.fan h2{margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em;color:var(--orange-dark)}
.fan .sum{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#333;margin-bottom:10px}
.fan .sum .stars{font-size:14px}
.fan .sum .pct{color:var(--muted);font-weight:600}
.fan .rail{padding-bottom:4px}
.quote{flex:0 0 82%;scroll-snap-align:start;background:rgba(255,255,255,.85);border-radius:12px;padding:12px 14px}
.quote .stars{font-size:12px}
.quote p{font-size:13px;line-height:1.45;color:#333;margin:5px 0 0;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.quote .who{font-size:11.5px;color:var(--faint);margin-top:7px;font-weight:700}
.fan .more{display:inline-flex;align-items:center;justify-content:center;margin-top:12px;height:38px;padding:0 16px;border-radius:8px;background:var(--orange);color:#fff;font-size:13px;font-weight:800}
.encore h2{margin-bottom:2px}
.encore .sub{font-size:12.5px;color:var(--muted);margin:0 0 10px}
.addon{flex:0 0 118px;scroll-snap-align:start;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;text-align:center;display:block;color:#333}
.addon img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.addon span{display:block;font-size:11px;font-weight:700;padding:6px 5px 9px;line-height:1.25}
.banner{background:var(--purple);color:#fff;text-align:center;padding:24px 20px;margin-top:22px}
.banner h2{font-weight:800;font-size:22px;line-height:1.2;margin:0;color:#fff}
.banner p{font-size:13px;color:rgba(255,255,255,.85);margin:8px auto 0;max-width:34em;line-height:1.45}
.inside{padding:18px 20px 8px;background-color:#fff;background-image:radial-gradient(rgba(255,99,25,.10) 2px,transparent 2.5px),radial-gradient(rgba(129,215,66,.12) 2px,transparent 2.5px),radial-gradient(rgba(6,147,227,.08) 2px,transparent 2.5px);background-size:34px 34px,34px 34px,34px 34px;background-position:0 0,17px 17px,8px 25px}
.cat-h{display:flex;align-items:center;gap:8px;margin:0 0 4px}
.items + .cat-h{margin-top:14px}
.cat-h i{width:4px;height:18px;background:var(--orange);border-radius:2px;flex:0 0 auto}
.cat-h h2{margin:0}
.items{list-style:none;margin:0;padding:0}
.items li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)}
.items li:last-child{border-bottom:0}
.items img{width:46px;height:46px;object-fit:cover;border-radius:8px;flex:0 0 auto;background:#f3f3f3;border:1px solid #e3e3e3}
.items .name{font-size:13px;font-weight:800;line-height:1.2}
.items .desc{font-size:11.5px;color:var(--muted);line-height:1.35;margin-top:2px}
.faqs{padding:20px 20px 6px;border-top:8px solid #f5f5f5}
.faqs h2{font-size:16px;margin:0 0 4px}
.faq{border-bottom:1px solid var(--border)}
.faq button{display:flex;width:100%;justify-content:space-between;align-items:flex-start;gap:12px;background:none;border:0;padding:14px 0;text-align:left;font-size:13.5px;font-weight:700;color:var(--text);cursor:pointer}
.faq .chev{display:inline-block;transition:transform .3s ease;color:#bbb;flex:0 0 auto}
.faq[data-open="true"] .chev{transform:rotate(180deg)}
.faq .panel{overflow:hidden;max-height:0;transition:max-height .3s ease}
.faq .panel p{font-size:12.5px;line-height:1.5;color:var(--muted);margin:0 0 14px}
.faqs .more{text-align:center;margin:12px 0 8px;font-size:13px;font-weight:700}
.footer{background:#f4f4f2;color:#666;padding:26px 20px;margin-top:18px;border-top:1px solid #e2e2e2}
.footer .brand{font-size:18px;font-weight:800;color:#4a8a38}
.footer div{font-size:12px;margin-top:6px}
.footer .addr{font-size:11px;margin-top:3px;color:#6b6b6b}
.footer nav{display:flex;flex-wrap:wrap;gap:2px 16px;margin-top:10px}
.footer nav a{display:inline-flex;align-items:center;min-height:36px;font-size:12px;font-weight:700}
.footer .legal{font-size:11px;margin-top:12px;padding-top:14px;border-top:1px solid #e0e0e0;color:#6b6b6b}
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:7;max-width:480px;margin:0 auto;background:#fff;border-top:1px solid var(--border);padding:10px 16px calc(12px + env(safe-area-inset-bottom));box-shadow:0 -8px 24px -12px rgba(0,0,0,.25);transform:translateY(110%);transition:transform .25s ease}
.sticky.is-visible{transform:none}
.sticky .row{display:flex;align-items:center;gap:10px}
.sticky .meta{flex:1;min-width:0}
.sticky .meta .t{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticky .meta .p{font-size:15px;font-weight:800}
.sticky .atc{flex:0 0 auto;padding:0 22px;height:48px;font-size:14px}
.sticky-pad{height:0;transition:height .25s ease}
.sticky-pad.is-visible{height:84px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important}}
`;

function headerHtml() {
  return `  <header class="header">
    <a class="hlink" href="./index.html" aria-label="Browse all care packages">Shop</a>
    <a class="logo" href="./index.html" aria-label="Rock The Treatment home">${picture(logo, { alt: 'Rock The Treatment', lazy: false })}</a>
    <a class="hlink right" href="${wwwBase}/cart/" aria-label="View cart"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 4h2l2.3 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 8H6M10 20h.01M18 20h.01"/></svg></a>
  </header>`;
}

function footerHtml() {
  return `  <footer class="footer">
    <div class="brand">Rock The Treatment</div>
    <div>516-690-7009 · <a href="mailto:info@rockthetreatment.com">info@rockthetreatment.com</a></div>
    <div class="addr">325 Marcus Blvd Suite A, Deer Park, NY 11729</div>
    <nav aria-label="Footer">
      <a href="${wwwBase}/shipping-return/">Shipping &amp; Returns</a>
      <a href="${wwwBase}/faqs/">FAQs</a>
      <a href="${wwwBase}/contact/">Contact</a>
      <a href="${wwwBase}/about-us/">About</a>
    </nav>
    <div class="legal">© Rock The Treatment. All rights reserved.</div>
  </footer>`;
}

function reviewCard(r) {
  if (!r) return '';
  const author = r.author || 'Verified Buyer';
  const who = /verified buyer/i.test(author) ? author : `${author} · Verified Buyer`;
  return `    <div class="quote">
      <div class="stars" aria-label="${r.stars} out of 5 stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
      <p>${r.title ? `<strong>${escHtml(r.title)}</strong> ` : ''}${escHtml(r.text)}</p>
      <div class="who">— ${escHtml(who)}${r.date ? ` · ${escHtml(r.date)}` : ''}</div>
    </div>`;
}

// ---- Product page ----------------------------------------------------------
// Layout follows the 1b mockup with the annotated feedback applied: dark gray
// header with a bigger logo, rating under the hero, buy button above the fold,
// stat tiles, a Celebration Bell note, "Packed with Purpose" rail, "Our Fan
// Club" reviews, "Encore" add-on rail, purple brand banner, and a compact item
// list on a polka-dot background. Colors come from rockthetreatment.com/shop.
function generatePage(product) {
  const ui = product.mobileUi || {};
  const pr = pronounsFor(product);
  const isRadiation = product.slug.includes('radiation');
  const heroUrl = img(product.heroImage);
  const heroV = variants(heroUrl);

  const tiles = (product.galleryImages || []).filter(g => g !== product.heroImage);
  const animation = ui.animationImage && assetExists(img(ui.animationImage)) ? [ui.animationImage] : [];
  const galleryImages = [product.heroImage].concat(animation, tiles).map(img);
  const gallery = galleryImages.map(u => {
    const v = variants(u);
    return { a: v ? v.avif : '', w: v ? v.webp : '', f: v ? v.fallback : u };
  });

  const rating = product.rating || 5;
  const price = currentPrice(product);
  const priceNum = parsePrice(price);
  const freeShipping = priceNum >= 200;
  const cartUrl = cartUrlFor(product.id, 1);
  const totalItems = product.categories.reduce((n, c) => n + c.items.length, 0);
  const stickyCart = ui.stickyCart !== false;

  // Opt-in promo elements (see README). All default to off.
  const compareAt = ui.compareAtPrice ? parsePrice(ui.compareAtPrice) : 0;
  const showCompare = compareAt > priceNum;
  const cutoffHour = Number.isFinite(ui.shipCutoffHourEt) ? ui.shipCutoffHourEt : null;
  const stockNote = ui.stockNote || '';

  const featuredIdx = ui.featuredReviewIndex || 0;
  const reviews = product.reviews.slice();
  if (reviews[featuredIdx]) reviews.unshift(reviews.splice(featuredIdx, 1)[0]);
  const breakdown = product.ratingBreakdown; // {5: n, 4: n, ...} from the live review widget
  const fiveStarPct = breakdown && product.reviewCount ? Math.round((breakdown[5] || 0) / product.reviewCount * 100) : null;

  const allItems = product.categories.reduce((a, c) => a.concat(c.items), []);
  const featured = ((ui.featuredItems && ui.featuredItems.length) ? ui.featuredItems : allItems.slice(0, 6)).filter(f => f && f.name);
  const addOnNames = ui.addOns || DEFAULT_ADD_ONS;
  const addOns = addOnNames.map(n => upsellProducts.find(u => u.name === n)).filter(u => u && assetExists(img(u.image)));
  const bell = upsellProducts.find(u => u.name === 'Celebration Gift (Free)');
  const bellUrl = ui.celebrationUrl || `${wwwBase}/bell/`;
  const bellImg = bell && assetExists(img(bell.image)) ? img(bell.image) : '';
  const faqList = (isRadiation ? radiationFaqs : faqs).map(q => ({ q, a: FAQ_ANSWERS[q] || "Contact us for more details — we're happy to help with any questions about our care packages." }));
  const allFaqs = SHIPPING_FAQS.slice(0, 3).concat(faqList, SHIPPING_FAQS.slice(3));
  const chips = product.categories.map(c => c.name.replace(/^For /, ''));

  const topbar = cutoffHour != null
    ? `  <div class="topbar" data-countdown data-cutoff-hour="${cutoffHour}">🚚 Order within <strong data-countdown-value>…</strong> to ship <strong>today</strong></div>`
    : `  <div class="topbar">${freeShipping ? 'Free shipping on this package' : 'Free shipping over $200 · Flat rate shipping from $4.99'}</div>`;

  const priceRow = `      <div class="price-row">
        <span class="price">${escHtml(price)}</span>${showCompare ? `
        <span class="compare">${escHtml(fmtPrice(compareAt))}</span>
        <span class="save">SAVE ${escHtml(fmtPrice(compareAt - priceNum).replace('.00', ''))}</span>` : ''}
      </div>`;

  const buyRow = `      <div class="buy-row" id="buyRow">
        <a class="atc js-cart-btn" href="${cartUrl}" data-track="add_to_cart">Add to Cart · ${escHtml(price)}</a>
      </div>
      <div class="buy-note"><span>🔒 Secure checkout</span><span class="r">${stockNote ? escHtml(stockNote) : 'Free gift note at checkout'}</span></div>`;

  const truck = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h10v9H3z"/><path d="M13 10.5h4l4 3.5v2.5h-8z"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="17" cy="18.5" r="1.6"/></svg>';
  const stats = `      <div class="stats">
        <div class="stat"><b>${totalItems}</b><span>curated items</span></div>
        <div class="stat"><b>${fmtRating(rating)}★</b><span>avg rating</span></div>
        <div class="stat">${truck}<span>ships in 1–2 days</span></div>
      </div>`;

  // The Celebration Bell is a separate end-of-treatment gift, never included.
  const bellHtml = `      <div class="bell">${bellImg ? `
        ${picture(bellImg, { alt: 'Celebration Bell' })}` : ''}
        <div><div class="t">Supporting Treatment. Celebrating Triumphs.</div><div class="s">When treatment ends, mark the moment with the Celebration Bell, sold separately.</div><a href="${bellUrl}" data-track="celebration_bell">See the Celebration Bell →</a></div>
      </div>`;

  const packedHtml = featured.length ? `      <h2>Packed with Purpose</h2>
      <div class="rail" aria-label="A few of the comforts inside, swipe to see more">
${featured.map(f => `        <div class="feat">${picture(itemImg(f.name), { alt: '' })}<div class="name">${escHtml(f.name)}</div>${f.desc ? `<div class="desc">${escHtml(f.desc)}</div>` : ''}</div>`).join('\n')}
      </div>` : '';

  const fanHtml = reviews.length ? `      <section class="fan" id="reviews" aria-labelledby="fan-title">
        <h2 id="fan-title">Our Fan Club</h2>
        <div class="sum"><span class="stars" aria-hidden="true">★★★★★</span><span>${fmtRating(rating)}</span><span class="pct">· ${fiveStarPct != null ? `${fiveStarPct}% five-star · ` : ''}${fmtInt(product.reviewCount)} reviews</span></div>
        <div class="rail" aria-label="Customer reviews, swipe to read more">
${reviews.map(reviewCard).join('\n')}
        </div>
        <a class="more" href="${wwwBase}/${product.slug}/#reviews">See more reviews</a>
      </section>` : '';

  const encoreHtml = addOns.length ? `      <div class="encore">
        <h2>Encore! Include the perfect final note.</h2>
        <p class="sub">Popular add-ons that pair with this package.</p>
        <div class="rail" aria-label="Add-on items, swipe to see more">
${addOns.map(u => `          <a class="addon" href="${wwwBase}${u.url}" data-track="addon_click">${picture(img(u.image), { alt: u.name })}<span>${escHtml(u.name)}</span></a>`).join('\n')}
        </div>
      </div>` : '';

  const categoriesHtml = product.categories.map(cat => `    <div class="cat-h"><i></i><h2>${escHtml(cat.name)}</h2></div>
    <ul class="items">
${cat.items.map(it => `      <li>${picture(itemImg(it.name), { alt: '', width: 46, height: 46 })}<div><div class="name">${escHtml(it.name)}</div>${it.desc ? `<div class="desc">${escHtml(it.desc)}</div>` : ''}</div></li>`).join('\n')}
    </ul>`).join('\n');

  const faqHtml = allFaqs.map((f, i) => `    <div class="faq" data-faq>
      <button type="button" aria-expanded="false" aria-controls="faq-${i}"><span>${escHtml(f.q)}</span><span class="chev" aria-hidden="true">▾</span></button>
      <div class="panel" id="faq-${i}" data-faq-panel><p>${escHtml(f.a)}</p></div>
    </div>`).join('\n');

  const bannerTitle = ui.bannerTitle || 'Nurturing Strength. Uplifting Spirits.';
  const bannerCopy = ui.supportingHeadline || product.shortDesc;

  const stickyHtml = stickyCart ? `
  <div class="sticky-pad" id="stickyPad"></div>
  <aside class="sticky" id="stickyBar" aria-label="Purchase" aria-hidden="true">
    <div class="row">
      <div class="meta"><div class="t">${escHtml(ui.stickyLabel || product.title)}</div><div class="p">${escHtml(price)}</div></div>
      <a class="atc js-cart-btn" href="${cartUrl}" data-track="add_to_cart_sticky">Add to Cart</a>
    </div>
  </aside>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#606060">
<meta name="robots" content="${ALLOW_INDEXING ? 'index, follow' : 'noindex, follow'}">
<title>${escHtml(product.metaTitle || product.title)} | Rock The Treatment</title>
<meta name="description" content="${escHtml(product.shortDesc)}">
<link rel="canonical" href="${wwwBase}/${product.slug}/">
<meta property="og:title" content="${escHtml(product.title)}">
<meta property="og:description" content="${escHtml(product.shortDesc)}">
<meta property="og:image" content="${mBase}${heroUrl}">
<meta property="og:url" content="${mBase}/${product.slug}">
<meta property="og:type" content="product">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="image" href="${heroV && heroV.avif ? heroV.avif : heroUrl}"${heroV && heroV.avif ? ' type="image/avif"' : ''} fetchpriority="high">
<link href="${FONTS}" rel="stylesheet">
<style>${SHARED_CSS}${PRODUCT_CSS}</style>
${gtmHead}</head>
<body>
${gtmBody}<div class="wrap">
${topbar}
${headerHtml()}

  <main>
  <section aria-label="Product gallery" data-gallery>
    <div id="galleryStage" tabindex="0" aria-label="Use left and right arrow keys to browse product images">
      ${picture(heroUrl, { id: 'mainImg', cls: 'gallery-main', alt: product.title, priority: true, lazy: false, avifId: 'mainSrcAvif', webpId: 'mainSrcWebp' })}
    </div>
    <div class="rating-row"><a href="#reviews" data-track="rating_click"><span class="stars" aria-hidden="true">★★★★★</span><span>${fmtRating(rating)}</span><span class="count">· ${fmtInt(product.reviewCount)} reviews</span></a></div>
    <div class="thumbs" id="galleryThumbs" aria-label="Choose a product image">
${galleryImages.map((u, i) => `      <button class="thumb" type="button" data-index="${i}" aria-label="Show image ${i + 1} of ${galleryImages.length}" aria-current="${i === 0 ? 'true' : 'false'}">${picture(u, { alt: '', lazy: false })}</button>`).join('\n')}
    </div>
  </section>

  <section class="buy" aria-labelledby="product-title">
      <h1 id="product-title">${escHtml(product.title)}</h1>
      <div class="chips" aria-label="What this package is for">${chips.map(c => `<span>${escHtml(c)}</span>`).join('')}</div>
${priceRow}
${buyRow}
${stats}
${bellHtml}
${packedHtml}
${fanHtml}
${encoreHtml}
  </section>

  <div class="banner"><h2>${escHtml(bannerTitle)}</h2><p>${escHtml(bannerCopy)}</p></div>

  <section class="inside" aria-label="Everything inside">
${categoriesHtml}
  </section>

  <section class="faqs" aria-labelledby="faq-title">
    <h2 id="faq-title">FAQs</h2>
${faqHtml}
    <div class="more"><a href="${wwwBase}/faqs/">Browse more FAQs →</a></div>
  </section>
  </main>

${footerHtml()}
${stickyHtml}
</div>

<script>
(function(){
  'use strict';
  var PRODUCT_ID = ${product.id};
  var PRODUCT_NAME = ${JSON.stringify(product.title)};
  var UNIT_PRICE = ${priceNum};
  var GALLERY = ${JSON.stringify(gallery)};
  window.dataLayer = window.dataLayer || [];
  function track(eventName, detail){
    window.dataLayer.push(Object.assign({event:eventName, product_id:PRODUCT_ID, product_name:PRODUCT_NAME}, detail || {}));
  }
  track('view_item', {value: UNIT_PRICE});

  var mainImg = document.getElementById('mainImg');
  var mainAvif = document.getElementById('mainSrcAvif');
  var mainWebp = document.getElementById('mainSrcWebp');
  var stage = document.getElementById('galleryStage');
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('#galleryThumbs .thumb'));
  var current = 0;
  function show(i){
    if (!GALLERY.length) return;
    if (i < 0) i = GALLERY.length - 1;
    if (i >= GALLERY.length) i = 0;
    current = i;
    var g = GALLERY[i];
    if (mainAvif) mainAvif.srcset = g.a || '';
    if (mainWebp) mainWebp.srcset = g.w || '';
    mainImg.src = g.f;
    thumbs.forEach(function(t, k){ t.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    track('product_gallery_view', {image_index: i + 1});
  }
  thumbs.forEach(function(t, i){ t.addEventListener('click', function(){ show(i); }); });
  var startX = 0, dx = 0, swiping = false;
  stage.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; dx = 0; swiping = true; }, {passive:true});
  stage.addEventListener('touchmove', function(e){ if (swiping) dx = e.touches[0].clientX - startX; }, {passive:true});
  stage.addEventListener('touchend', function(){ if (!swiping) return; swiping = false; if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1)); });
  stage.addEventListener('keydown', function(e){
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
  });

  var cartBtns = Array.prototype.slice.call(document.querySelectorAll('.js-cart-btn'));
  cartBtns.forEach(function(b){ b.addEventListener('click', function(){ track(b.getAttribute('data-track') || 'add_to_cart', {quantity: 1, value: UNIT_PRICE}); }); });
  document.querySelectorAll('[data-track]:not(.js-cart-btn)').forEach(function(el){ el.addEventListener('click', function(){ track(el.getAttribute('data-track'), {href: el.href}); }); });

  var sticky = document.getElementById('stickyBar');
  var stickyPad = document.getElementById('stickyPad');
  var buyRow = document.getElementById('buyRow');
  if (sticky && buyRow && 'IntersectionObserver' in window) {
    new IntersectionObserver(function(entries){
      var e = entries[0];
      var hide = e.isIntersecting || e.boundingClientRect.top > 0;
      sticky.classList.toggle('is-visible', !hide);
      stickyPad.classList.toggle('is-visible', !hide);
      sticky.setAttribute('aria-hidden', hide ? 'true' : 'false');
    }, {threshold: 0}).observe(buyRow);
  }

  document.querySelectorAll('[data-faq]').forEach(function(row){
    var btn = row.querySelector('button');
    var panel = row.querySelector('[data-faq-panel]');
    btn.addEventListener('click', function(){
      var open = row.getAttribute('data-open') === 'true';
      row.setAttribute('data-open', open ? 'false' : 'true');
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.style.maxHeight = open ? '0' : panel.scrollHeight + 'px';
      // The label span only — btn.textContent would append the chevron glyph.
      if (!open) track('faq_open', {question: (btn.querySelector('span') || btn).textContent.trim()});
    });
  });

  var cd = document.querySelector('[data-countdown]');
  if (cd) {
    var cutoffHour = parseInt(cd.getAttribute('data-cutoff-hour'), 10);
    var out = cd.querySelector('[data-countdown-value]');
    function pad(n){ return (n < 10 ? '0' : '') + n; }
    function tick(){
      var now = new Date();
      var et = new Date(now.toLocaleString('en-US', {timeZone: 'America/New_York'}));
      var secs = (cutoffHour * 3600) - (et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds());
      var weekday = et.getDay() >= 1 && et.getDay() <= 5;
      if (secs <= 0 || !weekday) { cd.innerHTML = 'Free shipping over $200 · Flat rate shipping from $4.99'; return; }
      out.textContent = Math.floor(secs / 3600) + 'h ' + pad(Math.floor((secs % 3600) / 60)) + 'm ' + pad(secs % 60) + 's';
      setTimeout(tick, 1000);
    }
    tick();
  }
})();
</script>
</body>
</html>`;
}

// ---- Hub page --------------------------------------------------------------
function generateIndex() {
  const cards = products.map(p => `      <a class="card" href="./${p.slug}.html">
        ${picture(img(p.heroImage), { alt: p.title })}
        <div class="info"><div class="name">${escHtml(p.title)}</div><div class="rating"><span class="stars">★★★★★</span> ${fmtRating(p.rating || 5)} · ${fmtInt(p.reviewCount)}</div><div class="price">${escHtml(currentPrice(p))}</div></div>
      </a>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#606060">
<meta name="robots" content="${ALLOW_INDEXING ? 'index, follow' : 'noindex, follow'}">
<title>Care Packages | Rock The Treatment</title>
<meta name="description" content="Thoughtfully curated chemo and radiation care packages — the mobile-friendly Rock The Treatment store.">
<link rel="canonical" href="${wwwBase}/shop/">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>${SHARED_CSS}
.intro{padding:20px 20px 8px;text-align:center}
.intro h1{font-size:24px;font-weight:800;margin:0}
.intro p{font-size:13px;color:var(--muted);margin:6px 0 0}
.grid{padding:12px 16px 28px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{border:1px solid var(--border);border-radius:12px;overflow:hidden;color:inherit;display:block}
.card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.card .info{padding:10px}
.card .name{font-size:13px;font-weight:500;line-height:1.3}
.card .rating{font-size:11px;color:var(--soft);margin-top:4px}
.card .stars{color:var(--star)}
.card .price{font-size:15px;font-weight:800;margin-top:4px}
.foot{text-align:center;padding:0 16px 28px;font-size:12px;color:var(--soft)}
.foot a{font-weight:600}
</style>
${gtmHead}</head>
<body>
${gtmBody}<div class="wrap">
  <div class="topbar">Free shipping over $200 · Flat rate shipping from $4.99</div>
${headerHtml()}
  <main>
    <div class="intro">
      <h1>Care Packages</h1>
      <p>Thoughtfully curated comfort for chemo &amp; radiation</p>
    </div>
    <div class="grid">
${cards}
    </div>
    <div class="foot">Looking for something else? <a href="${wwwBase}/shop/">Visit the full store →</a></div>
  </main>
${footerHtml()}
</div>
</body>
</html>`;
}

for (const product of products) {
  const html = generatePage(product);
  fs.writeFileSync(path.join(outDir, `${product.slug}.html`), html, 'utf8');
  console.log(`✅ Generated: ${product.slug}.html (${(html.length / 1024).toFixed(1)} KB)`);
}
const indexHtml = generateIndex();
fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml, 'utf8');
console.log(`✅ Generated: index.html (${(indexHtml.length / 1024).toFixed(1)} KB)`);
console.log(`\n🎉 Done! ${products.length} product pages + index generated in ${outDir}`);
