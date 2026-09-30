/* =====================================================================
   POST /.netlify/functions/subscribe
   Adds a diagnostic lead to Sender (sender.net).

   Called by the three diagnostics when a visitor submits their details:
     /diagnostics/ai-visibility        → tool omitted  → "visibility"
     /diagnostics/marketing-readiness  → tool "readiness"
     /diagnostics/wellness-growth      → tool "wellness-growth"

   Set these in Netlify → Site configuration → Environment variables
   (never in this file):
     SENDER_API_TOKEN           required. Sender → Settings → API access tokens.
     SENDER_GROUP_VISIBILITY    group ID for AI Visibility leads
     SENDER_GROUP_READINESS     group ID for Marketing Readiness leads
     SENDER_GROUP_WELLNESS      group ID for Wellness leads
     SENDER_GROUP_ALL           optional group ID every lead is added to

   Delivering a guide (e.g. the AI visibility book) is a Sender
   automation whose starting trigger is "subscriber joins group", so the
   diagnostic's group ID must be set for it to send. A diagnostic with no
   group configured still adds the subscriber, just without a group.

   Flow: create the subscriber with their groups. If that fails (most
   often because they are already a subscriber), add the existing
   subscriber to each group instead, so returning visitors still get the
   automation.
   ===================================================================== */

const API = 'https://api.sender.net/v2';

const TOOLS = {
  visibility: 'SENDER_GROUP_VISIBILITY',
  readiness: 'SENDER_GROUP_READINESS',
  'wellness-growth': 'SENDER_GROUP_WELLNESS'
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

async function sender(path, token, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text: text.slice(0, 500) };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!allowedOrigin(req)) return json(403, { ok: false, error: 'Forbidden' });

  const token = process.env.SENDER_API_TOKEN;
  if (!token) {
    console.error('subscribe: SENDER_API_TOKEN is not set');
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
  const groups = [...new Set([process.env[TOOLS[tool]], process.env.SENDER_GROUP_ALL].filter(Boolean))];

  const [firstname, ...rest] = clean(data.name, 100).split(/\s+/).filter(Boolean);
  const subscriber = { email, trigger_automation: true };
  if (firstname) subscriber.firstname = firstname;
  if (rest.length) subscriber.lastname = rest.join(' ');
  if (groups.length) subscriber.groups = groups;

  try {
    const created = await sender('/subscribers', token, subscriber);
    if (created.ok) return json(200, { ok: true });

    if (!groups.length) {
      console.error(`subscribe: Sender ${created.status} creating subscriber (tool=${tool}): ${created.text}`);
      return json(502, { ok: false, error: 'Subscription failed' });
    }

    /* Likely an existing subscriber: add them to the group(s) directly. */
    let allOk = true;
    for (const groupId of groups) {
      const added = await sender(`/subscribers/groups/${encodeURIComponent(groupId)}`, token, {
        subscribers: [email],
        trigger_automation: true
      });
      if (!added.ok) {
        allOk = false;
        console.error(`subscribe: Sender ${added.status} adding to group ${groupId} (tool=${tool}; create returned ${created.status}: ${created.text}): ${added.text}`);
      }
    }
    return allOk ? json(200, { ok: true }) : json(502, { ok: false, error: 'Subscription failed' });
  } catch (err) {
    console.error('subscribe: request to Sender failed', err);
    return json(502, { ok: false, error: 'Subscription failed' });
  }
};
