/* =====================================================================
   POST /.netlify/functions/subscribe
   Adds (or updates) a diagnostic lead in MailerLite.

   Called by the three diagnostics when a visitor submits their details:
     /diagnostics/ai-visibility        → tool omitted  → "visibility"
     /diagnostics/marketing-readiness  → tool "readiness"
     /diagnostics/wellness-growth      → tool "wellness-growth"

   Set these in Netlify → Site configuration → Environment variables
   (never in this file):
     MAILERLITE_API_KEY           required. MailerLite → Integrations → API.
     MAILERLITE_GROUP_VISIBILITY  optional group ID for AI Visibility leads
     MAILERLITE_GROUP_READINESS   optional group ID for Marketing Readiness leads
     MAILERLITE_GROUP_WELLNESS    optional group ID for Wellness leads
     MAILERLITE_GROUP_ALL         optional group ID every lead is added to

   The "free guide" emails are MailerLite automations triggered by a
   subscriber joining a group, so each diagnostic's group ID needs to be
   set for its guide to send.

   Uses the current MailerLite API (connect.mailerlite.com). The upsert
   endpoint is non-destructive: an existing subscriber keeps their other
   groups and data.
   ===================================================================== */

const API_URL = 'https://connect.mailerlite.com/api/subscribers';

const TOOLS = {
  visibility: 'MAILERLITE_GROUP_VISIBILITY',
  readiness: 'MAILERLITE_GROUP_READINESS',
  'wellness-growth': 'MAILERLITE_GROUP_WELLNESS'
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* Only accept requests from this site's own pages (live domain, Netlify
   previews, local dev). Blocks other sites from posting sign-ups here. */
function allowedOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true; // same-origin fetches from some browsers omit it
  try {
    const { hostname } = new URL(origin);
    return hostname === 'xluxemarketing.com' ||
      hostname === 'www.xluxemarketing.com' ||
      hostname.endsWith('--xlai-visibility-audit.netlify.app') ||
      hostname === 'xlai-visibility-audit.netlify.app' ||
      hostname === 'localhost';
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!allowedOrigin(req)) return json(403, { ok: false, error: 'Forbidden' });

  const apiKey = process.env.MAILERLITE_API_KEY;
  if (!apiKey) {
    console.error('subscribe: MAILERLITE_API_KEY is not set');
    return json(500, { ok: false, error: 'Not configured' });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'Invalid email' });

  const tool = TOOLS[data.tool] ? data.tool : 'visibility';
  const groups = [process.env[TOOLS[tool]], process.env.MAILERLITE_GROUP_ALL].filter(Boolean);

  /* Only MailerLite's built-in fields, so this works without creating
     custom fields first. The diagnostic itself is identified by group. */
  const fields = {};
  const name = clean(data.name, 100);
  const company = clean(data.company || data.business, 150);
  if (name) fields.name = name;
  if (company) fields.company = company;

  const body = { email, fields };
  if (groups.length) body.groups = groups;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`subscribe: MailerLite ${res.status} for tool=${tool}: ${detail.slice(0, 500)}`);
      return json(502, { ok: false, error: 'Subscription failed' });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('subscribe: request to MailerLite failed', err);
    return json(502, { ok: false, error: 'Subscription failed' });
  }
};
