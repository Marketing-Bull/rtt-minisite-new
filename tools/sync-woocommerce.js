#!/usr/bin/env node
// Pull the store-owned facts for each product from the live WooCommerce Store
// API and write them into product-data.json:
//
//   sku            what GTM4WP on www sends as item_id, so the minisite's
//                  view_item / add_to_cart items match the store's purchase
//   price          the live price, so the page, the cart and GA4 agree
//   wooCategories  the store's category names, in the order GTM4WP uses for
//                  item_category / item_category2
//   stockStatus    instock | outofstock | onbackorder
//   purchasable    false means ?add-to-cart= will fail on www
//
// Curated copy (titles, reviews, item lists, mobileUi) is never touched. Run
// it before a launch and commit the result: builds stay offline and
// reproducible, and the diff shows exactly what the store changed.
//
//   npm run sync            update product-data.json
//   npm run sync -- --check report differences, write nothing, exit 1 if any

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'product-data.json');
const checkOnly = process.argv.includes('--check');

// Store API stock_availability.class -> WooCommerce stock_status, which is
// what GTM4WP puts in items[].stockstatus.
const STOCK_STATUS = {
  'in-stock': 'instock',
  'out-of-stock': 'outofstock',
  'available-on-backorder': 'onbackorder',
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function fmtMinor(minor, unit, prefix) {
  const n = Number(minor) / Math.pow(10, unit);
  return `${prefix}${n.toFixed(unit)}`;
}

async function fetchProduct(wwwBase, id) {
  const url = `${wwwBase}/wp-json/wc/store/v1/products/${id}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Rewrite only the synced lines, in place. Re-serialising the whole file would
// turn 5.0 into 5 and reorder the numeric ratingBreakdown keys, burying the
// store's real changes in noise. Each synced key sits on one line in its
// product object; missing keys are inserted, in order, after its "price".
const SYNCED_KEYS = ['sku', 'price', 'wooCategories', 'stockStatus', 'purchasable'];
function patchText(text, data) {
  const lines = text.split('\n');
  for (const product of data.products) {
    const start = lines.findIndex(l => new RegExp(`^\\s{6}"id": ${product.id},$`).test(l));
    if (start < 0) throw new Error(`product ${product.id} not found in product-data.json`);
    let end = start;
    while (end < lines.length && !/^\s{4}\}/.test(lines[end])) end++;
    let insertAt = start + lines.slice(start, end).findIndex(l => l.startsWith('      "price": ')) + 1;
    for (const key of SYNCED_KEYS) {
      const line = `      ${JSON.stringify(key)}: ${JSON.stringify(product[key])},`;
      const at = lines.slice(start, end).findIndex(l => l.startsWith(`      ${JSON.stringify(key)}: `));
      if (at >= 0) {
        lines[start + at] = line;
      } else {
        lines.splice(insertAt++, 0, line);
        end++;
      }
    }
  }
  const out = lines.join('\n');
  JSON.parse(out); // never write a file the generator cannot read
  return out;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const changes = [];
  const warnings = [];

  for (const product of data.products) {
    const live = await fetchProduct(data.wwwBase, product.id);
    const pr = live.prices;
    const next = {
      sku: live.sku || '',
      price: fmtMinor(pr.price, pr.currency_minor_unit, pr.currency_prefix),
      wooCategories: (live.categories || []).map(c => decodeEntities(c.name)),
      stockStatus: live.is_on_backorder ? 'onbackorder'
        : STOCK_STATUS[(live.stock_availability || {}).class] || (live.is_in_stock ? 'instock' : 'outofstock'),
      purchasable: live.is_purchasable !== false,
    };

    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(product[key]) !== JSON.stringify(value)) {
        changes.push(`${product.slug}: ${key} ${JSON.stringify(product[key])} -> ${JSON.stringify(value)}`);
        product[key] = value;
      }
    }

    if (!next.sku) warnings.push(`${product.slug}: no SKU in WooCommerce; the page falls back to the post ID (${product.id}), which will not match www's items`);
    if (!next.purchasable) warnings.push(`${product.slug}: not purchasable on www; its Add To Cart link will fail`);
    if (next.stockStatus === 'outofstock') warnings.push(`${product.slug}: out of stock on www; its Add To Cart link will fail`);
    const display = product.mobileUi && product.mobileUi.displayPrice;
    if (display && display !== next.price) warnings.push(`${product.slug}: mobileUi.displayPrice ${display} overrides the live price ${next.price}`);
    if (Number(pr.regular_price) > Number(pr.price)) warnings.push(`${product.slug}: on sale on www (regular ${fmtMinor(pr.regular_price, pr.currency_minor_unit, pr.currency_prefix)}); set mobileUi.compareAtPrice if the page should show it`);
  }

  changes.forEach(c => console.log(`~ ${c}`));
  warnings.forEach(w => console.warn(`! ${w}`));

  if (checkOnly) {
    console.log(changes.length ? `\n${changes.length} difference(s) from the live store.` : '\nIn sync with the live store.');
    process.exit(changes.length ? 1 : 0);
  }
  if (changes.length) {
    fs.writeFileSync(DATA_PATH, patchText(fs.readFileSync(DATA_PATH, 'utf8'), data), 'utf8');
    console.log(`\nUpdated product-data.json (${changes.length} change(s)). Rebuild with npm run build.`);
  } else {
    console.log('\nAlready in sync with the live store.');
  }
})().catch(err => { console.error(err.message || err); process.exit(1); });
