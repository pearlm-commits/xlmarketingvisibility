/* =====================================================================
   POST /.netlify/functions/crm-lead
   Adds a contact-form enquiry to Zoho Bigin as a Contact.

   Called from /contact after the enquiry has been delivered by
   Formspree. Formspree stays the source of truth for the email; this is
   best-effort so a CRM problem never stops a visitor's enquiry.

   Set these in Netlify → Site configuration → Environment variables
   (never in this file):
     ZOHO_CLIENT_ID       required. Zoho API Console → Self Client.
     ZOHO_CLIENT_SECRET   required.
     ZOHO_REFRESH_TOKEN   required. Generated from the Self Client with a
                          scope that allows creating Contacts in Bigin.
     ZOHO_ACCOUNTS_URL    optional. Defaults to https://accounts.zoho.com.
                          Use your own data centre's accounts URL if not US.
     ZOHO_LEAD_TAG        optional. Tag added to each contact.
                          Defaults to "Website enquiry".

   Flow: exchange the refresh token for a short-lived access token, create
   the Contact (name, email, role, and the enquiry details in the
   description), then try to tag it.
   ===================================================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* Only accept requests from this site's own pages (live domain, Netlify
   previews, local dev). Blocks other sites from posting leads here. */
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

/* The access token lasts about an hour; reuse it while this function
   instance stays warm instead of refreshing on every enquiry. */
let cached = null;

async function getAccessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached;

  const accounts = (process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/+$/, '');
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const res = await fetch(`${accounts}/oauth/v2/token`, { method: 'POST', body: params });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`token refresh failed (${res.status}): ${body.error || 'no access_token'}`);
  }
  cached = {
    token: body.access_token,
    apiDomain: (body.api_domain || 'https://www.zohoapis.com').replace(/\/+$/, ''),
    expires: Date.now() + (Number(body.expires_in) || 3600) * 1000
  };
  return cached;
}

async function bigin(auth, path, init = {}) {
  const res = await fetch(`${auth.apiDomain}/bigin/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${auth.token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!allowedOrigin(req)) return json(403, { ok: false, error: 'Forbidden' });

  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET || !process.env.ZOHO_REFRESH_TOKEN) {
    console.error('crm-lead: ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN are not all set');
    return json(500, { ok: false, error: 'Not configured' });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON' });
  }

  if (clean(data['bot-field'])) return json(200, { ok: true }); // honeypot: pretend success

  const email = clean(data.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { ok: false, error: 'Invalid email' });

  const nameParts = clean(data.name, 100).split(/\s+/).filter(Boolean);
  const lastName = nameParts.pop() || email;
  const firstName = nameParts.join(' ');

  const details = [
    ['Enquiry type', clean(data.form_type, 100)],
    ['Package', clean(data.package_interest, 150)],
    ['Organisation', clean(data.organisation, 150)],
    ['Website', clean(data.website_url, 200)],
    ['Decision timeline', clean(data.decision_timeline, 100)],
    ['Heard about us', clean(data.referral_source, 100)],
    ['Business challenge', clean(data.business_challenge, 4000)],
    ['Buyer questions', clean(data.buyer_questions, 4000)]
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n\n');

  const contact = { Last_Name: lastName, Email: email };
  if (firstName) contact.First_Name = firstName;
  const role = clean(data.role, 100);
  if (role) contact.Title = role;
  if (details) contact.Description = details;

  try {
    const auth = await getAccessToken();
    const created = await bigin(auth, '/Contacts', {
      method: 'POST',
      body: JSON.stringify({ data: [contact] })
    });
    const row = created.body && created.body.data && created.body.data[0];

    /* Already in the CRM (matched on a unique field such as email): that is
       fine, the enquiry itself still reached the team through Formspree. */
    if (row && row.code === 'DUPLICATE_DATA') return json(200, { ok: true, duplicate: true });

    if (!created.ok || !row || row.code !== 'SUCCESS') {
      console.error(`crm-lead: Bigin ${created.status} creating contact: ${JSON.stringify(created.body).slice(0, 500)}`);
      return json(502, { ok: false, error: 'CRM sync failed' });
    }

    /* Tag it so website enquiries can be told apart. Best-effort. */
    const id = row.details && row.details.id;
    const tag = process.env.ZOHO_LEAD_TAG || 'Website enquiry';
    if (id) {
      const tagged = await bigin(auth, `/Contacts/${encodeURIComponent(id)}/actions/add_tags?tag_names=${encodeURIComponent(tag)}`, {
        method: 'POST'
      });
      if (!tagged.ok) {
        console.error(`crm-lead: Bigin ${tagged.status} tagging contact ${id}: ${JSON.stringify(tagged.body).slice(0, 300)}`);
      }
    }
    return json(200, { ok: true });
  } catch (err) {
    console.error('crm-lead: request to Zoho failed', err);
    return json(502, { ok: false, error: 'CRM sync failed' });
  }
};
