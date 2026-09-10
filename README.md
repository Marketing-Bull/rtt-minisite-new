# RTT Minisite (new) — 1b High-Conversion design

Mobile-first product landing pages for
[Rock The Treatment](https://www.rockthetreatment.com/), rendered in the **1b
"High-Conversion"** design from
[`rtt-mobile-redesign-showcase`](https://github.com/Marketing-Bull/rtt-mobile-redesign-showcase).
Same architecture as [`rtt-minisite`](https://github.com/Marketing-Bull/rtt-minisite):
a dependency-free generator reads `product-data.json` and writes static pages
to `public/`, which deploys as a Cloudflare static-assets Worker. Product
discovery happens here; cart and checkout hand off to the live WooCommerce
store.

## Current products

Product facts live in `product-data.json` (copied from `rtt-minisite`, which
mirrors rockthetreatment.com). Do not hard-code prices, product IDs, ratings,
or review counts in the generator.

| Product | Page | WooCommerce ID | Price |
| --- | --- | ---: | ---: |
| Large Women's Chemo Care Package | `womens-large-chemo-basket.html` | 248 | $169.99 |
| Medium Women's Chemo Care Package | `womens-medium-chemo-basket.html` | 235 | $129.99 |
| Small Women's Chemo Care Package | `womens-small-chemo-basket.html` | 10338 | $74.99 |
| Radiation Care Package | `radiation-basket.html` | 250 | $139.99 |
| Medium Men's Chemo Care Package | `mens-medium-chemo-basket.html` | 232 | $129.99 |

## Quick start

Requires Node.js 22 or newer.

```bash
npm ci
npm run build
npm run check
npm run preview
```

Wrangler serves the site at `http://localhost:8787` by default.

| Command | Purpose |
| --- | --- |
| `npm run build` | Generate the hub and five product pages in `public/` |
| `npm run check` | Verify every local image/link in the generated pages exists |
| `npm run preview` | Run the Cloudflare Worker locally |
| `npm run optimize` | Generate AVIF/WebP image variants with Sharp |
| `npm run deploy` | Deploy the static-assets Worker with Wrangler |

## Source and build workflow

`generate.js` reads `product-data.json` and writes the generated HTML to
`public/`. Both source and generated output are committed so previews and
deployments use the same reviewed artifact.

For every content or template change:

```bash
npm run build
npm run check
git diff --check
git status --short
```

Commit changes to `generate.js` and/or `product-data.json` together with the
regenerated files under `public/`.

## Repository layout

```text
generate.js              Static-site generator and the 1b template (CSS + JS inline)
product-data.json        Product facts, page copy, reviews, and image paths
public/                  Generated site and self-hosted image assets
public/_headers          Cache and security headers
tools/check-links.js     Post-build check that all local references resolve
tools/optimize-images.js AVIF/WebP variant generator (build-time only, needs Sharp)
wrangler.jsonc           Cloudflare static-assets Worker configuration
```

## How the 1b design maps to data

Every section is driven by `product-data.json`. The layout follows the 1b
mockup as annotated in the "RTT Mobile Site Whiteboard" (Canva) review, and
colors come from the rockthetreatment.com/shop theme: header gray `#606060`,
brand purple `#701F8E`, orange `#ff6319` / `#fb4f14`, green `#81d742`, and the
green top-bar gradient `#65993a → #96f24c`. Type is Catamaran, as on the
desktop site.

| Section (top to bottom) | Source |
| --- | --- |
| Top bar | "Free shipping over $200 · Flat rate shipping from $4.99", or a countdown if the product opts in (below) |
| Header (dark gray, large logo) | Shop link to the hub, cart link to the store |
| Gallery, rating row, thumbnails | `heroImage`, then `mobileUi.animationImage` (box-opening GIF) if set, then the `galleryImages` package tiles; `rating`, `reviewCount` |
| Title + overview chips | `title`, `categories[].name` (leading "For " stripped) |
| Price and Add to Cart (above the fold) | `mobileUi.displayPrice` or `price`; `id` → `/cart/?add-to-cart=<id>&quantity=1` (quantity is changed in the store cart) |
| Stat tiles | item count from `categories`, `rating`, ship time |
| Celebration Bell note | Sold separately, links to `mobileUi.celebrationUrl` or `/bell/` |
| Packed with Purpose (side scroll) | `mobileUi.featuredItems`, falling back to the first six items |
| Our Fan Club (side scroll) | `reviews[]`, `ratingBreakdown` for the five-star percentage, "See more reviews" to the live page |
| Encore! (side scroll add-ons) | `upsellProducts` filtered by `mobileUi.addOns` (default: blanket, Worry Stone, Anti-Nausea Wristband, tote, RTT wristband, Knit Beanie, Warmies, Warmies + Stone) |
| Purple banner | `mobileUi.bannerTitle` (default "Nurturing Strength. Uplifting Spirits.") plus `supportingHeadline` or `shortDesc` |
| Item list (polka-dot background) | `categories[].items[]` (name + `desc`) with images from `itemImages`; a placeholder tile is used when no image exists |
| FAQs | `faqs` / `radiationFaqs` plus shared shipping FAQs |

Pronouns come from `mobileUi.pronoun` (`she`, `he`, or `they`), inferred from
the slug when unset. The sticky purchase bar stays hidden until the inline Add
to Cart button has scrolled out of view; set
`mobileUi.stickyCart` to `false` to remove it for a product.

### Keeping data in sync with the live store

`product-data.json` was reconciled against rockthetreatment.com on
2026-09-10: prices, review counts, star breakdowns, and the "what's included"
lists (with short descriptions taken from the live copy) match the store as of
that date. Re-check before each launch; the live product pages are the source
of truth. Item and add-on images are self-hosted copies of the store's
uploads (the store's image sitemaps at `/product-sitemap.xml` and
`/post-sitemap.xml` are the quickest way to find a file by name); an item
with no entry in `itemImages` renders as a placeholder tile.

### Opt-in promo elements

The 1b mockup showed a strike-through price, a "ships today" countdown, and a
low-stock notice. Those need current supporting evidence before they go in
front of shoppers, so they render only when a product's `mobileUi` sets:

| Key | Renders |
| --- | --- |
| `compareAtPrice` (e.g. `"$219.00"`) | Strike-through price and a SAVE badge |
| `shipCutoffHourEt` (e.g. `14`) | Live countdown to that Eastern-time cutoff on weekdays, otherwise the static ship line |
| `stockNote` (e.g. `"Only a few left"`) | Orange note in the sticky purchase bar |

The Celebration Bell is not included with any package; it is a separate
end-of-treatment gift, so the page links to it rather than promising it.

## Product and review integrity

- Cart links use `https://www.rockthetreatment.com/cart/?add-to-cart=<id>&quantity=<n>`.
- The free gift note is entered at checkout.
- Shipping is free over $200; shipping for lower totals is calculated at checkout.
- Fulfillment guidance is 1–2 business days from New York, followed by carrier transit time.
- Unopened packages may be returned within 180 days.
- Do not publish scarcity, comparison-value, same-day shipping, medical, or
  treatment claims without current supporting evidence.

## Images and performance

Images are self-hosted under `public/assets/uploads/` (only the files these
pages reference) and served through `<picture>` with AVIF and WebP variants
plus the original fallback. The generator only references variant files that
exist, so a missing variant falls back to the original image.

## Verification checklist

Before merging:

- `npm run build` completes and `npm run check` reports 0 missing references.
- Gallery thumbnails, keyboard arrows, swipe, and FAQ accordions work.
- Both Add to Cart buttons point at the store cart with the right product ID.
- The inline Add to Cart button is visible without scrolling on a 390×844 viewport.
- The sticky bar appears only after scrolling past it and does not cover the footer.
- Canonical URLs point to the corresponding live WooCommerce product page.
- Pages retain `noindex, follow` unless indexing is intentionally enabled in `generate.js`.

## Deployment

Vercel (Git integration): `vercel.json` builds with `node generate.js`, checks links, and
serves `public/` with the same cache and security headers as `public/_headers`.

Cloudflare static-assets Worker (alternative):

- Worker name: `rtt-minisite-new`
- Asset directory: `public`
- Configuration: `wrangler.jsonc`
- Production command: `npm run deploy`

## Analytics

Every page pushes events into `window.dataLayer` unconditionally. Set `RTT_GTM_ID`
at build time to also emit the Google Tag Manager container that forwards them to
GA4 — without a container the events are pushed but nothing consumes them.

Every event carries `product_id` and `product_name` at the top level.

### GA4 ecommerce events

`view_item` and `add_to_cart` use GA4's ecommerce shape: an `ecommerce` object
holding `currency`, `value` and a one-entry `items` array (`item_id`,
`item_name`, `item_brand`, `item_category`, `price`, `quantity`, `currency`).
The `items` array is what populates GA4's ecommerce reports — item revenue,
cart-to-view rate, product performance. A bare `value` leaves those reports empty.

Each is preceded by a `{ecommerce: null}` push, the standard GTM idiom for
clearing the previous ecommerce object so its fields cannot bleed into the next
event.

| Event | Fires when | Extra parameters |
| --- | --- | --- |
| `view_item` | page load | — |
| `add_to_cart` | any Add to Cart button is clicked | `cta_location`: `inline` or `sticky` |

Both cart CTAs deliberately fire the same standard `add_to_cart` name. GA4 only
applies ecommerce treatment to its own event names, so a separate
`add_to_cart_sticky` would drop the sticky bar — the dominant CTA on mobile —
out of the ecommerce funnel entirely. `cta_location` keeps the two separable in
reports without that cost.

In GTM, send these with a GA4 Event tag whose **Send Ecommerce data** is set to
**Data Layer**.

### Custom events

Flat parameters, no `ecommerce` object.

| Event | Fires when | Parameters |
| --- | --- | --- |
| `product_gallery_view` | a gallery image is shown (thumbnail, swipe, arrow key) | `image_index` (1-based) |
| `rating_click` | the rating under the hero is clicked | `href` |
| `celebration_bell` | the Celebration Bell link is clicked | `href` |
| `addon_click` | an "Encore" add-on is clicked | `href` |
| `faq_open` | an FAQ row is expanded | `question` |

### Cross-domain measurement is required

The cart and checkout live on `www.rockthetreatment.com` while these pages are
served from `m.rockthetreatment.com`. The GA4 config tag must list both hosts,
otherwise the session splits at the moment of conversion and `add_to_cart` never
ties to revenue.

### Not tracked

The hub page (`index.html`) emits no events — package card clicks are currently
invisible, so the hub-to-product step of the funnel cannot be measured.

Three events from the original minisite have no counterpart here, by design
rather than omission: `see_inside` and `full_contents` measured a collapsed
contents list that this design renders inline, and `add_to_cart_final` measured
a bottom-of-page CTA that the sticky bar replaces.
