/* =====================================================================
   XL diagnostics: save-and-resume + funnel analytics
   Shared by /diagnostics/ai-visibility, /diagnostics/marketing-readiness
   and /diagnostics/wellness-growth.

   - Progress (answers + the non-personal setup questions) is saved to
     the visitor's own browser as they go, so leaving mid-way and coming
     back to the page offers "Continue where you left off".
   - "Finish later" gives a resume link that carries the same progress in
     the URL, so it also works on another device. The link can be copied
     or emailed to yourself (mailto: — opens the visitor's own mail app;
     nothing is sent by us). No name, email or company is ever stored in
     the browser or put in the link.
   - track() sends GA4 events only when the visitor has accepted analytics
     cookies (window.gtag is defined by /consent.js only after consent).
   ===================================================================== */
(function () {
  var PREFIX = 'xl-diag:';
  var MAX_AGE_DAYS = 30;

  function track(name, params) {
    try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (e) {}
  }

  function save(key, data) {
    try {
      data.savedAt = Date.now();
      localStorage.setItem(PREFIX + key, JSON.stringify(data));
    } catch (e) {}
  }

  function load(key) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.savedAt || Date.now() - data.savedAt > MAX_AGE_DAYS * 864e5) {
        localStorage.removeItem(PREFIX + key);
        return null;
      }
      return data;
    } catch (e) { return null; }
  }

  function clear(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }

  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
  }

  /* Resume link: same page, ?resume=<base64url JSON>. */
  function resumeLink(key, data) {
    var payload = { k: key, c: data.current, a: data.answers, x: data.context };
    return location.origin + location.pathname + '?resume=' + b64urlEncode(JSON.stringify(payload));
  }

  /* Reads ?resume= for this key, strips it from the address bar, and
     returns { current, answers, context } or null. Validation of the
     values themselves is the page's job (it knows the questions). */
  function readResumeParam(key) {
    try {
      var params = new URLSearchParams(location.search);
      var raw = params.get('resume');
      if (!raw) return null;
      params.delete('resume');
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      var p = JSON.parse(b64urlDecode(raw));
      if (!p || p.k !== key) return null;
      return { current: p.c, answers: p.a || {}, context: p.x || {} };
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── UI ─────────────────────────────────────────────────────────── */
  var css = [
    '.xl-resume{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;background:var(--ivory,#FFFBF1);border:1px solid var(--border-mid,#D8CDB8);border-left:3px solid var(--forest,#1E3D2B);padding:16px 18px;margin-bottom:20px}',
    '.xl-resume p{margin:0;font-size:14px;line-height:1.5;color:var(--ink,#14110F)}',
    '.xl-resume p strong{color:var(--forest,#1E3D2B)}',
    '.xl-resume-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '.xl-link-btn{background:none;border:none;padding:0;font:inherit;font-size:13px;color:var(--muted,#5B625D);text-decoration:underline;cursor:pointer}',
    '.xl-link-btn:hover{color:var(--forest,#1E3D2B)}',
    '.xl-later{text-align:center;margin-top:18px}',
    '.xl-later-panel{display:none;text-align:left;background:var(--ivory,#FFFBF1);border:1px solid var(--border-mid,#D8CDB8);padding:16px 18px;margin-top:12px}',
    '.xl-later-panel.show{display:block}',
    '.xl-later-panel p{font-size:13px;line-height:1.6;color:var(--ink,#14110F);margin:0 0 12px}',
    '.xl-resume .btn,.xl-later-panel .btn{padding:9px 18px;font-size:13px;text-decoration:none}',
    '.xl-copied{font-size:12px;color:var(--forest,#1E3D2B);margin-left:6px}',
    '@media print{.xl-resume,.xl-later{display:none!important}}'
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* Banner offering to continue saved progress. opts: { question, total, onContinue, onRestart } */
  function mountResumeBanner(slot, opts) {
    if (!slot) return;
    slot.innerHTML =
      '<div class="xl-resume" role="status">' +
        '<p><strong>Welcome back.</strong> You stopped at question ' + opts.question + ' of ' + opts.total + '. Your answers are saved.</p>' +
        '<div class="xl-resume-actions">' +
          '<button type="button" class="btn btn-primary" data-act="continue">Continue where I left off &rarr;</button>' +
          '<button type="button" class="xl-link-btn" data-act="restart">Start over</button>' +
        '</div>' +
      '</div>';
    slot.querySelector('[data-act="continue"]').onclick = function () { slot.innerHTML = ''; opts.onContinue(); };
    slot.querySelector('[data-act="restart"]').onclick = function () { slot.innerHTML = ''; opts.onRestart(); };
  }

  /* "Finish later" link + panel under the quiz. getLink() returns the resume URL. */
  function mountFinishLater(slot, opts) {
    if (!slot) return;
    slot.innerHTML =
      '<div class="xl-later">' +
        '<button type="button" class="xl-link-btn" data-act="toggle">Need to stop? Finish later</button>' +
        '<div class="xl-later-panel" id="xl-later-panel">' +
          '<p>Your answers are saved on this device: come back to this page any time and pick up where you left off. To finish on another device, send yourself this link.</p>' +
          '<div class="xl-resume-actions">' +
            '<a class="btn btn-primary" data-act="email" href="#">Email me the link</a>' +
            '<button type="button" class="btn btn-ghost" data-act="copy">Copy link</button>' +
            '<span class="xl-copied" data-act="copied" hidden>Copied</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    var panel = slot.querySelector('.xl-later-panel');
    slot.querySelector('[data-act="toggle"]').onclick = function () {
      panel.classList.toggle('show');
      if (panel.classList.contains('show')) track('diagnostic_finish_later_open', { diagnostic: opts.name });
    };
    slot.querySelector('[data-act="email"]').onclick = function (e) {
      var link = opts.getLink();
      this.href = 'mailto:?subject=' + encodeURIComponent('Finish my ' + opts.title) +
        '&body=' + encodeURIComponent('Pick up where I left off:\n\n' + link + '\n');
      track('diagnostic_finish_later_link', { diagnostic: opts.name, method: 'email' });
    };
    slot.querySelector('[data-act="copy"]').onclick = function () {
      var link = opts.getLink();
      var done = function () {
        var c = slot.querySelector('[data-act="copied"]');
        c.hidden = false; setTimeout(function () { c.hidden = true; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); });
      } else {
        window.prompt('Copy this link:', link);
      }
      track('diagnostic_finish_later_link', { diagnostic: opts.name, method: 'copy' });
    };
  }

  window.XLDiag = {
    track: track, save: save, load: load, clear: clear,
    resumeLink: resumeLink, readResumeParam: readResumeParam, esc: esc,
    mountResumeBanner: mountResumeBanner, mountFinishLater: mountFinishLater
  };
})();
