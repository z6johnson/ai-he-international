# NUD Intelligence Dashboard

A static intelligence dashboard supporting the strategy engagement to launch a new
AI-native university in the UAE ("NUD") with a top-200-in-20-years ranking ambition.
It turns the engagement's curated source list on AI in global higher education into a
working tool: a tracked watch list, a scan-style activity feed, and a prioritized
reading brief.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Overview: strategic posture, live stats, the key tensions on the board |
| `sources.html` | The watch list — 51 entities across three layers, with tiering and feed coverage |
| `activity.html` | The activity scan: filterable feed of dated intelligence items |
| `brief.html` | The top-10 "read first" list and standing caveats/risks |
| `about.html` | Methodology, provenance definitions, data status, how to run a scan |

## Running it

No build step, no dependencies, no runtime network requests. Open `index.html`
directly in a browser, or serve the directory:

```sh
python3 -m http.server 8000
```

Data lives in `data/*.js` as `window.*` globals (not fetched JSON) so the site works
identically on Vercel, GitHub Pages, a local server, and `file://`.

## Deploying to Vercel

The repo is a zero-build static Vercel app — `vercel.json` provides clean URLs
(`/activity` instead of `/activity.html`), security headers, and cache policy.
Two ways to deploy:

1. **Git integration (recommended):** [vercel.com/new](https://vercel.com/new) →
   import `z6johnson/ai-he-international` → keep every setting on its default
   (no framework, no build command, output = repo root) → Deploy. Every push
   after that redeploys automatically, which is what makes the scheduled scan
   (below) self-updating.
2. **CLI:** `npx vercel` from the repo root, accept the defaults.

## The three-layer model

- **Ongoing** — sources that compound: independent thinkers publishing continuously,
  and the observatories tracking the field.
- **Strategic core** — assessment, credentialing, and what a university is.
- **Founding** — building universities from scratch, the UAE regulatory machinery,
  Gulf strategy, and rankings mechanics.

## Updating the data

```sh
python3 scripts/scan.py --dry-run   # preview what a scan would add
python3 scripts/scan.py             # pull tracked RSS/Atom feeds, append new items
python3 scripts/scan.py --check     # lint data integrity (referential + vocab)
```

The scan script is stdlib-only Python. It dedupes by normalized URL, so repeated runs
are idempotent. Newly scanned items arrive marked `UNTRIAGED` — review them, write the
"why it matters" line in `data/items.js`, set `needs_review` to `false`, and bump
`baseline_date`/`baseline_version` in `data/meta.js`.

**Automated aggregation:** `.github/workflows/scan.yml` runs the same scan every
Monday 06:00 UTC (or on demand from the Actions tab) and commits new items when it
finds any. With the Vercel git integration connected, that commit triggers a
redeploy — so the dashboard refreshes itself weekly with no manual step and no
external services. The scanner is deterministic feed ingestion (plain HTTP +
RSS/Atom parsing); it needs no search agent, LLM, or API key. The only human (or
LLM-assisted) step is triage: writing the "why it matters" line for items that
arrive flagged `UNTRIAGED`.

**Bot-blocked feeds and the mirror fallback:** Substack and some WordPress sites
sit behind Cloudflare-style bot mitigation that rejects requests from datacenter
IPs (including GitHub Actions runners) with `403 Forbidden`, regardless of
headers. The scanner responds in three layers:

1. Browser-grade headers with retry/backoff (helps where the block is UA-based);
2. Feed auto-discovery from the site's `<link rel="alternate">` when the
   configured URL 404s (e.g. beehiiv publications, whose RSS lives at
   `rss.beehiiv.com/feeds/<id>.xml`), printing the discovered URL so you can pin
   it in `data/sources.js`;
3. A mirror fallback via [Open RSS](https://openrss.org) — a free, non-commercial
   feed proxy built for exactly this problem — tried automatically when the
   origin blocks or breaks. Mirrored entries link to the original articles, so
   URL-based dedupe stays consistent. Every mirror ingest is logged with a
   `NOTE` line. Override or disable with the `NUD_SCAN_MIRROR` env var.

If a source fails all three layers, an occasional local run
(`python3 scripts/scan.py` from your own machine, then commit) remains the
reliable complement — scans are idempotent, so CI and local runs interleave
safely.

Data files use a strict sentinel format (comment line, `window.NAME =`, pretty-printed
JSON, closing `;`) that `scan.py` round-trips. Edit the JSON body only.

Item provenance values: `pdf` (derives from the engagement's source-list document),
`websearch` (found in a targeted research pass), `scan` (ingested from a tracked feed).

Note: some sources (report publishers, regulators, observatories) have no machine
feed and are marked `MANUAL` on the Sources page — they are covered by periodic
research passes, not the scan.
