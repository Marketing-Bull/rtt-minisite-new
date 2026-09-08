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
| Radiation Care Package | `radiation-basket.html` | 250 | $134.99 |
| Medium Men's Chemo Care Package | `mens-medium-chemo-basket.html` | 232 | $119.99 |

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
mockup, adjusted for the feedback on the "RTT Mobile Site Whiteboard" (Canva):
buy button above the fold, package-tile thumbnails plus the box-opening
animation, a brief overview under the title, side-swipe reviews, popular
add-ons instead of other-size suggestions, and a compact item list lower on
the page.

| Section (top to bottom) | Source |
| --- | --- |
| Top bar | Static ship-time line, or a countdown if the product opts in (below) |
| Gallery + thumbnails | `heroImage`, then `mobileUi.animationImage` (box-opening GIF) if set, then the `galleryImages` package tiles |
| Rating row | `rating`, `reviewCount` |
| Overview chips | `categories[].name` (leading "For " stripped) |
| Price | `mobileUi.displayPrice`, falling back to `price` |
| Quantity + Add to Cart (above the fold) | `id` → `/cart/?add-to-cart=<id>&quantity=<n>` |
| Checklist, stat tiles | `itemCount`, free-shipping threshold ($200), `totalSales` |
| Side-swipe reviews | `reviews[]`, featured one first via `mobileUi.featuredReviewIndex` |
| Popular add-ons | `upsellProducts` filtered by `mobileUi.addOns` (default: Worry Stone, Anti-Nausea Wristband, Tote, RTT Wristband, Knit Beanie, Warmies) |
| Banner | `mobileUi.insideTitle` / `supportingHeadline`, plus `shortDesc` |
| Compact item list | `categories[].items[]` (name + `desc`) with images from `itemImages` |
| FAQs | `faqs` / `radiationFaqs` plus shared shipping FAQs |
| Reviews summary | `rating`, `reviewCount`, link to the live reviews |

Pronouns in copy ("What she rated 5 stars") come from `mobileUi.pronoun`
(`she`, `he`, or `they`), inferred from the slug when unset.

The sticky purchase bar stays hidden until the inline Add to Cart button has
scrolled out of view, and shares one quantity with it. Set
`mobileUi.stickyCart` to `false` to remove it for a product (the inline button
still carries the page).

### Opt-in promo elements

The 1b mockup showed a strike-through price, a "ships today" countdown, and a
low-stock notice. Those need current supporting evidence before they go in
front of shoppers, so they render only when a product's `mobileUi` sets:

| Key | Renders |
| --- | --- |
| `compareAtPrice` (e.g. `"$219.00"`) | Strike-through price and a SAVE badge |
| `shipCutoffHourEt` (e.g. `14`) | Live countdown to that Eastern-time cutoff on weekdays, otherwise the static ship line |
| `stockNote` (e.g. `"Only a few left"`) | Orange note in the sticky purchase bar |

The mockup's "free celebration gift" line is intentionally not carried over:
the Celebration Bell is a separate product and is linked instead.

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
- Quantity changes update the cart link and the button total.
- The inline Add to Cart button is visible without scrolling on a 390×844 viewport.
- The sticky bar appears only after scrolling past it and does not cover the footer.
- Canonical URLs point to the corresponding live WooCommerce product page.
- Pages retain `noindex, follow` unless indexing is intentionally enabled in `generate.js`.

## Deployment

Cloudflare static-assets Worker:

- Worker name: `rtt-minisite-new`
- Asset directory: `public`
- Configuration: `wrangler.jsonc`
- Production command: `npm run deploy`

Optional: set `RTT_GTM_ID` at build time to emit a Google Tag Manager container;
the pages already push `view_item`, `gallery_view`, `faq_open`, and
`add_to_cart` into `window.dataLayer`.
