/* NUD Intelligence Dashboard — shared renderers.
   Data arrives via window.NUD_META / NUD_ENTITIES / NUD_SOURCES / NUD_ITEMS
   (script-tag globals so the site works on file:// as well as http). */

(function () {
  "use strict";

  var META = window.NUD_META || {};
  var ENTITIES = window.NUD_ENTITIES || [];
  var SOURCES = window.NUD_SOURCES || [];
  var ITEMS = window.NUD_ITEMS || [];

  var LAYER_LABELS = {
    ongoing: "Ongoing",
    strategic: "Strategic core",
    founding: "Founding"
  };
  var CATEGORY_LABELS = {
    thinkers: "Thinkers & newsletters",
    observatories: "Observatories & research centers",
    assessment: "Assessment under AI",
    credentialing: "Credentialing",
    books: "Books",
    reports: "Reports & white papers",
    "founding-cases": "Founding cases",
    "uae-regulatory": "UAE regulatory",
    "gulf-strategy": "Gulf strategy",
    rankings: "Rankings mechanics",
    experiments: "Institutional experiments"
  };
  var LAYER_DESCRIPTIONS = {
    ongoing: "Sources that compound: independent thinkers publishing continuously, and the observatories tracking the field.",
    strategic: "The strategic core: assessment, credentialing, and what a university is.",
    founding: "The founding layer: building universities from scratch, the UAE regulatory machinery, Gulf strategy, and rankings mechanics."
  };
  var GULF_REGIONS = { uae: 1, saudi: 1, qatar: 1, gulf: 1 };

  var entityById = {};
  ENTITIES.forEach(function (e) { entityById[e.id] = e; });

  var trackedEntityIds = {};
  SOURCES.forEach(function (s) {
    if (s.rss && s.active) trackedEntityIds[s.entity_id] = true;
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function daysSince(iso) {
    if (!iso) return Infinity;
    var then = new Date(iso + "T00:00:00Z").getTime();
    return Math.floor((Date.now() - then) / 86400000);
  }
  function isoWeek(iso) {
    var d = new Date(iso + "T00:00:00Z");
    var day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var fday = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
    var week = 1 + Math.round((d - firstThu) / (7 * 86400000));
    return d.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
  }
  function sortItems(arr) {
    return arr.slice().sort(function (a, b) {
      if (a.date_found !== b.date_found) return a.date_found < b.date_found ? 1 : -1;
      if (a.date_published !== b.date_published) return a.date_published < b.date_published ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
  }

  /* ---------- shared chrome ---------- */

  function fillFooter() {
    var el = document.getElementById("data-status");
    if (!el) return;
    var age = daysSince(META.baseline_date);
    var html =
      "DATA STATUS&ensp;&middot;&ensp;BASELINE V" + esc(META.baseline_version) +
      " &middot; " + ENTITIES.length + " ENTITIES &middot; " + ITEMS.length +
      " DATA POINTS &middot; AS OF " + esc(META.baseline_date);
    if (age > (META.stale_after_days || 30)) {
      html += ' <span class="stale">(' + age + "D OLD)</span>";
    }
    el.innerHTML = html;
  }

  /* ---------- feed rendering ---------- */

  function renderItemHTML(i) {
    var ent = entityById[i.entity_id];
    var entName = ent ? ent.name : i.entity_id;
    var provLine = esc(i.provenance) + " (" + esc(i.kind) + ") — " +
      esc(i.why || "Awaiting triage: no analyst note yet.");
    var untriaged = i.needs_review ? ' <span class="tag-untriaged">UNTRIAGED</span>' : "";
    return (
      '<div class="feed-item">' +
        '<div class="feed-item-top">' +
          '<div class="feed-item-head">' +
            '<span class="entity-name">' + esc(entName) + "</span>" +
            '<a class="item-title" href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.title) + "</a>" +
          "</div>" +
          '<span class="item-meta">found ' + esc(i.date_found) + " &middot; pub " + esc(i.date_published) +
            " &middot; tier " + esc(i.tier) + " &middot; " + esc(i.provenance) + "</span>" +
        "</div>" +
        '<p class="item-summary">' + esc(i.summary) + "</p>" +
        '<p class="item-provenance">' + provLine + untriaged + "</p>" +
      "</div>"
    );
  }

  function renderFeed(container, items, emptyMessage) {
    if (!items.length) {
      container.innerHTML = '<div class="feed-empty">' + esc(emptyMessage || "No items.") + "</div>";
      return;
    }
    container.innerHTML = items.map(renderItemHTML).join("");
  }

  /* ---------- activity page: filters ---------- */

  var AXES = [
    {
      key: "layer", label: "Layer", hasAll: true,
      pills: [
        { id: "ongoing", label: "Ongoing", test: function (i) { return i.layer === "ongoing"; } },
        { id: "strategic", label: "Strategic core", test: function (i) { return i.layer === "strategic"; } },
        { id: "founding", label: "Founding", test: function (i) { return i.layer === "founding"; } }
      ]
    },
    {
      key: "scope", label: "Scope", hasAll: true,
      pills: [
        { id: "thinkers", label: "Thinkers", cats: ["thinkers"] },
        { id: "observatories", label: "Observatories", cats: ["observatories"] },
        { id: "assessment", label: "Assessment", cats: ["assessment", "credentialing"] },
        { id: "regulatory", label: "Regulatory", cats: ["uae-regulatory"] },
        { id: "gulfstrategy", label: "Gulf strategy", cats: ["gulf-strategy"] },
        { id: "rankings", label: "Rankings", cats: ["rankings"] },
        { id: "experiments", label: "Experiments", cats: ["experiments"] },
        { id: "reports", label: "Reports", cats: ["reports"] },
        { id: "books", label: "Books", cats: ["books"] },
        { id: "founding", label: "Founding cases", cats: ["founding-cases"] }
      ].map(function (p) {
        p.test = function (i) { return p.cats.indexOf(i.category) !== -1; };
        return p;
      })
    },
    {
      key: "window", label: "Window", hasAll: false, defaultId: "all",
      pills: [
        { id: "7", label: "7 days", test: function (i) { return daysSince(i.date_found) <= 7; } },
        { id: "30", label: "30 days", test: function (i) { return daysSince(i.date_found) <= 30; } },
        { id: "90", label: "90 days", test: function (i) { return daysSince(i.date_found) <= 90; } },
        { id: "all", label: "All time", test: function () { return true; } }
      ]
    },
    {
      key: "region", label: "Facets", compoundStart: true,
      pills: [
        { id: "global", label: "Global", test: function (i) { return !GULF_REGIONS[i.region]; } },
        { id: "gulf", label: "Gulf & UAE", test: function (i) { return !!GULF_REGIONS[i.region]; } }
      ]
    },
    {
      key: "tier", label: null, compound: true,
      pills: [
        { id: "1", label: "Tier 1", test: function (i) { return i.tier === 1; } },
        { id: "2", label: "Tier 2", test: function (i) { return i.tier === 2; } }
      ]
    },
    {
      key: "kind", label: null, compound: true,
      pills: [
        { id: "report", label: "Reports", kinds: ["report", "policy"] },
        { id: "paper", label: "Papers", kinds: ["paper"] },
        { id: "post", label: "Posts", kinds: ["post", "podcast"] },
        { id: "news", label: "News", kinds: ["news"] },
        { id: "book", label: "Books", kinds: ["book"] },
        { id: "case", label: "Cases", kinds: ["case"] }
      ].map(function (p) {
        p.test = function (i) { return p.kinds.indexOf(i.kind) !== -1; };
        return p;
      })
    }
  ];

  var state = {};
  AXES.forEach(function (ax) { state[ax.key] = ax.defaultId || null; });

  function stateFromHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return;
    h.split("&").forEach(function (pair) {
      var kv = pair.split("=");
      var key = decodeURIComponent(kv[0] || "");
      var val = decodeURIComponent(kv[1] || "");
      AXES.forEach(function (ax) {
        if (ax.key !== key) return;
        var ok = ax.pills.some(function (p) { return p.id === val; });
        if (ok) state[key] = val;
      });
    });
  }

  function hashFromState() {
    var parts = [];
    AXES.forEach(function (ax) {
      var def = ax.defaultId || null;
      if (state[ax.key] !== def && state[ax.key] != null) {
        parts.push(encodeURIComponent(ax.key) + "=" + encodeURIComponent(state[ax.key]));
      }
    });
    var next = parts.length ? "#" + parts.join("&") : "";
    if (next !== location.hash) {
      try {
        history.replaceState(null, "", next || location.pathname.split("/").pop() || ".");
      } catch (e) {
        location.hash = next; /* file:// fallback in strict browsers */
      }
    }
  }

  function activePredicates() {
    var preds = [];
    AXES.forEach(function (ax) {
      var sel = state[ax.key];
      if (sel == null) return;
      ax.pills.forEach(function (p) {
        if (p.id === sel) preds.push(p.test);
      });
    });
    return preds;
  }

  function renderFilterBar(bar) {
    var html = "";
    var open = false;
    AXES.forEach(function (ax) {
      if (!ax.compound) {
        if (open) { html += "</div></div>"; open = false; }
        html += '<div class="filter-row"><span class="axis-label micro">' + esc(ax.label) + "</span>" +
                '<div class="pills">';
        open = true;
      } else {
        html += '<span class="pill-sep">&middot;</span>';
      }
      if (ax.hasAll) {
        html += pillHTML(ax.key, "__all", "All", state[ax.key] == null);
      }
      ax.pills.forEach(function (p) {
        html += pillHTML(ax.key, p.id, p.label, state[ax.key] === p.id);
      });
    });
    if (open) html += "</div></div>";
    bar.innerHTML = html;
  }

  function pillHTML(axisKey, id, label, active) {
    return '<button type="button" class="pill' + (active ? " pill--active" : "") +
      '" data-axis="' + esc(axisKey) + '" data-pill="' + esc(id) + '">' + esc(label) + "</button>";
  }

  function initActivity() {
    var bar = document.getElementById("filter-bar");
    var feedEl = document.getElementById("feed");
    var countsEl = document.getElementById("counts-line");
    var digestEl = document.getElementById("digest-label");
    if (digestEl && META.last_scan) {
      digestEl.textContent = "Latest digest · " + isoWeek(META.last_scan) + " · Last scan · " + META.last_scan;
    }

    stateFromHash();

    function render() {
      var preds = activePredicates();
      var visible = sortItems(ITEMS.filter(function (i) {
        return preds.every(function (t) { return t(i); });
      }));
      renderFeed(feedEl, visible,
        "No items in window — widen the window, clear a facet, or run a scan.");
      var t1 = 0, t2 = 0, unt = 0;
      visible.forEach(function (i) {
        if (i.tier === 1) t1++; else t2++;
        if (i.needs_review) unt++;
      });
      countsEl.innerHTML =
        "<span>" + t1 + " tier-1 items &middot; " + t2 + " tier-2 items &middot; " +
        unt + " untriaged in window</span>" +
        "<span>Last scan &middot; " + esc(META.last_scan || "never") + "</span>";
      renderFilterBar(bar);
      hashFromState();
    }

    bar.addEventListener("click", function (ev) {
      var btn = ev.target.closest(".pill");
      if (!btn) return;
      var axis = btn.getAttribute("data-axis");
      var pill = btn.getAttribute("data-pill");
      var ax = AXES.filter(function (a) { return a.key === axis; })[0];
      if (!ax) return;
      if (pill === "__all") {
        state[axis] = null;
      } else if (state[axis] === pill) {
        state[axis] = ax.defaultId && ax.defaultId === pill ? pill : (ax.defaultId || null);
      } else {
        state[axis] = pill;
      }
      render();
    });

    window.addEventListener("hashchange", function () {
      AXES.forEach(function (ax) { state[ax.key] = ax.defaultId || null; });
      stateFromHash();
      render();
    });

    render();
  }

  /* ---------- home page ---------- */

  function initHome() {
    var tiles = document.getElementById("stat-tiles");
    if (tiles) {
      var counts = { ongoing: 0, strategic: 0, founding: 0 };
      var last30 = 0, unt = 0;
      ITEMS.forEach(function (i) {
        if (counts[i.layer] != null) counts[i.layer]++;
        if (daysSince(i.date_found) <= 30) last30++;
        if (i.needs_review) unt++;
      });
      var tile = function (num, label) {
        return '<div class="stat-tile"><div class="num">' + num +
               '</div><div class="lbl micro">' + esc(label) + "</div></div>";
      };
      tiles.innerHTML =
        tile(ENTITIES.length, "Entities tracked") +
        tile(counts.ongoing, "Items · ongoing") +
        tile(counts.strategic, "Items · strategic core") +
        tile(counts.founding, "Items · founding") +
        tile(last30, "Found in last 30 days") +
        tile(unt, "Untriaged");
    }
    var homeFeed = document.getElementById("home-feed");
    if (homeFeed) {
      renderFeed(homeFeed, sortItems(ITEMS).slice(0, 5), "No items yet — run a scan.");
    }
  }

  /* ---------- sources page ---------- */

  var CATALOG_ORDER = {
    ongoing: ["thinkers", "observatories"],
    strategic: ["assessment", "credentialing", "reports", "books"],
    founding: ["founding-cases", "uae-regulatory", "gulf-strategy", "rankings", "experiments"]
  };

  function initSources() {
    var root = document.getElementById("catalog");
    if (!root) return;
    var countsEl = document.getElementById("catalog-counts");
    var trackedCount = Object.keys(trackedEntityIds).length;
    if (countsEl) {
      countsEl.textContent = ENTITIES.length + " entities · " +
        SOURCES.filter(function (s) { return s.rss && s.active; }).length +
        " tracked feeds · " + trackedCount + " entities with live coverage";
    }

    var html = "";
    ["ongoing", "strategic", "founding"].forEach(function (layer) {
      var layerEntities = ENTITIES.filter(function (e) { return e.layer === layer; });
      if (!layerEntities.length) return;
      html += '<div class="layer-section">' +
        '<div class="section-head"><h2>' + esc(LAYER_LABELS[layer]) + "</h2>" +
        '<span class="micro">' + layerEntities.length + " entities</span></div>" +
        '<p class="layer-desc">' + esc(LAYER_DESCRIPTIONS[layer]) + "</p>";
      CATALOG_ORDER[layer].forEach(function (cat) {
        var group = layerEntities.filter(function (e) { return e.category === cat; });
        if (!group.length) return;
        group.sort(function (a, b) {
          if (a.tier !== b.tier) return a.tier - b.tier;
          return a.name < b.name ? -1 : 1;
        });
        html += '<div class="cat-group"><h3>' + esc(CATEGORY_LABELS[cat] || cat) + "</h3>";
        group.forEach(function (e) {
          var tracked = trackedEntityIds[e.id];
          html += '<div class="entity-row">' +
            '<div class="entity-main">' +
              '<a class="entity-title" href="' + esc(e.home_url) + '" target="_blank" rel="noopener">' + esc(e.name) + "</a>" +
              '<span class="micro">' + esc(e.type) + " · " + esc(e.region) + "</span>" +
            "</div>" +
            '<div class="badges">' +
              '<span class="badge' + (e.tier === 1 ? " badge--tier1" : "") + '">TIER ' + e.tier + "</span>" +
              (tracked
                ? '<span class="badge badge--tracked">TRACKED (RSS)</span>'
                : '<span class="badge badge--manual">MANUAL</span>') +
            "</div>" +
            '<p class="entity-note">' + esc(e.note) + "</p>" +
          "</div>";
        });
        html += "</div>";
      });
      html += "</div>";
    });
    root.innerHTML = html;
  }

  /* ---------- about page ---------- */

  function initAbout() {
    var set = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    var unt = ITEMS.filter(function (i) { return i.needs_review; }).length;
    set("st-baseline", "V" + (META.baseline_version || "?"));
    set("st-date", META.baseline_date || "—");
    set("st-scan", META.last_scan || "never");
    set("st-entities", String(ENTITIES.length));
    set("st-sources", SOURCES.filter(function (s) { return s.rss && s.active; }).length + " tracked / " + SOURCES.length + " total");
    set("st-items", String(ITEMS.length));
    set("st-untriaged", String(unt));
  }

  /* ---------- dispatch ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    fillFooter();
    var page = document.body.getAttribute("data-page");
    if (page === "activity") initActivity();
    else if (page === "home") initHome();
    else if (page === "sources") initSources();
    else if (page === "about") initAbout();
  });
})();
