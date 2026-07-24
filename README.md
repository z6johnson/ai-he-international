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
identically on GitHub Pages, a local server, and `file://`.

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

Data files use a strict sentinel format (comment line, `window.NAME =`, pretty-printed
JSON, closing `;`) that `scan.py` round-trips. Edit the JSON body only.

Item provenance values: `pdf` (derives from the engagement's source-list document),
`websearch` (found in a targeted research pass), `scan` (ingested from a tracked feed).

Note: some sources (report publishers, regulators, observatories) have no machine
feed and are marked `MANUAL` on the Sources page — they are covered by periodic
research passes, not the scan.
