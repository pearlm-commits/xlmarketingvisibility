/* ============================================================================
   XL Marketing — site search
   Self-contained. Add <script src="/search.js" defer></script> before </body>.
   - On normal pages: injects a nav trigger + a Cmd/Ctrl-K search overlay.
   - On /search (any page with #xl-search-results): renders results inline,
     reads/writes the ?q= query string.
   No dependencies. Index: /search-index.json
   ========================================================================== */
(function () {
  'use strict';

  var INDEX_URL = '/search-index.json';
  var RECENT_KEY = 'xl:recent-searches';
  var MAX_RECENT = 6;
  var PLACEHOLDER = 'Try “my AI visibility report”';

  // Curated fallback suggestions (shown when the box is empty and there is
  // no per-page context / recent history). Replace with real popular queries
  // once analytics can inform them.
  var POPULAR = [
    '/diagnostics/ai-visibility',
    '/working-with-us',
    '/decision-led-growth',
    '/services'
  ];

  var SECTION_ORDER = ['Diagnostics', 'Services', 'Method', 'Insights', 'Company', 'Home'];

  var index = null;
  var indexPromise = null;
  var overlay = null;
  var inputEl = null;
  var resultsEl = null;
  var statusEl = null;
  var lastTrigger = null;
  var activeIdx = -1;
  var flatResults = [];

  /* ---------- data ---------------------------------------------------------- */

  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = fetch(INDEX_URL, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { pages: [] }; })
      .then(function (data) { index = (data && data.pages) || []; return index; })
      .catch(function () { index = []; return index; });
    return indexPromise;
  }

  function getRecent() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
    } catch (e) { return []; }
  }

  function pushRecent(q) {
    q = (q || '').trim();
    if (q.length < 2) return;
    try {
      var arr = getRecent().filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      arr.unshift(q);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
    } catch (e) { /* private mode — ignore */ }
  }

  function clearRecent() {
    try { localStorage.removeItem(RECENT_KEY); } catch (e) {}
  }

  /* ---------- matching ---------------------------------------------------- */

  function norm(s) {
    return (s || '').toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ');
  }

  function scorePage(page, tokens, rawQuery) {
    var title = norm(page.title);
    var kw = norm(page.keywords);
    var sum = norm(page.summary);
    var hay = title + ' • ' + kw + ' • ' + sum;
    var rq = norm(rawQuery).trim();

    // every token must appear somewhere
    for (var i = 0; i < tokens.length; i++) {
      if (hay.indexOf(tokens[i]) === -1) return 0;
    }

    var score = 0;
    if (rq && kw.indexOf(rq) !== -1) score += 100;          // exact phrase in keywords
    if (rq && title === rq) score += 120;                    // exact title
    if (rq && title.indexOf(rq) === 0) score += 60;          // title prefix
    if (rq && title.indexOf(rq) !== -1) score += 30;         // title contains phrase

    tokens.forEach(function (t) {
      if (title.indexOf(t) === 0 || title.indexOf(' ' + t) !== -1) score += 12;
      else if (title.indexOf(t) !== -1) score += 8;
      if (kw.indexOf(t) !== -1) score += 5;
      if (sum.indexOf(t) !== -1) score += 2;
    });
    return score;
  }

  function search(query) {
    if (!index) return [];
    var rq = query.trim();
    if (!rq) return [];
    var tokens = norm(rq).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return index
      .map(function (p) { return { page: p, score: scorePage(p, tokens, rq) }; })
      .filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (x) { return x.page; });
  }

  function byUrl(url) {
    for (var i = 0; i < (index || []).length; i++) {
      if (index[i].url === url) return index[i];
    }
    return null;
  }

  /* ---------- rendering ------------------------------------------------------ */

  function groupBySection(pages) {
    var groups = {};
    pages.forEach(function (p) {
      (groups[p.section] = groups[p.section] || []).push(p);
    });
    return SECTION_ORDER
      .filter(function (s) { return groups[s]; })
      .map(function (s) { return { section: s, pages: groups[s] }; });
  }

  function resultItemHTML(page, query) {
    return (
      '<a class="xls-item" href="' + page.url + '" data-url="' + page.url + '">' +
        '<span class="xls-item-title">' + highlight(page.title, query) + '</span>' +
        '<span class="xls-item-sum">' + highlight(page.summary, query) + '</span>' +
      '</a>'
    );
  }

  function highlight(text, query) {
    var esc = escapeHTML(text);
    var rq = (query || '').trim();
    if (rq.length < 2) return esc;
    try {
      var re = new RegExp('(' + rq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return esc.replace(re, '<mark>$1</mark>');
    } catch (e) { return esc; }
  }

  function escapeHTML(s) {
    return (s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function contextEmptyState() {
    var path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    var siblings = [];
    var label = '';
    if (/^\/journal\/./.test(path)) {
      label = 'More from Meridian Insights';
      siblings = (index || []).filter(function (p) {
        return p.section === 'Insights' && p.url !== path && p.url !== '/journal';
      }).slice(0, 5);
    } else if (/^\/services\/./.test(path)) {
      label = 'Other services';
      siblings = (index || []).filter(function (p) {
        return p.section === 'Services' && p.url !== path && p.url !== '/services';
      });
    }
    return { label: label, pages: siblings };
  }

  function renderEmpty() {
    var recent = getRecent();
    var ctx = contextEmptyState();
    var html = '';

    if (recent.length) {
      html += '<div class="xls-group">' +
        '<div class="xls-group-head"><span class="xls-label">Recent</span>' +
        '<button type="button" class="xls-clear" data-action="clear-recent">Clear</button></div>' +
        '<div class="xls-chips">' +
          recent.map(function (q) {
            return '<button type="button" class="xls-chip" data-q="' + escapeHTML(q) + '">' + escapeHTML(q) + '</button>';
          }).join('') +
        '</div></div>';
    }

    if (ctx.pages.length) {
      html += '<div class="xls-group"><span class="xls-label">' + ctx.label + '</span>' +
        ctx.pages.map(function (p) { return resultItemHTML(p, ''); }).join('') + '</div>';
    }

    var pop = POPULAR.map(byUrl).filter(Boolean);
    if (pop.length) {
      html += '<div class="xls-group"><span class="xls-label">' +
        (recent.length || ctx.pages.length ? 'Popular' : 'Start here') + '</span>' +
        pop.map(function (p) { return resultItemHTML(p, ''); }).join('') + '</div>';
    }

    resultsEl.innerHTML = html;
    rebuildFlat();
    setStatus('');
  }

  function renderResults(query) {
    var matches = search(query);
    if (!matches.length) {
      resultsEl.innerHTML = '<div class="xls-none">No pages match “' + escapeHTML(query.trim()) +
        '”.<br><span>Try a service name, a topic, or “pricing”.</span></div>';
      flatResults = [];
      activeIdx = -1;
      setStatus('No results');
      return;
    }
    var groups = groupBySection(matches);
    resultsEl.innerHTML = groups.map(function (g) {
      return '<div class="xls-group"><span class="xls-label">' + g.section + '</span>' +
        g.pages.map(function (p) { return resultItemHTML(p, query); }).join('') + '</div>';
    }).join('');
    rebuildFlat();
    activeIdx = flatResults.length ? 0 : -1;
    paintActive();
    setStatus(matches.length + (matches.length === 1 ? ' result' : ' results'));
  }

  function rebuildFlat() {
    flatResults = Array.prototype.slice.call(resultsEl.querySelectorAll('.xls-item'));
  }

  function paintActive() {
    flatResults.forEach(function (el, i) {
      el.classList.toggle('is-active', i === activeIdx);
      if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function setStatus(txt) { if (statusEl) statusEl.textContent = txt; }

  function applyQuery(q) {
    if (!index) {
      loadIndex().then(function () { applyQuery(inputEl ? inputEl.value : q); });
      return;
    }
    if (q.trim()) renderResults(q); else renderEmpty();
  }

  function runQuery(q) {
    if (inputEl) inputEl.value = q;
    applyQuery(q);
  }

  /* ---------- overlay lifecycle ------------------------------------------- */

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'xls-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search XL Marketing');
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="xls-panel">' +
        '<div class="xls-inputwrap">' +
          '<svg class="xls-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
            '<line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          '<input type="search" class="xls-input" autocomplete="off" autocorrect="off" spellcheck="false" ' +
            'placeholder="' + PLACEHOLDER + '" aria-label="Search" />' +
          '<button type="button" class="xls-esc" data-action="close" aria-label="Close search">esc</button>' +
        '</div>' +
        '<div class="xls-results" id="xls-results"></div>' +
        '<div class="xls-foot"><span id="xls-status" aria-live="polite"></span>' +
          '<span class="xls-hint"><kbd>&uarr;</kbd><kbd>&darr;</kbd> to navigate &nbsp; <kbd>&crarr;</kbd> to open</span></div>' +
      '</div>';
    document.body.appendChild(overlay);

    inputEl = overlay.querySelector('.xls-input');
    resultsEl = overlay.querySelector('.xls-results');
    statusEl = overlay.querySelector('#xls-status');

    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeOverlay();
    });
    overlay.addEventListener('click', onResultsClick);
    inputEl.addEventListener('input', function () { applyQuery(inputEl.value); });
    inputEl.addEventListener('keydown', onInputKeydown);
  }

  function onResultsClick(e) {
    var chip = e.target.closest('[data-q]');
    if (chip) { e.preventDefault(); runQuery(chip.getAttribute('data-q')); inputEl.focus(); return; }
    var clr = e.target.closest('[data-action="clear-recent"]');
    if (clr) { e.preventDefault(); clearRecent(); renderEmpty(); return; }
    var close = e.target.closest('[data-action="close"]');
    if (close) { e.preventDefault(); closeOverlay(); return; }
    var item = e.target.closest('.xls-item');
    if (item) { pushRecent(inputEl.value); /* allow normal navigation */ }
  }

  function onInputKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!flatResults.length) return;
      activeIdx = (activeIdx + 1) % flatResults.length;
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flatResults.length) return;
      activeIdx = (activeIdx - 1 + flatResults.length) % flatResults.length;
      paintActive();
    } else if (e.key === 'Enter') {
      var hasQuery = inputEl.value.trim().length > 0;
      if (!hasQuery && activeIdx < 0) return; // don't jump from an empty box
      var target = flatResults[activeIdx] || flatResults[0];
      if (target) {
        e.preventDefault();
        pushRecent(inputEl.value);
        window.location.href = target.getAttribute('href');
      }
    }
  }

  function openOverlay(prefill) {
    if (!overlay) buildOverlay();
    lastTrigger = document.activeElement;
    overlay.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(function () { overlay.classList.add('is-open'); });
    inputEl.value = prefill || '';
    resultsEl.innerHTML = '';
    loadIndex().then(function () { applyQuery(inputEl.value); });
    inputEl.focus();
  }

  function closeOverlay() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    setTimeout(function () { overlay.hidden = true; }, 160);
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
  }

  /* ---------- injection: nav trigger + footer link ---------------------- */

  function injectTrigger() {
    var navLinks = document.querySelector('.nav-links');
    if (navLinks && !navLinks.querySelector('.xls-trigger')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xls-trigger';
      btn.setAttribute('aria-label', 'Search');
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
        '<line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<span class="xls-trigger-label">Search</span><kbd class="xls-trigger-kbd">/</kbd>';
      var cta = navLinks.querySelector('.nav-cta');
      if (cta) navLinks.insertBefore(btn, cta);
      else navLinks.appendChild(btn);
      btn.addEventListener('click', function () { openOverlay(); });
    }
    var footerLinks = document.querySelector('.footer-links');
    if (footerLinks && !footerLinks.querySelector('[data-xls-footer]')) {
      var a = document.createElement('a');
      a.href = '/search';
      a.textContent = 'Search';
      a.setAttribute('data-xls-footer', '');
      footerLinks.appendChild(a);
    }
  }

  /* ---------- inline mode (/search) ------------------------------------- */

  function initInline(container) {
    resultsEl = container;
    inputEl = document.getElementById('xl-search-input');
    statusEl = document.getElementById('xl-search-status');
    if (!inputEl) return;
    inputEl.placeholder = PLACEHOLDER;

    var params = new URLSearchParams(location.search);
    var q0 = params.get('q') || '';

    inputEl.addEventListener('input', function () {
      var q = inputEl.value;
      var u = new URL(location.href);
      if (q.trim()) u.searchParams.set('q', q); else u.searchParams.delete('q');
      history.replaceState(null, '', u);
      applyQuery(q);
    });
    inputEl.addEventListener('keydown', onInputKeydown);
    container.addEventListener('click', onResultsClick);

    loadIndex().then(function () {
      inputEl.value = q0 || '';
      applyQuery(inputEl.value);
      if (q0) inputEl.focus();
    });
  }

  /* ---------- styles ---------------------------------------------------- */

  function injectStyles() {
    if (document.getElementById('xls-styles')) return;
    var css = [
      ':root{--xls-forest:var(--forest,#1E3D2B);--xls-ink:var(--ink,#14110F);--xls-muted:var(--muted,#5B625D);',
      '--xls-border:var(--border-mid,#D8CDB8);--xls-paper:var(--paper,#FFFFFF);--xls-ivory:var(--ivory,#FFFBF1);',
      '--xls-ember:var(--ember,#C1442A);--xls-lemon:var(--lemon,#F2E14D);--xls-grey:var(--grey,#F4F5F6);}',

      '.xls-trigger{display:inline-flex;align-items:center;gap:7px;font-family:Inter,sans-serif;font-size:13px;',
      'font-weight:500;color:var(--xls-muted);background:transparent;border:1px solid var(--xls-border);',
      'border-radius:999px;padding:6px 12px;cursor:pointer;transition:color .15s,border-color .15s;line-height:1;}',
      '.xls-trigger:hover{color:var(--xls-forest);border-color:var(--xls-forest);}',
      '.xls-trigger svg{flex-shrink:0;}',
      '.xls-trigger-kbd{font-family:"IBM Plex Mono",monospace;font-size:11px;border:1px solid var(--xls-border);',
      'border-radius:4px;padding:0 5px;color:var(--xls-muted);}',
      '@media(max-width:600px){.xls-trigger-label,.xls-trigger-kbd{display:none;}.xls-trigger{padding:7px;}}',

      '.xls-overlay{position:fixed;inset:0;z-index:1000;background:rgba(20,17,15,.44);',
      'display:flex;align-items:flex-start;justify-content:center;padding:12vh 20px 20px;opacity:0;',
      'transition:opacity .16s ease;-webkit-font-smoothing:antialiased;}',
      '.xls-overlay.is-open{opacity:1;}',
      '.xls-panel{width:100%;max-width:600px;background:var(--xls-paper);border:1px solid var(--xls-border);',
      'border-radius:4px;box-shadow:0 24px 60px rgba(20,17,15,.28);display:flex;flex-direction:column;',
      'max-height:72vh;overflow:hidden;transform:translateY(-8px);transition:transform .16s ease;}',
      '.xls-overlay.is-open .xls-panel{transform:translateY(0);}',

      '.xls-inputwrap{display:flex;align-items:center;gap:10px;padding:16px 16px;border-bottom:1px solid var(--xls-border);}',
      '.xls-icon{color:var(--xls-muted);flex-shrink:0;}',
      '.xls-input{flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;',
      'font-size:17px;color:var(--xls-ink);padding:2px 0;min-width:0;}',
      '.xls-input::placeholder{color:var(--xls-muted);opacity:.75;}',
      '.xls-input::-webkit-search-cancel-button{-webkit-appearance:none;}',
      '.xls-esc{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;',
      'color:var(--xls-muted);background:transparent;border:1px solid var(--xls-border);border-radius:4px;',
      'padding:4px 8px;cursor:pointer;flex-shrink:0;}',
      '.xls-esc:hover{color:var(--xls-forest);border-color:var(--xls-forest);}',

      '.xls-results{overflow-y:auto;padding:8px;flex:1;}',
      '.xls-group{padding:6px 4px 10px;}',
      '.xls-group-head{display:flex;align-items:center;justify-content:space-between;}',
      '.xls-label{display:block;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.14em;',
      'text-transform:uppercase;color:var(--xls-muted);padding:6px 8px;}',
      '.xls-clear{font-family:Inter,sans-serif;font-size:11px;color:var(--xls-muted);background:transparent;',
      'border:none;cursor:pointer;padding:6px 8px;text-decoration:underline;}',
      '.xls-clear:hover{color:var(--xls-ember);}',

      '.xls-item{display:block;padding:10px 12px;border-radius:3px;text-decoration:none;color:inherit;}',
      '.xls-item:hover,.xls-item.is-active{background:var(--xls-ivory);}',
      '.xls-item.is-active{box-shadow:inset 3px 0 0 var(--xls-lemon);}',
      '.xls-item-title{display:block;font-family:"Playfair Display",Georgia,serif;font-size:16px;font-weight:500;',
      'color:var(--xls-forest);line-height:1.3;margin-bottom:2px;}',
      '.xls-item-sum{display:block;font-family:Inter,sans-serif;font-size:12.5px;color:var(--xls-muted);',
      'line-height:1.55;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}',
      '.xls-item mark{background:var(--xls-lemon);color:var(--xls-ink);padding:0 1px;border-radius:2px;}',

      '.xls-chips{display:flex;flex-wrap:wrap;gap:6px;padding:2px 8px;}',
      '.xls-chip{font-family:Inter,sans-serif;font-size:12.5px;color:var(--xls-forest);background:var(--xls-grey);',
      'border:1px solid var(--xls-border);border-radius:999px;padding:5px 12px;cursor:pointer;}',
      '.xls-chip:hover{border-color:var(--xls-forest);}',

      '.xls-none{padding:26px 16px;text-align:center;font-family:Inter,sans-serif;font-size:14px;color:var(--xls-ink);line-height:1.6;}',
      '.xls-none span{color:var(--xls-muted);font-size:12.5px;}',

      '.xls-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;',
      'border-top:1px solid var(--xls-border);font-family:Inter,sans-serif;font-size:11px;color:var(--xls-muted);}',
      '.xls-hint{display:flex;align-items:center;gap:2px;}',
      '.xls-foot kbd{font-family:"IBM Plex Mono",monospace;font-size:10px;border:1px solid var(--xls-border);',
      'border-radius:3px;padding:1px 4px;margin:0 1px;color:var(--xls-muted);}',
      '@media(max-width:520px){.xls-hint{display:none;}.xls-overlay{padding-top:8vh;}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'xls-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ---------- boot ----------------------------------------------------- */

  function boot() {
    injectStyles();
    var inlineContainer = document.getElementById('xl-search-results');
    if (inlineContainer) {
      loadIndex();
      initInline(inlineContainer);
      return; // no overlay on the dedicated search page
    }
    injectTrigger();

    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openOverlay(); return; }
      if (e.key === '/' && !isTyping(e.target)) { e.preventDefault(); openOverlay(); }
    });
  }

  function isTyping(el) {
    if (!el) return false;
    var t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || el.isContentEditable;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
