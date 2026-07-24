#!/usr/bin/env python3
"""NUD Intelligence Dashboard — feed scanner.

Pulls RSS/Atom feeds for every active source in data/sources.js with an
`rss` URL, dedupes against data/items.js, and appends new items with
provenance "scan" and needs_review=true. Stdlib only; run manually:

    python3 scripts/scan.py --dry-run     # preview, write nothing
    python3 scripts/scan.py               # append new items + update meta
    python3 scripts/scan.py --source ID   # scan one source
    python3 scripts/scan.py --days N      # ignore entries older than N days (default 90)
    python3 scripts/scan.py --check       # lint data integrity, no network
"""

import argparse
import datetime
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Substack, beehiiv, and WordPress WAFs (Cloudflare et al.) reject obvious
# bot user-agents — and sometimes datacenter IPs outright. Browser-grade
# headers get past the UA gate; the IP gate has no header fix, which is why
# running the scan from a residential machine succeeds where CI may not.
FETCH_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/126.0.0.0 Safari/537.36"),
    "Accept": ("application/rss+xml, application/atom+xml, "
               "application/xml;q=0.9, text/html;q=0.8, */*;q=0.7"),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip",
}
TIMEOUT = 15
RETRIES = 3          # attempts per URL for 403/429/5xx/network errors
RETRY_DELAY = 2      # seconds, doubles per attempt
SUMMARY_MAX = 300

# Feed-mirror fallback for sources whose CDN blocks datacenter IPs outright
# (Substack et al. 403 GitHub Actions runners regardless of headers).
# Open RSS (openrss.org) is a free, non-commercial feed proxy built for
# exactly this; its entries link to the original articles, so URL-based
# dedupe stays consistent between direct and mirrored runs.
MIRROR_BASE = os.environ.get("NUD_SCAN_MIRROR", "https://openrss.org")

LAYERS = {"ongoing", "strategic", "founding"}
CATEGORIES = {
    "thinkers", "observatories", "assessment", "credentialing", "books",
    "reports", "founding-cases", "uae-regulatory", "gulf-strategy",
    "rankings", "experiments",
}
REGIONS = {"global", "uae", "saudi", "qatar", "gulf", "us", "uk", "europe", "asia", "africa"}
KINDS = {"paper", "report", "post", "news", "book", "policy", "podcast", "case"}
PROVENANCES = {"pdf", "websearch", "scan"}

ITEM_FIELD_ORDER = [
    "id", "title", "url", "entity_id", "source_id", "date_published",
    "date_found", "layer", "category", "region", "kind", "tier",
    "provenance", "summary", "why", "needs_review",
]


# ---------------------------------------------------------------- data files

def load_data(path):
    """Read a sentinel-format data file: comment line, `window.X =`, JSON, `;`."""
    text = path.read_text(encoding="utf-8")
    lines = text.split("\n")
    if len(lines) < 3 or not lines[1].startswith("window."):
        sys.exit(f"error: {path} is not in the expected sentinel format")
    varname = lines[1].split("=")[0].strip().replace("window.", "")
    body = "\n".join(lines[2:])
    body = body.rstrip().rstrip(";").rstrip()
    # Undo the </ escape applied on write (json accepts \/ natively anyway).
    return varname, json.loads(body)


def save_data(path, varname, obj, comment=None):
    comment = comment or (
        "// GENERATED+CURATED DATA — edit JSON body only; "
        'keep the 2-line header and trailing ";" intact for scripts/scan.py.'
    )
    if isinstance(obj, list):
        obj = [ordered_item(x) if isinstance(x, dict) and "provenance" in x else x for x in obj]
    body = json.dumps(obj, indent=2, ensure_ascii=False)
    # A literal "</script>" inside a JSON string would terminate the <script>
    # element that loads this file; "<\/" is equivalent JSON and inert in HTML.
    body = body.replace("</", "<\\/")
    path.write_text(f"{comment}\nwindow.{varname} =\n{body}\n;\n", encoding="utf-8")


