/* XL Marketing Services — cookie/tracking consent banner + gated analytics loader.
   Loads Google Analytics and the Leadsy.ai visitor-ID pixel only after the
   visitor accepts, or immediately if they've already accepted previously.
   Respects the Global Privacy Control signal by treating it as a decline. */
(function () {
  var GA_ID = 'G-SXKT6Z7P78';
  var LEADSY_PID = 'IXhkLX0Vq0SNEFvX';
  var LEADSY_VERSION = '062024';
  var STORAGE_KEY = 'xl_consent';

  function getStoredConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setStoredConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* ignore */ }
  }

  var trackersLoaded = false;
  function loadTrackers() {
    if (trackersLoaded) return;
    trackersLoaded = true;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);

    var ga = document.createElement('script');
    ga.async = true;
    ga.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(ga);

    var leadsy = document.createElement('script');
    leadsy.id = 'vtag-ai-js';
    leadsy.async = true;
    leadsy.src = 'https://r2.leadsy.ai/tag.js';
    leadsy.dataset.pid = LEADSY_PID;
    leadsy.dataset.version = LEADSY_VERSION;
    document.head.appendChild(leadsy);
  }

  var STYLE = '\
    .xl-consent-bar{position:fixed;left:0;right:0;bottom:0;z-index:900;\
      display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px;\
      background:#1E3D2B;color:#FFFBF1;padding:16px 24px;\
      padding-bottom:calc(16px + env(safe-area-inset-bottom));\
      box-shadow:0 -2px 16px rgba(0,0,0,0.18);\
      font-family:Inter,system-ui,sans-serif;font-size:13.5px;line-height:1.5;\
      transform:translateY(100%);transition:transform .25s ease;}\
    .xl-consent-bar.is-visible{transform:translateY(0);}\
    .xl-consent-text{max-width:560px;color:#FFFBF1;}\
    .xl-consent-text a{color:#FFFBF1;text-decoration:underline;}\
    .xl-consent-actions{display:flex;gap:10px;flex-wrap:wrap;flex-shrink:0;}\
    .xl-consent-btn{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:700;\
      padding:9px 20px;border-radius:999px;white-space:nowrap;cursor:pointer;border:none;}\
    .xl-consent-accept{background:#C1442A;color:#fff;}\
    .xl-consent-accept:hover{background:#922A20;}\
    .xl-consent-decline{background:transparent;color:#FFFBF1;border:1.5px solid rgba(255,255,255,0.55);}\
    .xl-consent-decline:hover{background:rgba(255,255,255,0.12);}\
    @media (max-width:600px){.xl-consent-bar{justify-content:flex-start;text-align:left;}}\
  ';

  var barEl = null;

  function injectStyle() {
    if (document.getElementById('xl-consent-style')) return;
    var style = document.createElement('style');
    style.id = 'xl-consent-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function toggleStickyCta(hide) {
    var sticky = document.getElementById('sticky-cta');
    if (!sticky) return;
    if (hide) sticky.style.setProperty('display', 'none', 'important');
    else sticky.style.removeProperty('display');
  }

  function hideBanner() {
    if (!barEl) return;
    barEl.classList.remove('is-visible');
    toggleStickyCta(false);
  }

  function showBanner() {
    injectStyle();
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.className = 'xl-consent-bar';
      barEl.setAttribute('role', 'region');
      barEl.setAttribute('aria-label', 'Cookie consent');
      barEl.innerHTML =
        '<div class="xl-consent-text">We use cookies for site analytics and a visitor-identification pixel to spot prospective business customers. See our <a href="/privacy">Privacy Policy</a>.</div>' +
        '<div class="xl-consent-actions">' +
          '<button type="button" class="xl-consent-btn xl-consent-decline">Decline</button>' +
          '<button type="button" class="xl-consent-btn xl-consent-accept">Accept</button>' +
        '</div>';
      document.body.appendChild(barEl);

      barEl.querySelector('.xl-consent-accept').addEventListener('click', function () {
        setStoredConsent('granted');
        loadTrackers();
        hideBanner();
      });
      barEl.querySelector('.xl-consent-decline').addEventListener('click', function () {
        setStoredConsent('denied');
        hideBanner();
      });
    }
    toggleStickyCta(true);
    requestAnimationFrame(function () {
      barEl.classList.add('is-visible');
    });
  }

  function init() {
    var gpc = navigator.globalPrivacyControl === true;
    var stored = getStoredConsent();

    if (stored === 'granted') {
      loadTrackers();
      return;
    }
    if (stored === 'denied' || gpc) {
      return;
    }
    showBanner();
  }

  window.XLConsent = {
    open: showBanner,
    grant: function () { setStoredConsent('granted'); loadTrackers(); hideBanner(); },
    deny: function () { setStoredConsent('denied'); hideBanner(); },
    status: getStoredConsent
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