def ordered_item(item):
    out = {k: item[k] for k in ITEM_FIELD_ORDER if k in item}
    for k in item:
        if k not in out:
            out[k] = item[k]
    return out


# ---------------------------------------------------------------- utilities

def today():
    return datetime.date.today().isoformat()


def normalize_url(url):
    try:
        p = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return url.strip().lower()
    query = [
        (k, v) for k, v in urllib.parse.parse_qsl(p.query)
        if not k.lower().startswith("utm_") and k.lower() not in ("ref", "source", "fbclid", "gclid")
    ]
    return urllib.parse.urlunsplit((
        p.scheme.lower() or "https",
        p.netloc.lower(),
        p.path.rstrip("/"),
        urllib.parse.urlencode(query),
        "",
    ))


def slugify(text, max_words=6):
    words = re.sub(r"[^a-z0-9\s-]", "", text.lower()).split()
    return "-".join(words[:max_words]) or "item"


def strip_html(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > SUMMARY_MAX:
        text = text[:SUMMARY_MAX].rsplit(" ", 1)[0] + "…"
    return text


# ---------------------------------------------------------------- feed parse

def fetch(url):
    import gzip
    import time
    last_exc = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers=FETCH_HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding", "") == "gzip":
                    raw = gzip.decompress(raw)
                return raw
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code not in (403, 408, 429, 500, 502, 503, 504):
                raise  # 404 etc.: retrying won't help
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_exc = exc
        if attempt < RETRIES - 1:
            time.sleep(RETRY_DELAY * (2 ** attempt))
    raise last_exc


FEED_LINK_RE = re.compile(
    r'<link[^>]+(?:type=["\']application/(?:rss|atom)\+xml["\'][^>]*'
    r'href=["\']([^"\']+)["\']|href=["\']([^"\']+)["\'][^>]*'
    r'type=["\']application/(?:rss|atom)\+xml["\'])',
    re.IGNORECASE,
)


def discover_feed(home_url):
    """Best-effort <link rel="alternate"> feed discovery from a homepage.

    Platforms like beehiiv serve RSS from a non-obvious host
    (rss.beehiiv.com/feeds/<id>.xml), so a hardcoded <domain>/feed 404s.
    Returns an absolute feed URL or None.
    """
    try:
        html_bytes = fetch(home_url)
    except Exception:
        return None
    text = html_bytes.decode("utf-8", errors="replace")
    m = FEED_LINK_RE.search(text)
    if not m:
        return None
    href = m.group(1) or m.group(2)
    return urllib.parse.urljoin(home_url, href.strip())


def local_name(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def parse_date(raw):
    if not raw:
        return None
    raw = raw.strip()
    try:
        import email.utils
        dt = email.utils.parsedate_to_datetime(raw)
        return dt.date().isoformat()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def parse_feed(raw_bytes):
    """Return a list of {title, url, date_published, summary} from RSS 2.0 or Atom."""
    root = ET.fromstring(raw_bytes)
    entries = []
    root_name = local_name(root.tag)

    if root_name == "rss" or root_name == "RDF":
        for item in root.iter():
            if local_name(item.tag) != "item":
                continue
            fields = {}
            for child in item:
                fields.setdefault(local_name(child.tag), (child.text or "").strip())
            entries.append({
                "title": html.unescape(fields.get("title", "")).strip(),
                "url": fields.get("link", "").strip(),
                "date_published": parse_date(fields.get("pubDate") or fields.get("date")),
                "summary": strip_html(fields.get("description", "")),
            })
    elif root_name == "feed":  # Atom
        for entry in root.iter():
            if local_name(entry.tag) != "entry":
                continue
            title, url, published, summary = "", "", None, ""
            for child in entry:
                name = local_name(child.tag)
                if name == "title":
                    title = html.unescape(child.text or "").strip()
                elif name == "link":
                    rel = child.get("rel", "alternate")
                    if rel == "alternate" or not url:
                        url = child.get("href", "").strip()
                elif name in ("published", "updated") and not published:
                    published = parse_date(child.text)
                elif name in ("summary", "content") and not summary:
                    summary = strip_html(child.text or "")
            entries.append({"title": title, "url": url,
                            "date_published": published, "summary": summary})
    else:
        raise ValueError(f"unrecognized feed root element <{root_name}>")

    return [e for e in entries if e["title"] and e["url"]]


# ---------------------------------------------------------------- lint

def check(entities, sources, items):
    errors = []
    entity_ids = {e["id"] for e in entities}
    seen_ids = set()
    for e in entities:
        if e["layer"] not in LAYERS:
            errors.append(f"entity {e['id']}: bad layer {e['layer']!r}")
        if e["category"] not in CATEGORIES:
            errors.append(f"entity {e['id']}: bad category {e['category']!r}")
        if e["region"] not in REGIONS:
            errors.append(f"entity {e['id']}: bad region {e['region']!r}")
        if e["tier"] not in (1, 2):
            errors.append(f"entity {e['id']}: bad tier {e['tier']!r}")
    for s in sources:
        if s["entity_id"] not in entity_ids:
            errors.append(f"source {s['id']}: unknown entity {s['entity_id']!r}")
        if s["default_kind"] not in KINDS:
            errors.append(f"source {s['id']}: bad default_kind {s['default_kind']!r}")
    for i in items:
        if i["id"] in seen_ids:
            errors.append(f"item {i['id']}: duplicate id")
        seen_ids.add(i["id"])
        if i["entity_id"] not in entity_ids:
            errors.append(f"item {i['id']}: unknown entity {i['entity_id']!r}")
        if i["layer"] not in LAYERS:
            errors.append(f"item {i['id']}: bad layer {i['layer']!r}")
        if i["category"] not in CATEGORIES:
            errors.append(f"item {i['id']}: bad category {i['category']!r}")
        if i["region"] not in REGIONS:
            errors.append(f"item {i['id']}: bad region {i['region']!r}")
        if i["kind"] not in KINDS:
            errors.append(f"item {i['id']}: bad kind {i['kind']!r}")
        if i["provenance"] not in PROVENANCES:
            errors.append(f"item {i['id']}: bad provenance {i['provenance']!r}")
        if i["tier"] not in (1, 2):
            errors.append(f"item {i['id']}: bad tier {i['tier']!r}")
        for field in ("date_published", "date_found"):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(i.get(field, ""))):
                errors.append(f"item {i['id']}: bad {field} {i.get(field)!r}")
    return errors


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source", help="scan a single source id")
    ap.add_argument("--days", type=int, default=90,
                    help="skip feed entries published more than N days ago")
    ap.add_argument("--check", action="store_true", help="lint data files and exit")
    args = ap.parse_args()

    _, entities = load_data(DATA / "entities.js")
    _, sources = load_data(DATA / "sources.js")
    _, items = load_data(DATA / "items.js")
    _, meta = load_data(DATA / "meta.js")

    if args.check:
        errors = check(entities, sources, items)
        for e in errors:
            print("LINT:", e)
        print(f"checked {len(entities)} entities, {len(sources)} sources, "
              f"{len(items)} items — {len(errors)} problem(s)")
        sys.exit(1 if errors else 0)

    entity_by_id = {e["id"]: e for e in entities}
    known_urls = {normalize_url(i["url"]) for i in items}
    known_titles = {(i.get("source_id"), i["title"].strip().lower()) for i in items}
    known_ids = {i["id"] for i in items}
    cutoff = datetime.date.today() - datetime.timedelta(days=args.days)

    targets = [s for s in sources if s.get("rss") and s.get("active")]
    skipped = [s for s in sources if not (s.get("rss") and s.get("active"))]
    if args.source:
        targets = [s for s in targets if s["id"] == args.source]
        if not targets:
            sys.exit(f"error: no active rss source with id {args.source!r}")

    def mirror_candidates(src):
        """Mirror URLs to try when the origin blocks us: the mirrored feed
        path first, then the mirrored homepage (Open RSS can generate a
        feed from a site root when the /feed path itself is wrong)."""
        urls = []
        for direct in (src["rss"], src["url"]):
            p = urllib.parse.urlsplit(direct)
            mirrored = f"{MIRROR_BASE}/{p.netloc}{p.path}".rstrip("/")
            if mirrored not in urls:
                urls.append(mirrored)
        return urls

    def fetch_source_feed(src):
        """Fetch and parse the configured feed. On 404/non-XML, try feed
        auto-discovery from the homepage; if the origin blocks or breaks,
        fall back to the Open RSS mirror."""
        try:
            return parse_feed(fetch(src["rss"]))
        except (urllib.error.HTTPError, urllib.error.URLError,
                ET.ParseError, ValueError, TimeoutError, OSError) as exc:
            not_found = (isinstance(exc, urllib.error.HTTPError) and exc.code == 404) \
                or isinstance(exc, (ET.ParseError, ValueError))
            if not_found:
                alt = discover_feed(src["url"])
                if alt and alt != src["rss"]:
                    try:
                        entries = parse_feed(fetch(alt))
                        print(f"NOTE  {src['id']}: configured rss failed ({exc}); "
                              f"discovered {alt} — pin it in data/sources.js")
                        return entries
                    except Exception:  # noqa: BLE001 — fall through to mirror
                        pass
            for mirrored in mirror_candidates(src):
                try:
                    entries = parse_feed(fetch(mirrored))
                    print(f"NOTE  {src['id']}: origin failed ({exc}); "
                          f"ingested via mirror {mirrored}")
                    return entries
                except Exception:  # noqa: BLE001 — try next candidate
                    continue
            raise

    new_items, failures = [], []
    for src in targets:
        try:
            entries = fetch_source_feed(src)
        except Exception as exc:  # noqa: BLE001 — one dead feed must not kill the run
            failures.append(src["id"])
            print(f"FAIL  {src['id']}: {exc}")
            continue

        entity = entity_by_id.get(src["entity_id"], {})
        added = 0
        for e in entries:
            pub = e["date_published"] or today()
            if datetime.date.fromisoformat(pub) < cutoff:
                continue
            norm = normalize_url(e["url"])
            tkey = (src["id"], e["title"].strip().lower())
            if norm in known_urls or tkey in known_titles:
                continue
            item_id = f"{pub}-{slugify(e['title'])}"
            n = 2
            while item_id in known_ids:
                item_id = f"{pub}-{slugify(e['title'])}-{n}"
                n += 1
            new_items.append({
                "id": item_id,
                "title": e["title"],
                "url": e["url"],
                "entity_id": src["entity_id"],
                "source_id": src["id"],
                "date_published": pub,
                "date_found": today(),
                "layer": entity.get("layer", "ongoing"),
                "category": entity.get("category", "thinkers"),
                "region": entity.get("region", "global"),
                "kind": src.get("default_kind", "post"),
                "tier": entity.get("tier", 2),
                "provenance": "scan",
                "summary": e["summary"],
                "why": "",
                "needs_review": True,
            })
            known_urls.add(norm)
            known_titles.add(tkey)
            known_ids.add(item_id)
            added += 1
        print(f"OK    {src['id']}: {len(entries)} entries, {added} new")

    print(f"\n{len(new_items)} new item(s); {len(failures)} feed(s) failed; "
          f"{len(skipped)} source(s) have no feed (covered manually)")

    if args.dry_run:
        for i in new_items:
            print(f"  would add: [{i['date_published']}] {i['entity_id']}: {i['title']}")
        return

    if new_items:
        items.extend(new_items)
        items.sort(key=lambda i: (i["date_found"], i["date_published"], i["id"]), reverse=True)
        save_data(DATA / "items.js", "NUD_ITEMS", items)
    meta["last_scan"] = today()
    meta["counts"] = {"entities": len(entities), "sources": len(sources), "items": len(items)}
    save_data(DATA / "meta.js", "NUD_META", meta)
    print("wrote data/items.js and data/meta.js" if new_items else "wrote data/meta.js (no new items)")


if __name__ == "__main__":
    main()
