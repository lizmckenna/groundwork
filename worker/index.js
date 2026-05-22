// Groundwork pilot worker — v3.7-org-filter-fix, 2026-05-22
// Merge of Liz's deployed copy edits + missing house-meeting endpoints.
// Preserves her edits to the confirmation email:
//   - "three other parents" (was "two")
//   - "Every parent we bring in makes our movement for Missouri's kids stronger" (softer close)
// Adds back:
//   - POST /house-meeting-signup — public form dedupes by email/phone, logs commitments
//   - GET  /house-meeting-hosts  — autocomplete list for the form (seeded + past hosts)
// v3.3: bolder confirmation-email forward-this ask · FROM = Parents for MO Kids · REPLY_TO = lanee4kckids@gmail.com
// v3.2: KV caching on /confirmees, /today-stats, /recent-activity (60s); /queue-count (300s); writes invalidate.

const BASE = 'appQdixHbuttPldx6';
const CONTACTS_TBL = 'tblJeHqz13AOvq71A';
const CONTACT_LOG_TBL = 'tblXQXzxf8z1oht7z';
const EVENTS_TBL = 'tblHJG5AJagnOr33U';
const METHOD_MAP = { called: 'Call', texted: 'Text', emailed: 'Email' };
const METHOD_REVERSE = { Call: 'called', Text: 'texted', Email: 'emailed' };
const CONFIRM_EVENT = 'Confirm 5/26';
const LANEE_ID = 'rec0OmDN68hlffkTn';
const STEPHANIE_ID = 'recnnEdYIPcclnPLY';
const LANEE_COUNTIES = ['jackson', 'cass', 'johnson', 'platte', 'clay', 'lafayette', 'buchanan', 'ray'];

// Canonical organizer mapping — keys are LOWERCASE to match what pages send.
// Always look up via organizerId(name) to normalize case.
const ORGANIZER_IDS_LC = {
  'lanee':     LANEE_ID,
  'laneé':     LANEE_ID,
  'stephanie': STEPHANIE_ID,
};
function organizerId(name) {
  if (!name) return null;
  return ORGANIZER_IDS_LC[String(name).toLowerCase().trim()] || null;
}
// Backward-compat alias for any code still using ORGANIZER_IDS[name]
const ORGANIZER_IDS = new Proxy({}, { get: (_, k) => organizerId(k) });

const AUTO_CONFIRM_EMAIL = false;
const ZOOM_LINK_5_26 = 'https://us02web.zoom.us/j/6284644152?pwd=kweXnAjyLKIcGqxY3uxQSKeMKYfqMv.1';
const EVENT_NAME = 'Emergency Meeting on Public School Funding in Missouri';
const EVENT_DATE_LABEL = 'Tuesday, May 26 · 7:30 PM CST';
const FROM_CONFIRM = 'Parents for MO Kids <groundwork@civicpowerlab.us>';
const REPLY_TO_CONFIRM = 'lanee4kckids@gmail.com';

const ALLOWLIST = [
  'laneebridewell@gmail.com',
  'srttgrs@yahoo.com',
  'elizabethmck@gmail.com',
  'emckenna@hks.harvard.edu',
  'ellenginkc@gmail.com',
  'mcflemi@gmail.com',
  'tianyi@statepowerfund.org',
  'joymcushman@gmail.com',
  'kathryn@rootedstrategy.com',
];

const LOGIN_URL = 'https://lizmckenna.github.io/groundwork/pilot/lanee/';
const LOGO_URL = 'https://lizmckenna.github.io/groundwork/groundwork-logo-256.png';
const FROM_AUTH = 'Groundwork <groundwork@civicpowerlab.us>';
const CODE_TTL = 600;
const SESSION_TTL = 604800;

// --- KV read-cache ---
const READ_CACHE_TTL = 60; // seconds
const READ_CACHE_KEYS = [
  'cache:confirmees',
  'cache:confirmees:lanee',
  'cache:confirmees:stephanie',
  'cache:today-stats',
  'cache:recent-activity:7',
  'cache:recent-activity:14',
  'cache:recent-activity:30',
  'cache:recent-activity:14:lanee',
  'cache:recent-activity:14:stephanie',
  'cache:today-stats:lanee',
  'cache:today-stats:stephanie',
  'cache:org-contacts:lanee',
  'cache:org-contacts:stephanie',
  'cache:house-hosts',
  'queue:count',
  'queue:count:lanee',
  'queue:count:stephanie',
];
async function cacheGet(env, key) {
  const v = await env.KV_BINDING.get(key);
  return v ? JSON.parse(v) : null;
}
async function cachePut(env, key, payload, ttl = READ_CACHE_TTL) {
  await env.KV_BINDING.put(key, JSON.stringify(payload), { expirationTtl: ttl });
}
async function invalidateReadCaches(env) {
  await Promise.all(READ_CACHE_KEYS.map(k => env.KV_BINDING.delete(k)));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/auth/start' && request.method === 'POST') return await authStart(request, env);
      if (url.pathname === '/auth/verify' && request.method === 'POST') return await authVerify(request, env);
      if (url.pathname === '/signup' && request.method === 'POST') return await signup(request, env);
      if (url.pathname === '/house-meeting-signup' && request.method === 'POST') return await houseMeetingSignup(request, env);
      if (url.pathname === '/house-meeting-hosts' && request.method === 'GET') return await houseMeetingHosts(env);
      if (url.pathname === '/event-detail' && request.method === 'GET') return await eventDetail(env, url);
      if (url.pathname === '/event-rsvp' && request.method === 'POST') return await eventRsvp(request, env);
      // Admin endpoints — gated by X-Admin-Key header instead of session token
      if (url.pathname === '/admin/dedupe-merge' && request.method === 'POST') return await adminDedupeMerge(request, env);
      if (url.pathname === '/admin/contacts-dump' && request.method === 'GET') return await adminContactsDump(request, env, url);
      if (url.pathname === '/admin/role-append' && request.method === 'POST') return await adminRoleAppend(request, env);
      if (url.pathname === '/admin/queue-check' && request.method === 'GET') return await adminQueueCheck(request, env, url);
      if (url.pathname === '/admin/log-debug' && request.method === 'GET') return await adminLogDebug(request, env, url);
      const sessionToken = request.headers.get('X-Groundwork-Session');
      const email = sessionToken ? await env.KV_BINDING.get(`session:${sessionToken}`) : null;
      if (!email) return json({ error: 'unauthorized' }, 401);
      if (url.pathname === '/prospects') return await getProspects(env, url);
      if (url.pathname === '/log' && request.method === 'POST') return await logOutcome(request, env);
      if (url.pathname === '/undo' && request.method === 'POST') return await undoSave(request, env);
      if (url.pathname === '/confirmees') return await getConfirmees(env, url);
      if (url.pathname === '/confirm-log' && request.method === 'POST') return await confirmLog(request, env);
      if (url.pathname === '/today-stats') return await getTodayStats(env, url);
      if (url.pathname === '/recent-activity') return await getRecentActivity(env, url);
      if (url.pathname === '/search') return await searchContacts(env, url);
      if (url.pathname === '/queue-count') return await getQueueCount(env, url);
      if (url.pathname === '/send-zoom-email' && request.method === 'POST') return await sendZoomEmailNow(request, env);
      if (url.pathname === '/event-create' && request.method === 'POST') return await createEvent(request, env);
      if (url.pathname === '/events' && request.method === 'GET') return await listEvents(env, url);
      // Note: /event-detail and /event-rsvp are below in the public route block
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Groundwork-Session',
  };
}
function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors(), ...extraHeaders }
  });
}
async function at(env, path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    }
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}
function genToken(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// All "today" timestamps anchored to Central Time so dates match how organizers experience them.
function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

async function signup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:signup:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 5) return json({ error: 'too many requests, try again in 5 min' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { first, last, email, phone, school, district, county, city, zip, signup_5_26, source } = body;
  if (!first || !last || (!email && !phone)) {
    return json({ error: 'first name, last name, and email or phone are required' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);

  let existingId = null;
  if (email) {
    const e = String(email).toLowerCase().trim();
    const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${e}'`)}&maxRecords=1`);
    if (r.records.length > 0) existingId = r.records[0].id;
  }
  if (!existingId && phone) {
    const digits = String(phone).replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r.records.length > 0) existingId = r.records[0].id;
    }
  }

  const cLower = (county || '').toLowerCase();
  const isLanee = LANEE_COUNTIES.some(c => cLower.includes(c));
  const organizerId = isLanee ? LANEE_ID : STEPHANIE_ID;
  const today = todayCT();

  let contactId;
  let contactEmail = email ? String(email).toLowerCase().trim() : null;
  let contactFirst = cFirst;
  if (existingId) {
    contactId = existingId;
    if (signup_5_26) {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: {
          last_attempt_date: today,
          last_attempt_result: 'Signed up',
        }, typecast: true })
      });
    }
  } else {
    const fields = {
      first: cFirst,
      last: cLast,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
      source: source || 'parents4mopublicschools website signup',
    };
    if (email) fields.email = String(email).toLowerCase().trim();
    if (phone) fields.phone = String(phone).trim();
    if (school) fields.school = String(school).trim();
    if (district) fields.district = String(district).trim();
    if (county) fields.county = String(county).trim();
    if (city) fields.city = String(city).trim();
    if (zip) fields.zip = String(zip).trim();
    if (signup_5_26) {
      fields.last_attempt_date = today;
      fields.last_attempt_result = 'Signed up';
    }
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  if (signup_5_26) {
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({
        records: [{ fields: {
          Summary: `${today} — signup 5/26 via website`,
          date: today,
          method: 'Event attendance',
          result: 'Signed up',
          event: 'Orientation 5/26',
          contact: [contactId],
          notes: `Source: ${source || 'parents4mopublicschools website signup'}`,
        }}],
        typecast: true
      })
    });
    if (AUTO_CONFIRM_EMAIL && contactEmail) {
      await sendConfirmationEmail(env, contactEmail, contactFirst, contactId);
    }
  }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, message: 'thanks for signing up' });
}

// =========================================================================
// /house-meeting-hosts — list of known hosts for autocomplete on the sign-in form.
// Seeded list + distinct host names from past sign-ins (extracted from log notes).
// Cached 5 minutes in KV.
// =========================================================================
const SEEDED_HOSTS = [
  'Catherine Evans',
  'Ellen Gin',
  'Molly Fleming',
  'LaNeé Bridewell',
  'Stephanie Rittgers',
  'Rachel Hogan',
];

async function houseMeetingHosts(env) {
  const cacheKey = 'cache:house-hosts';
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const filter = `OR({method}='House meeting',FIND('Host: ',{notes}&'')>0)`;
  const records = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=notes&maxRecords=500`;
    if (offset) q += `&offset=${offset}`;
    try {
      const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
      records.push(...d.records);
      offset = d.offset;
    } catch (e) { offset = null; }
  } while (offset);

  const found = new Set(SEEDED_HOSTS);
  for (const r of records) {
    const notes = r.fields.notes || '';
    const m = notes.match(/Host:\s*([^·\n]+?)(?:\s*·|$)/);
    if (m && m[1]) found.add(m[1].trim());
  }
  const hosts = Array.from(found).sort();
  const payload = { hosts };
  await cachePut(env, cacheKey, payload, 300);
  return json(payload);
}

// =========================================================================
// /house-meeting-signup — public sign-in form for in-person house meetings.
// Dedupes by email/phone. Creates one contact_log row per commitment.
// =========================================================================
async function houseMeetingSignup(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:hmsignup:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 20) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { date, host_name, first, last, phone, email, street_address, city, state, zip, district, school, commitments = [], other_text, source } = body;
  if (!first || !last || !phone || !email || !date || !host_name) {
    return json({ error: 'first, last, phone, email, date, and host name are required' }, 400);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = String(email).toLowerCase().trim();
  const cPhone = String(phone).trim();

  let existingId = null;
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
  if (r.records.length > 0) existingId = r.records[0].id;
  if (!existingId) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment via city heuristic; fall back to Stephanie.
  const cityLower = (city || '').toLowerCase();
  const KC_CITIES = ['kansas city', 'independence', 'liberty', 'gladstone', 'raytown', 'grandview', 'lee\'s summit', 'lees summit', 'blue springs', 'belton', 'overland park', 'shawnee', 'olathe', 'lenexa', 'leawood', 'mission', 'merriam'];
  const isLaneeArea = KC_CITIES.some(c => cityLower.includes(c));
  const organizerId = isLaneeArea ? LANEE_ID : STEPHANIE_ID;

  let contactId;
  const baseFields = {
    first: cFirst,
    last: cLast,
    email: cEmail,
    phone: cPhone,
    source: source || 'house meeting sign-in',
  };
  if (street_address) baseFields.street_address = String(street_address).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();
  if (district) baseFields.district = String(district).trim();
  if (school) baseFields.school = String(school).trim();

  if (existingId) {
    contactId = existingId;
    const patch = {};
    if (street_address) patch.street_address = baseFields.street_address;
    if (city) patch.city = baseFields.city;
    if (zip) patch.zip = baseFields.zip;
    if (district) patch.district = baseFields.district;
    if (school) patch.school = baseFields.school;
    if (Object.keys(patch).length > 0) {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch, typecast: true })
      });
    }
  } else {
    const fields = {
      ...baseFields,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
    };
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  const logRecords = [];
  logRecords.push({
    fields: {
      Summary: `${date} — house meeting sign-in (host: ${host_name})`,
      date,
      method: 'House meeting',
      result: 'Attended',
      event: `House meeting ${date}`,
      contact: [contactId],
      notes: `Host: ${host_name}${commitments.length ? ` · Commitments: ${commitments.join(', ')}` : ''}${other_text ? ` · Other: ${other_text}` : ''}`,
    }
  });

  for (const c of commitments) {
    if (c === 'Other') continue;
    logRecords.push({
      fields: {
        Summary: `${date} — commitment: ${c}`,
        date,
        method: 'Commitment',
        result: 'Committed',
        event: c,
        contact: [contactId],
        notes: `From house meeting on ${date}, host ${host_name}`,
      }
    });
  }

  for (let i = 0; i < logRecords.length; i += 10) {
    const batch = logRecords.slice(i, i + 10);
    await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: batch, typecast: true })
    });
  }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, commitments_logged: commitments.length });
}

// Pages the magic link is allowed to land on (open-redirect protection).
const TRUSTED_REDIRECT_HOSTS = [
  'https://lizmckenna.github.io/groundwork/',
  'https://parents4mopublicschools.org/',
];
function safeRedirect(url) {
  if (!url || typeof url !== 'string') return null;
  for (const h of TRUSTED_REDIRECT_HOSTS) {
    if (url.startsWith(h)) return url;
  }
  return null;
}

async function authStart(request, env) {
  const body = await request.json();
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return json({ error: 'email required' }, 400);
  if (!ALLOWLIST.includes(email)) return json({ ok: true, message: 'check your email' });
  const code = genToken(32);
  await env.KV_BINDING.put(`code:${code}`, email, { expirationTtl: CODE_TTL });
  // Use caller's page as redirect target if it's a trusted host; otherwise fall back to LaNeé's dashboard.
  const target = safeRedirect(body.redirect_url) || LOGIN_URL;
  const link = `${target}?token=${code}`;
  const emailBody = {
    from: FROM_AUTH,
    to: [email],
    subject: 'Sign in to Groundwork',
    html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#18181b;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="padding:32px 40px 8px;">
          <img src="${LOGO_URL}" width="48" height="48" alt="Groundwork" style="display:block;border:0;margin-bottom:10px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:#18181b;line-height:1;">Groundwork</div>
          <div style="font-family:monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#71717a;margin-top:6px;">MOI Pilot &middot; Missouri</div>
        </td></tr>
        <tr><td style="padding:24px 40px 8px;">
          <h1 style="font-size:24px;font-weight:600;letter-spacing:-0.015em;margin:0 0 12px;color:#18181b;line-height:1.2;">Sign in to Groundwork</h1>
          <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">Tap the button to open your dashboard. The link is good for 10 minutes.</p>
          <table cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:#5371ff;">
            <a href="${link}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.005em;">Sign in &rarr;</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 40px 32px;">
          <p style="font-size:12px;line-height:1.6;color:#71717a;margin:0;">Button not working? Paste this link in your browser:</p>
          <p style="font-size:12px;line-height:1.5;color:#5371ff;margin:6px 0 0;word-break:break-all;">${link}</p>
        </td></tr>
        <tr><td style="padding:20px 40px;background:#fafafa;border-top:1px solid rgba(0,0,0,0.06);">
          <p style="font-size:11px;line-height:1.6;color:#71717a;margin:0;">Didn't request this? Ignore the email &mdash; the link expires on its own.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
  };
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emailBody),
  });
  if (!emailRes.ok) {
    const t = await emailRes.text();
    return json({ error: `email send failed: ${t}` }, 500);
  }
  return json({ ok: true, message: 'check your email' });
}

async function authVerify(request, env) {
  const body = await request.json();
  const code = body.code;
  if (!code) return json({ error: 'code required' }, 400);
  const email = await env.KV_BINDING.get(`code:${code}`);
  if (!email) return json({ error: 'invalid or expired link' }, 401);
  await env.KV_BINDING.delete(`code:${code}`);
  const sessionToken = genToken(48);
  await env.KV_BINDING.put(`session:${sessionToken}`, email, { expirationTtl: SESSION_TTL });
  return json({ ok: true, session_token: sessionToken, email });
}

// Schools whose parents are organized by their own school teams — exclude from
// any organizer's call queue. Matches via case-insensitive "contains" so all
// spelling variants get caught (e.g. "Hale Cook Elementary", "FLA/Holliday").
const EXCLUDED_SCHOOL_PATTERNS = ['hale cook', 'fla', 'foreign language academy', 'border star', 'bsm'];
const EXCLUDED_ROLES = ['Fellow organizer'];
// Note: no state-based exclusion. KC-metro includes KS counties (Johnson, Wyandotte) — those are LaNeé's.
// Stephanie's queue is just whatever's assigned to her; we manage assignments rather than filter geography.

// Organizer NAMES (matches what {assigned_organizer} stringifies to — primary field of Contacts table).
// Multi-select stringifies as comma-joined names, so name-based FIND is the reliable filter.
// Try both with/without accent — Airtable's primary field may be either.
// The filter uses FIND('Bridewell',...) which catches BOTH variants safely.
const ORGANIZER_NAMES_LC = {
  'lanee':     'Bridewell',         // partial match — catches "LaNeé Bridewell" or "LaNee Bridewell"
  'laneé':     'Bridewell',
  'stephanie': 'Stephanie Rittgers',
};
function organizerName(name) {
  if (!name) return null;
  return ORGANIZER_NAMES_LC[String(name).toLowerCase().trim()] || null;
}

function prospectsFilter(organizerName_) {
  // Name-based filter — record-ID-based was broken because ARRAYJOIN returns names not IDs.
  const orgFullName = organizerName(organizerName_);
  const orgClause = orgFullName ? `,FIND('${orgFullName}',{assigned_organizer}&'')>0` : '';
  const schoolExcl = EXCLUDED_SCHOOL_PATTERNS
    .map(p => `FIND('${p}',LOWER({school}&''))=0`)
    .join(',');
  const roleExcl = EXCLUDED_ROLES
    .map(r => `FIND('${r}',{role}&'')=0`)
    .join(',');
  // CRITICAL: build as a SINGLE LINE so .replace doesn't mangle spaces inside string literals.
  return [
    `AND(`,
    `NOT({leader_ladder}='Core Leader'),`,
    `NOT({leader_ladder}='Not a prospect'),`,
    `OR({last_attempt_date}=BLANK(),DATETIME_DIFF(TODAY(),{last_attempt_date},'days')>7),`,
    `NOT({last_attempt_result}='Signed up'),`,
    `NOT({last_attempt_result}='Skipped'),`,
    `NOT({last_attempt_result}='Wrong number'),`,
    `NOT({last_attempt_result}='Do not contact'),`,
    `${schoolExcl},`,
    `${roleExcl}`,
    `${orgClause}`,
    `)`,
  ].join('');
}
const PROSPECTS_FILTER = prospectsFilter();  // legacy default — no organizer filter

async function getProspects(env, url) {
  const n = parseInt(url.searchParams.get('n') || '5');
  const organizer = url.searchParams.get('organizer');
  const filter = prospectsFilter(organizer);
  const fields = ['Name','first','last','phone','email','school','district','log_count','organized_by','leader_ladder'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
  q += `&sort%5B0%5D%5Bfield%5D=log_count&sort%5B0%5D%5Bdirection%5D=desc`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    log_count: r.fields.log_count || 0,
    organized_by_count: (r.fields.organized_by || []).length,
    leader_ladder: r.fields.leader_ladder || '',
  })));
}

async function getQueueCount(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const cacheKey = organizer ? `queue:count:${organizer}` : 'queue:count';
  const cached = await env.KV_BINDING.get(cacheKey);
  if (cached) return json({ count: parseInt(cached), cached: true });
  const filter = prospectsFilter(organizer);
  let count = 0;
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    count += data.records.length;
    offset = data.offset;
  } while (offset);
  await env.KV_BINDING.put(cacheKey, String(count), { expirationTtl: 300 });
  return json({ count });
}

async function sendZoomEmailNow(request, env) {
  const body = await request.json();
  const { contact_id } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const contact = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
  const cEmail = contact.fields.email;
  const cFirst = contact.fields.first || '';
  if (!cEmail) return json({ error: 'contact has no email on file' }, 400);
  await sendConfirmationEmail(env, cEmail, cFirst, contact_id);
  return json({ ok: true, sent_to: cEmail });
}

function resolveOutcome(outcome, methodCount) {
  switch (outcome) {
    case 'oneonone':       return { result: 'Signed up',  event: '1-1 meeting' };
    case 'signed-up':      return { result: 'Signed up',  event: 'Orientation 5/26' };
    case 'connected':      return { result: 'Conversation', event: null };
    case 'skipped':        return { result: 'Skipped',     event: null };
    case 'wrong-number':   return { result: 'Wrong number', event: null };
    case 'do-not-contact': return { result: 'Do not contact', event: null };
    default:               return { result: methodCount > 0 ? 'No answer' : null, event: null };
  }
}

async function logOutcome(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], outcome, next_step, notes } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const date = todayCT();
  const { result, event } = resolveOutcome(outcome, methods.length);

  const ADMIN_OUTCOMES = ['skipped','wrong-number','do-not-contact'];
  const isAdmin = ADMIN_OUTCOMES.includes(outcome);
  if (!isAdmin && methods.length === 0) {
    return json({ error: 'no methods checked' }, 400);
  }

  const combinedNotes = [next_step, notes].filter(s => s && String(s).trim()).join(' · ');

  let records;
  if (isAdmin) {
    records = [{
      fields: {
        Summary: `${date} — ${result}`,
        date,
        method: 'Other',
        result,
        contact: [contact_id],
        ...(combinedNotes ? { notes: combinedNotes } : {}),
      }
    }];
  } else {
    records = methods.map(m => {
      const method = METHOD_MAP[m] || m;
      const f = { Summary: `${date} — ${method}`, date, method, contact: [contact_id] };
      if (result) f.result = result;
      if (event) f.event = event;
      if (combinedNotes) f.notes = combinedNotes;
      return { fields: f };
    });
  }

  const created = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records, typecast: true })
  });

  const contactFields = {
    last_attempt_date: date,
    last_attempt_method: isAdmin ? 'Other' : (METHOD_MAP[methods[0]] || methods[0]),
    last_attempt_result: result,
  };
  if (next_step) contactFields.next_step = next_step;
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: contactFields, typecast: true })
  });

  let confirmation_email_sent = false;
  if (AUTO_CONFIRM_EMAIL && outcome === 'signed-up') {
    try {
      const contact = await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`);
      const cEmail = contact.fields.email;
      const cFirst = contact.fields.first || '';
      if (cEmail) {
        await sendConfirmationEmail(env, cEmail, cFirst, contact_id);
        confirmation_email_sent = true;
      }
    } catch (e) {
      await invalidateReadCaches(env);
      return json({ ok: true, created_count: created.records.length, confirmation_email_sent: false, email_warning: e.message });
    }
  }

  await invalidateReadCaches(env);
  return json({ ok: true, created_count: created.records.length, confirmation_email_sent });
}

async function sendConfirmationEmail(env, toEmail, firstName, contactId) {
  const date = todayCT();
  const safeName = firstName ? firstName : '';
  const greetingComma = safeName ? `, ${escapeHtml(safeName)}` : '';
  const subject = `You're in — Emergency Meeting on Public School Funding · Tue 5/26 7:30 PM CT`;
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>You're in — Parents for Missouri Public Schools</title>
</head>
<body style="margin:0;padding:0;background:#E9E5CE;font-family:Helvetica,Arial,sans-serif;color:#1A2418">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#E9E5CE">
Emergency Meeting on Public School Funding · Tue May 26 · 7:30 PM CT · Zoom
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9E5CE" style="background:#E9E5CE">
  <tr>
    <td align="center" style="padding:32px 16px">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">

        <tr><td style="padding:0 0 28px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="44" style="padding-right:14px;vertical-align:middle">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td width="44" height="44" bgcolor="#B25048" style="background:#B25048;border-radius:22px" align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr><td width="32" height="32" bgcolor="#C99633" style="background:#C99633;border-radius:16px" align="center">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr><td width="16" height="16" bgcolor="#E9E5CE" style="background:#E9E5CE;border-radius:8px"></td></tr>
                        </table>
                      </td></tr>
                    </table>
                  </td></tr>
                </table>
              </td>
              <td style="vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418">
                Parents for Missouri<br/>Public Schools
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 20px">
          <h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:44px;line-height:.95;letter-spacing:.005em;text-transform:uppercase;color:#1A2418">
            You're in.
          </h1>
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A2418">
          Hi${greetingComma}, thank you for committing to join our <strong>Emergency Meeting on Public School Funding in Missouri</strong>. We are mobilizing parents, community members, educators, and advocates to respond quickly and strategically to current threats to public school funding in our state.
        </td></tr>

        <tr><td style="padding:6px 0 22px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D9D5C0" style="background:#D9D5C0;border:2px solid #1A2418;border-radius:14px">
            <tr><td style="padding:20px 22px">
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2F5E3D;margin:0 0 8px">
                Emergency Meeting · Public School Funding
              </div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418;margin:0 0 6px">
                Tue, May 26<br/>7:30 PM CT
              </div>
              <div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#1A2418;opacity:.65">
                On Zoom
              </div>
              <div style="margin:18px 0 0">
                <a href="${ZOOM_LINK_5_26}" style="display:inline-block;background:#1A2418;color:#E9E5CE;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;padding:13px 20px;border-radius:8px">Open the Zoom link →</a>
              </div>
              <div style="margin:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#1A2418;opacity:.65;word-break:break-all">
                ${ZOOM_LINK_5_26}
              </div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          Your presence matters. The decisions being made right now could have long-term consequences for Missouri families and public education. We need informed, connected, and prepared people ready to take action together.
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          If something changes and you are unable to attend live, please reply to this email so we can schedule a 1:1 conversation to review the information and help get you plugged into next steps.
        </td></tr>

        <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          <strong>Help us reach more parents.</strong> Please forward this email to <strong>three other parents</strong>, educators, or neighbors who care about public schools, and ask them to sign up at <a href="https://parents4mopublicschools.org/" style="color:#1A2418;text-decoration:underline"><strong>parents4mopublicschools.org</strong></a>. Every parent we bring in makes our movement for Missouri's kids stronger.
        </td></tr>

        <tr><td style="padding:0 0 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
          We look forward to seeing you on May 26th.
        </td></tr>

        <tr><td style="padding:0 0 36px">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1A2418">In solidarity,</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:15px;line-height:1.35;color:#1A2418;margin-top:6px">LaNeé Bridewell</div>
          <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.16em;color:#B25048;margin-top:4px">Parents for KC Kids</div>
        </td></tr>

        <tr><td style="padding-top:18px;border-top:1px dashed rgba(26,36,24,.25);font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#1A2418">
          Parents for Missouri Public Schools<br/>
          <a href="mailto:${REPLY_TO_CONFIRM}" style="color:#1A2418;text-decoration:underline">${REPLY_TO_CONFIRM}</a>
        </td></tr>

        <tr><td style="padding:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:1.55;letter-spacing:.12em;text-transform:uppercase;color:#1A2418;opacity:.55">
          You're receiving this because you committed to the Emergency Meeting on Public School Funding. Reply to this email if you'd like to be removed.
        </td></tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_CONFIRM, to: [toEmail], reply_to: REPLY_TO_CONFIRM, subject, html }),
  });
  if (!emailRes.ok) throw new Error(`email send failed: ${await emailRes.text()}`);

  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Summary: `${date} — Email (auto Zoom confirm)`,
          date,
          method: 'Email',
          result: 'Reminder sent',
          event: CONFIRM_EVENT,
          contact: [contactId],
          notes: 'Auto-sent Zoom confirmation on signup',
        }
      }],
      typecast: true
    })
  });
}

async function undoSave(request, env) {
  const body = await request.json();
  const { contact_id } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const date = todayCT();
  const filter = `{date}=DATETIME_PARSE('${date}')`;
  const allToday = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    allToday.push(...data.records);
    offset = data.offset;
  } while (offset);
  const ids = allToday.filter(r => (r.fields.contact || []).includes(contact_id)).map(r => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i+10);
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACT_LOG_TBL}`);
    for (const id of batch) url.searchParams.append('records[]', id);
    const r = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (r.ok) deleted += batch.length;
  }
  await at(env, `/${BASE}/${CONTACTS_TBL}/${contact_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: {
      last_attempt_date: null, last_attempt_method: null,
      last_attempt_result: null, next_step: '',
    }, typecast: true })
  });
  await invalidateReadCaches(env);
  return json({ ok: true, deleted });
}

async function getConfirmees(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const cacheKey = organizer ? `cache:confirmees:${organizer}` : 'cache:confirmees';
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const orgFullName = organizerName(organizer);
  const filter = orgFullName
    ? `AND({last_attempt_result}='Signed up',FIND('${orgFullName}',{assigned_organizer}&'')>0)`
    : "{last_attempt_result}='Signed up'";
  const fields = ['Name','first','last','phone','email','school','district','last_attempt_date','source'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=200`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const contactsData = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);

  const confirmLogs = [];
  let offset = null;
  const lf = `{event}='${CONFIRM_EVENT}'`;
  do {
    let lq = `?filterByFormula=${encodeURIComponent(lf)}&pageSize=100&fields%5B%5D=contact&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=date`;
    if (offset) lq += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${lq}`);
    confirmLogs.push(...d.records);
    offset = d.offset;
  } while (offset);

  const stateByContact = {};
  const rank = { 'Confirmed': 5, 'Cancelled': 4, 'Declined': 3, 'No answer': 2, 'Reminder sent': 1 };
  for (const r of confirmLogs) {
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (!stateByContact[cid]) {
      stateByContact[cid] = { email_sent: false, text_sent: false, call_made: false, status: null, last_date: null };
    }
    const s = stateByContact[cid];
    const m = r.fields.method;
    if (m === 'Email') s.email_sent = true;
    if (m === 'Text') s.text_sent = true;
    if (m === 'Call') s.call_made = true;
    const res = r.fields.result;
    if (res && (rank[res] || 0) > (rank[s.status] || 0)) s.status = res;
    if (r.fields.date && (!s.last_date || r.fields.date > s.last_date)) s.last_date = r.fields.date;
  }

  const payload = contactsData.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    last_attempt_date: r.fields.last_attempt_date || '',
    source: r.fields.source || '',
    confirm: stateByContact[r.id] || { email_sent: false, text_sent: false, call_made: false, status: null, last_date: null },
  }));
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

async function confirmLog(request, env) {
  const body = await request.json();
  const { contact_id, methods = [], status = null, notes = '' } = body;
  if (!contact_id) return json({ error: 'contact_id required' }, 400);
  const ALLOWED_STATUSES = [null, '', 'Confirmed', 'No answer', 'Declined', 'Cancelled', 'Reminder sent'];
  if (!ALLOWED_STATUSES.includes(status)) return json({ error: 'invalid status' }, 400);
  if (!methods.length && !status) return json({ error: 'no methods or status' }, 400);
  const date = todayCT();
  const result = status || 'Reminder sent';

  const dupFilter = `AND({date}=DATETIME_PARSE('${date}'),{event}='${CONFIRM_EVENT}')`;
  const dupes = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(dupFilter)}&pageSize=100&fields%5B%5D=contact`;
    if (offset) q += `&offset=${offset}`;
    const d = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
    dupes.push(...d.records);
    offset = d.offset;
  } while (offset);
  const dupIds = dupes.filter(r => (r.fields.contact || []).includes(contact_id)).map(r => r.id);
  for (let i = 0; i < dupIds.length; i += 10) {
    const batch = dupIds.slice(i, i+10);
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACT_LOG_TBL}`);
    for (const id of batch) u.searchParams.append('records[]', id);
    await fetch(u, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
  }

  const effectiveMethods = methods.length ? methods : ['called'];
  const records = effectiveMethods.map(m => {
    const method = METHOD_MAP[m] || m;
    const f = {
      Summary: `${date} — ${method} (5/26 confirm)`,
      date, method, result,
      event: CONFIRM_EVENT,
      contact: [contact_id],
    };
    if (notes) f.notes = notes;
    return { fields: f };
  });
  const created = await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records, typecast: true })
  });
  await invalidateReadCaches(env);
  return json({ ok: true, created_count: created.records.length, status: result });
}

async function searchContacts(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json([]);
  const n = parseInt(url.searchParams.get('n') || '25');
  const qLower = q.toLowerCase().replace(/'/g, '');
  const digits = q.replace(/\D/g, '');
  const ors = [
    `FIND('${qLower}',LOWER({Name}&''))>0`,
    `FIND('${qLower}',LOWER({email}&''))>0`,
  ];
  if (digits.length >= 4) ors.push(`FIND('${digits}',REGEX_REPLACE({phone}&'','\\\\D',''))>0`);
  const filter = `OR(${ors.join(',')})`;
  const fields = ['Name','first','last','phone','email','school','district','last_attempt_date','last_attempt_result','leader_ladder','log_count'];
  let p = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=${n}`;
  for (const f of fields) p += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${p}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || `${r.fields.first || ''} ${r.fields.last || ''}`.trim(),
    phone: r.fields.phone || '',
    email: r.fields.email || '',
    school: r.fields.school || '',
    district: r.fields.district || '',
    log_count: r.fields.log_count || 0,
    leader_ladder: r.fields.leader_ladder || '',
    last_attempt_date: r.fields.last_attempt_date || '',
    last_attempt_result: r.fields.last_attempt_result || '',
    organized_by_count: 0,
  })));
}

// Returns the set of contact IDs assigned to the given organizer. Cached 5 min.
async function organizerContactIds(env, organizerName_) {
  const orgFullName = organizerName(organizerName_);
  if (!orgFullName) return null;
  const cacheKey = `cache:org-contacts:${String(organizerName_).toLowerCase()}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return new Set(cached);
  const filter = `FIND('${orgFullName}',{assigned_organizer}&'')>0`;
  const ids = [];
  let offset = null;
  do {
    let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) q += `&offset=${offset}`;
    const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
    for (const r of data.records) ids.push(r.id);
    offset = data.offset;
  } while (offset);
  await cachePut(env, cacheKey, ids, 300);
  return new Set(ids);
}

async function getTodayStats(env, urlObj) {
  const organizer = urlObj ? urlObj.searchParams.get('organizer') : null;
  const cacheKey = organizer ? `cache:today-stats:${organizer}` : 'cache:today-stats';
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const date = todayCT();
  const filter = `{date}=DATETIME_PARSE('${date}')`;
  const fields = ['contact','method','result','event','date'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const records = [];
  let offset = null;
  do {
    const url = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, url);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  // Filter to only this organizer's assigned contacts when organizer param is set
  const allowedIds = organizer ? await organizerContactIds(env, organizer) : null;

  const byContact = {};
  const order = [];
  for (const r of records) {
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (allowedIds && !allowedIds.has(cid)) continue;
    if (r.fields.event === CONFIRM_EVENT) continue;
    if (!byContact[cid]) { byContact[cid] = { contact_id: cid, methods: new Set(), result: null, event: null }; order.push(cid); }
    if (r.fields.method) byContact[cid].methods.add(r.fields.method);
    if (r.fields.result) byContact[cid].result = r.fields.result;
    if (r.fields.event) byContact[cid].event = r.fields.event;
  }
  const actions = order.map(cid => {
    const c = byContact[cid];
    let outcome = null;
    if (c.event === '1-1 meeting') outcome = 'oneonone';
    else if (c.event === 'Orientation 5/26') outcome = 'signed-up';
    else if (c.result === 'Signed up') outcome = 'signed-up';
    else if (c.result === 'Conversation') outcome = 'connected';
    else if (c.result === 'Skipped') outcome = 'skipped';
    else if (c.result === 'Wrong number') outcome = 'wrong-number';
    else if (c.result === 'Do not contact') outcome = 'do-not-contact';
    return {
      contact_id: c.contact_id,
      methods: Array.from(c.methods).map(m => METHOD_REVERSE[m] || m.toLowerCase()),
      outcome,
    };
  });
  const payload = { actions };
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

async function getRecentActivity(env, url) {
  const days = parseInt(url.searchParams.get('days') || '14');
  const organizer = url.searchParams.get('organizer');
  const cacheKey = organizer
    ? `cache:recent-activity:${days}:${organizer}`
    : `cache:recent-activity:${days}`;
  const cached = await cacheGet(env, cacheKey);
  if (cached) return json(cached);

  const filter = `IS_AFTER({date},DATEADD(TODAY(),-${days},'days'))`;
  const fields = ['contact','method','result','event','date'];
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const records = [];
  let offset = null;
  do {
    const u = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, u);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  // Filter to only this organizer's assigned contacts when organizer param is set
  const allowedIds = organizer ? await organizerContactIds(env, organizer) : null;

  const byDate = {};
  for (const r of records) {
    const d = r.fields.date;
    if (!d) continue;
    if (r.fields.event === CONFIRM_EVENT) continue;
    const cid = (r.fields.contact || [])[0];
    if (!cid) continue;
    if (allowedIds && !allowedIds.has(cid)) continue;
    if (!byDate[d]) byDate[d] = {};
    if (!byDate[d][cid]) byDate[d][cid] = { methods: new Set(), result: null, event: null };
    if (r.fields.method) byDate[d][cid].methods.add(r.fields.method);
    if (r.fields.result) byDate[d][cid].result = r.fields.result;
    if (r.fields.event) byDate[d][cid].event = r.fields.event;
  }
  const out = {};
  for (const [d, contacts] of Object.entries(byDate)) {
    out[d] = Object.entries(contacts).map(([cid, info]) => {
      let outcome = null;
      if (info.event === '1-1 meeting') outcome = 'oneonone';
      else if (info.event === 'Orientation 5/26') outcome = 'signed-up';
      else if (info.result === 'Signed up') outcome = 'signed-up';
      else if (info.result === 'Conversation') outcome = 'connected';
      else if (info.result === 'Skipped') outcome = 'skipped';
      else if (info.result === 'Wrong number') outcome = 'wrong-number';
      else if (info.result === 'Do not contact') outcome = 'do-not-contact';
      return {
        contact_id: cid,
        methods: Array.from(info.methods).map(m => METHOD_REVERSE[m] || m.toLowerCase()),
        outcome,
      };
    });
  }
  const payload = { by_date: out };
  await cachePut(env, cacheKey, payload);
  return json(payload);
}

// =========================================================================
// /event-create — admin endpoint to create a new event in the Events table.
// Auth required.
// =========================================================================
async function createEvent(request, env) {
  const body = await request.json();
  const { name, type, date, time, host, location, assigned_organizer, notes } = body;
  if (!type || !date) {
    return json({ error: 'type and date are required' }, 400);
  }

  // Auto-generate name if not provided: "House meeting training — 2026-06-04"
  const eventName = (name && name.trim()) || `${type} — ${date}`;

  const fields = {
    Name: eventName,
    type,
    date,
  };
  if (time && time.trim()) fields.time = time.trim();
  if (host && host.trim()) fields.host = host.trim();
  if (location && location.trim()) fields.location = location.trim();
  if (notes && notes.trim()) fields.notes = notes.trim();
  if (assigned_organizer && ORGANIZER_IDS[assigned_organizer]) {
    fields.assigned_organizer = [ORGANIZER_IDS[assigned_organizer]];
  }

  const created = await at(env, `/${BASE}/${EVENTS_TBL}`, {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true })
  });

  const eventId = created.records[0].id;
  return json({
    ok: true,
    event_id: eventId,
    name: eventName,
    rsvp_url: `https://parents4mopublicschools.org/rsvp/?event=${eventId}`,
    sign_in_url: `https://parents4mopublicschools.org/house-meeting/?event=${eventId}`,
  });
}

// =========================================================================
// /events — list recent events (most-recent first). Auth required.
// =========================================================================
async function listEvents(env, url) {
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const fields = ['Name', 'type', 'date', 'time', 'host', 'location'];
  let q = `?maxRecords=${limit}&sort%5B0%5D%5Bfield%5D=date&sort%5B0%5D%5Bdirection%5D=desc`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  const data = await at(env, `/${BASE}/${EVENTS_TBL}${q}`);
  return json(data.records.map(r => ({
    id: r.id,
    name: r.fields.Name || '',
    type: r.fields.type || '',
    date: r.fields.date || '',
    time: r.fields.time || '',
    host: r.fields.host || '',
    location: r.fields.location || '',
  })));
}

// =========================================================================
// /event-detail — public lookup of a single event by id, for the RSVP form.
// Returns minimal fields needed to render "RSVP to [name] on [date]".
// =========================================================================
async function eventDetail(env, url) {
  const id = url.searchParams.get('id');
  if (!id || !id.startsWith('rec')) return json({ error: 'invalid event id' }, 400);
  try {
    const data = await at(env, `/${BASE}/${EVENTS_TBL}/${id}`);
    const f = data.fields || {};
    return json({
      id: data.id,
      name: f.Name || '',
      type: f.type || '',
      date: f.date || '',
      time: f.time || '',
      host: f.host || '',
      location: f.location || '',
      notes: f.notes || '',
    });
  } catch (e) {
    return json({ error: 'event not found' }, 404);
  }
}

// =========================================================================
// /event-rsvp — public RSVP submission. Dedupes by email/phone, creates a
// contact_log row linked to the event with method=RSVP, result=RSVPd.
// =========================================================================
async function eventRsvp(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:rsvp:${ip}`;
  const count = parseInt(await env.KV_BINDING.get(rlKey) || '0');
  if (count >= 20) return json({ error: 'too many requests, try again later' }, 429, { 'Retry-After': '300' });
  await env.KV_BINDING.put(rlKey, String(count + 1), { expirationTtl: 300 });

  const body = await request.json();
  if (body.website && String(body.website).trim()) return json({ error: 'bot detected' }, 400);
  const { event_id, first, last, phone, email, school, district, city, zip, notes } = body;
  if (!event_id || !event_id.startsWith('rec')) return json({ error: 'event_id required' }, 400);
  if (!first || !last || !email) return json({ error: 'first, last, and email are required' }, 400);

  // Get event to know what we're RSVPing to (used in log entry + email)
  let eventName = '';
  let eventRecord = null;
  try {
    const evt = await at(env, `/${BASE}/${EVENTS_TBL}/${event_id}`);
    eventRecord = evt.fields || {};
    eventName = eventRecord.Name || '';
  } catch (e) {
    return json({ error: 'event not found' }, 404);
  }

  const clean = (s) => String(s || '').replace(/^[^\w\s]+/, '').trim();
  const cFirst = clean(first);
  const cLast = clean(last);
  const cEmail = String(email).toLowerCase().trim();
  const cPhone = phone ? String(phone).trim() : '';

  // Dedupe by email then phone
  let existingId = null;
  const r = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`LOWER({email})='${cEmail}'`)}&maxRecords=1`);
  if (r.records.length > 0) existingId = r.records[0].id;
  if (!existingId && cPhone) {
    const digits = cPhone.replace(/\D/g, '').slice(-10);
    if (digits.length === 10) {
      const r2 = await at(env, `/${BASE}/${CONTACTS_TBL}?filterByFormula=${encodeURIComponent(`REGEX_REPLACE({phone},'\\\\D','')='${digits}'`)}&maxRecords=1`);
      if (r2.records.length > 0) existingId = r2.records[0].id;
    }
  }

  // Organizer assignment by city heuristic
  const cityLower = (city || '').toLowerCase();
  const KC_CITIES = ['kansas city', 'independence', 'liberty', 'gladstone', 'raytown', 'grandview', "lee's summit", 'lees summit', 'blue springs', 'belton', 'overland park', 'shawnee', 'olathe', 'lenexa', 'leawood', 'mission', 'merriam'];
  const isLaneeArea = KC_CITIES.some(c => cityLower.includes(c));
  const organizerId = isLaneeArea ? LANEE_ID : STEPHANIE_ID;

  let contactId;
  const baseFields = {
    first: cFirst,
    last: cLast,
    email: cEmail,
    source: `event RSVP: ${eventName}`,
  };
  if (cPhone) baseFields.phone = cPhone;
  if (school) baseFields.school = String(school).trim();
  if (district) baseFields.district = String(district).trim();
  if (city) baseFields.city = String(city).trim();
  if (zip) baseFields.zip = String(zip).trim();

  if (existingId) {
    contactId = existingId;
    // Don't blow away existing data — only patch fields that were provided
    const patch = {};
    if (school) patch.school = baseFields.school;
    if (district) patch.district = baseFields.district;
    if (city) patch.city = baseFields.city;
    if (zip) patch.zip = baseFields.zip;
    if (Object.keys(patch).length > 0) {
      await at(env, `/${BASE}/${CONTACTS_TBL}/${contactId}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch, typecast: true })
      });
    }
  } else {
    const fields = {
      ...baseFields,
      leader_ladder: 'Prospect',
      assigned_organizer: [organizerId],
    };
    const created = await at(env, `/${BASE}/${CONTACTS_TBL}`, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields }], typecast: true })
    });
    contactId = created.records[0].id;
  }

  // Log the RSVP — link to event via the contact_log linked field on Events table
  const date = todayCT();
  await at(env, `/${BASE}/${CONTACT_LOG_TBL}`, {
    method: 'POST',
    body: JSON.stringify({
      records: [{
        fields: {
          Summary: `${date} — RSVP: ${eventName}`,
          date,
          method: 'RSVP',
          result: 'RSVPd',
          event: 'Other event',
          contact: [contactId],
          notes: notes ? `RSVPd via shared link to: ${eventName}\n\n${notes}` : `RSVPd via shared link to: ${eventName}`,
        }
      }],
      typecast: true
    })
  });

  // Send confirmation email (best-effort — don't fail the RSVP if email fails)
  let email_sent = false;
  try {
    await sendRsvpConfirmEmail(env, cEmail, cFirst, eventRecord);
    email_sent = true;
  } catch (e) { /* swallow email errors so RSVP still succeeds */ }

  await invalidateReadCaches(env);
  return json({ ok: true, contact_id: contactId, event_name: eventName, email_sent });
}

// =========================================================================
// RSVP confirmation email — sent automatically after /event-rsvp success.
// Renders event details (name, date, time, location, host) from the Events record.
// =========================================================================
async function sendRsvpConfirmEmail(env, toEmail, firstName, eventRecord) {
  const name = eventRecord.Name || 'our event';
  const type = eventRecord.type || 'event';
  const date = eventRecord.date || '';
  const time = eventRecord.time || '';
  const location = eventRecord.location || '';
  const host = eventRecord.host || '';
  const notes = eventRecord.notes || '';

  // Format date for humans
  let dateLabel = date;
  try {
    const d = new Date(date + 'T12:00:00');
    dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch (e) {}

  const safeName = firstName ? `, ${escapeHtml(firstName)}` : '';
  const subject = `You're in — ${name}`;
  const locationIsZoom = /zoom/i.test(location);
  const zoomLinkMatch = (location.match(/https?:\/\/\S+/) || [])[0];

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>You're in — ${escapeHtml(name)}</title>
</head>
<body style="margin:0;padding:0;background:#E9E5CE;font-family:Helvetica,Arial,sans-serif;color:#1A2418">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#E9E5CE">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">

      <tr><td style="padding:0 0 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" style="padding-right:14px;vertical-align:middle">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td width="44" height="44" bgcolor="#B25048" style="background:#B25048;border-radius:22px" align="center">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td width="32" height="32" bgcolor="#C99633" style="background:#C99633;border-radius:16px" align="center">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                        <td width="16" height="16" bgcolor="#E9E5CE" style="background:#E9E5CE;border-radius:8px"></td>
                      </tr></table>
                    </td>
                  </tr></table>
                </td>
              </tr></table>
            </td>
            <td style="vertical-align:middle;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:#1A2418">
              Parents for Missouri<br/>Public Schools
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="padding:0 0 20px">
        <h1 style="margin:0;font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:44px;line-height:.95;letter-spacing:.005em;text-transform:uppercase;color:#1A2418">You're in.</h1>
      </td></tr>

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1A2418">
        Hi${safeName}, thanks for RSVPing to <strong>${escapeHtml(name)}</strong>. Here are the details.
      </td></tr>

      <tr><td style="padding:6px 0 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#D9D5C0" style="background:#D9D5C0;border:2px solid #1A2418;border-radius:14px">
          <tr><td style="padding:20px 22px">
            <div style="font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#2F5E3D;margin:0 0 8px">${escapeHtml(type)}</div>
            <div style="font-family:Helvetica,Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.2;text-transform:uppercase;letter-spacing:.01em;color:#1A2418;margin:0 0 10px">${escapeHtml(dateLabel)}</div>
            ${time ? `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:14px;color:#1A2418;margin:0 0 4px">${escapeHtml(time)}</div>` : ''}
            ${location ? `<div style="font-family:Helvetica,Arial,sans-serif;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#1A2418;opacity:.7;margin:6px 0 0">${escapeHtml(location)}</div>` : ''}
            ${host ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#1A2418;opacity:.7;margin:6px 0 0">Hosted by ${escapeHtml(host)}</div>` : ''}
            ${zoomLinkMatch ? `<div style="margin:18px 0 0"><a href="${zoomLinkMatch}" style="display:inline-block;background:#1A2418;color:#E9E5CE;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.06em;padding:13px 20px;border-radius:8px">Open Zoom link →</a></div>` : ''}
          </td></tr>
        </table>
      </td></tr>

      ${notes ? `<tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1A2418">${escapeHtml(notes)}</td></tr>` : ''}

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
        We'll send a reminder closer to the date. If something changes and you can't make it, please reply to this email.
      </td></tr>

      <tr><td style="padding:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1A2418">
        <strong>Help us reach more parents.</strong> Forward this email to a few people in your circle who care about public schools, and ask them to sign up at <a href="https://parents4mopublicschools.org/" style="color:#1A2418;text-decoration:underline"><strong>parents4mopublicschools.org</strong></a>. Every parent we bring in makes our movement for Missouri's kids stronger.
      </td></tr>

      <tr><td style="padding-top:18px;border-top:1px dashed rgba(26,36,24,.25);font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;color:#1A2418">
        Parents for Missouri Public Schools<br/>
        <a href="mailto:${REPLY_TO_CONFIRM}" style="color:#1A2418;text-decoration:underline">${REPLY_TO_CONFIRM}</a>
      </td></tr>

      <tr><td style="padding:14px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:1.55;letter-spacing:.12em;text-transform:uppercase;color:#1A2418;opacity:.55">
        You're receiving this because you RSVPed at parents4mopublicschools.org. Reply to be removed.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_CONFIRM, to: [toEmail], reply_to: REPLY_TO_CONFIRM, subject, html }),
  });
  if (!emailRes.ok) throw new Error(`rsvp email failed: ${await emailRes.text()}`);
}

// =========================================================================
// /admin/dedupe-merge — gated by X-Admin-Key header.
// Body: { dry_run: bool, clusters: [{ keeper_id, dupe_ids: [], field_updates: {} }] }
// For each cluster: re-link contact_log entries from dupe → keeper, then DELETE dupe.
// =========================================================================
async function adminDedupeMerge(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return json({ error: 'forbidden' }, 403);
  }
  const body = await request.json();
  const dryRun = !!body.dry_run;
  const clusters = body.clusters || [];
  if (!Array.isArray(clusters)) return json({ error: 'clusters must be array' }, 400);

  const results = [];
  for (const cluster of clusters) {
    const { keeper_id, dupe_ids, field_updates } = cluster;
    if (!keeper_id || !Array.isArray(dupe_ids) || false) {
      results.push({ keeper_id, error: 'invalid cluster (need keeper_id + non-empty dupe_ids)' });
      continue;
    }

    const r = { keeper_id, dupe_ids, relinked: 0, deleted: 0, errors: [] };

    for (const dupeId of dupe_ids) {
      try {
        // Find all contact_log entries linked to this dupe
        const filter = `FIND('${dupeId}',ARRAYJOIN({contact}))>0`;
        const logIds = [];
        let offset = null;
        do {
          let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=contact`;
          if (offset) q += `&offset=${offset}`;
          const data = await at(env, `/${BASE}/${CONTACT_LOG_TBL}${q}`);
          for (const rec of data.records) logIds.push({ id: rec.id, contact: rec.fields.contact || [] });
          offset = data.offset;
        } while (offset);

        // Re-link each log entry: swap dupeId for keeper_id
        for (const log of logIds) {
          const newContacts = Array.from(new Set(log.contact.map(c => c === dupeId ? keeper_id : c)));
          if (!dryRun) {
            await at(env, `/${BASE}/${CONTACT_LOG_TBL}/${log.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ fields: { contact: newContacts } })
            });
          }
          r.relinked++;
        }

        // Delete the dupe contact
        if (!dryRun) {
          const delUrl = new URL(`https://api.airtable.com/v0/${BASE}/${CONTACTS_TBL}/${dupeId}`);
          const dr = await fetch(delUrl, { method: 'DELETE', headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` } });
          if (dr.ok) r.deleted++;
          else r.errors.push(`delete ${dupeId} failed: ${dr.status} ${await dr.text()}`);
        } else {
          r.deleted++;
        }
      } catch (e) {
        r.errors.push(`dupe ${dupeId}: ${e.message}`);
      }
    }

    // Apply field updates to keeper (e.g. Molly's edits to green-row cells)
    if (field_updates && Object.keys(field_updates).length > 0 && !dryRun) {
      try {
        await at(env, `/${BASE}/${CONTACTS_TBL}/${keeper_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ fields: field_updates, typecast: true })
        });
        r.field_updates_applied = true;
      } catch (e) {
        r.errors.push(`patch keeper ${keeper_id}: ${e.message}`);
      }
    }

    results.push(r);
  }

  if (!dryRun) await invalidateReadCaches(env);
  return json({ ok: true, dry_run: dryRun, clusters: results });
}

// =========================================================================
// /admin/contacts-dump — admin-key gated. Paginated dump of all contacts.
// Query params: ?page_size=100&offset=...  Returns: { records, offset }
// =========================================================================
async function adminContactsDump(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const pageSize = Math.min(parseInt(urlObj.searchParams.get('page_size') || '100'), 100);
  const reqOffset = urlObj.searchParams.get('offset') || '';
  const fields = ['Name','first','last','email','phone','school','district','county','city','state','zip','street_address','leader_ladder','assigned_organizer','source','role'];
  let q = `?pageSize=${pageSize}`;
  for (const f of fields) q += `&fields%5B%5D=${encodeURIComponent(f)}`;
  if (reqOffset) q += `&offset=${encodeURIComponent(reqOffset)}`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  return json({
    records: data.records.map(r => ({ id: r.id, ...r.fields })),
    offset: data.offset || null,
  });
}

// =========================================================================
// /admin/role-append — admin-key gated. Append a role value to multiple
// contacts' multi-select `role` field without overwriting existing values.
// Body: { record_ids: [...], role_value: "Fellow organizer" }
// =========================================================================
async function adminRoleAppend(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const body = await request.json();
  const ids = body.record_ids || [];
  const value = body.role_value;
  if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'record_ids required' }, 400);
  if (!value) return json({ error: 'role_value required' }, 400);

  const results = [];
  for (const id of ids) {
    try {
      const data = await at(env, `/${BASE}/${CONTACTS_TBL}/${id}`);
      const current = Array.isArray(data.fields.role) ? data.fields.role : (data.fields.role ? [data.fields.role] : []);
      if (current.includes(value)) {
        results.push({ id, status: 'already-tagged', role: current });
        continue;
      }
      const next = [...current, value];
      await at(env, `/${BASE}/${CONTACTS_TBL}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: { role: next }, typecast: true })
      });
      results.push({ id, status: 'updated', role: next });
    } catch (e) {
      results.push({ id, status: 'error', error: e.message });
    }
  }
  await invalidateReadCaches(env);
  return json({ ok: true, count: ids.length, results });
}

// =========================================================================
// /admin/queue-check?organizer=lanee — diagnostic: returns the filter formula
// being used + how many records match + first 5 contact names/IDs. Admin-key gated.
// =========================================================================
async function adminQueueCheck(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const organizer = urlObj.searchParams.get('organizer') || null;
  const orgId = organizerId(organizer);
  const filter = prospectsFilter(organizer);
  let q = `?filterByFormula=${encodeURIComponent(filter)}&maxRecords=5&fields%5B%5D=Name&fields%5B%5D=assigned_organizer`;
  const data = await at(env, `/${BASE}/${CONTACTS_TBL}${q}`);
  // count total (separate request without maxRecords sample)
  let total = 0; let offset = null;
  do {
    let cq = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=Name`;
    if (offset) cq += `&offset=${offset}`;
    const cd = await at(env, `/${BASE}/${CONTACTS_TBL}${cq}`);
    total += cd.records.length;
    offset = cd.offset;
  } while (offset);
  return json({
    organizer_param: organizer,
    organizer_id_resolved: orgId,
    filter_formula: filter,
    total_match: total,
    sample: data.records.map(r => ({ id: r.id, name: r.fields.Name, assigned: r.fields.assigned_organizer || [] })),
  });
}

// =========================================================================
// /admin/log-debug?days=1 — returns recent contact_log entries with contact name + assigned organizer.
// Useful for debugging "why are these squares showing up". Admin-key gated.
// =========================================================================
async function adminLogDebug(request, env, urlObj) {
  const key = request.headers.get('X-Admin-Key');
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ error: 'forbidden' }, 403);
  const days = parseInt(urlObj.searchParams.get('days') || '1');
  const filter = `IS_AFTER({date},DATEADD(TODAY(),-${days},'days'))`;
  let q = `?filterByFormula=${encodeURIComponent(filter)}&pageSize=100&fields%5B%5D=date&fields%5B%5D=method&fields%5B%5D=result&fields%5B%5D=event&fields%5B%5D=contact&fields%5B%5D=Summary&fields%5B%5D=notes`;
  const logs = [];
  let offset = null;
  do {
    let url = `/${BASE}/${CONTACT_LOG_TBL}${q}${offset ? `&offset=${offset}` : ''}`;
    const data = await at(env, url);
    logs.push(...data.records);
    offset = data.offset;
  } while (offset);

  // For each log, look up the contact's name + assigned_organizer
  const results = [];
  for (const log of logs) {
    const contactIds = log.fields.contact || [];
    const contactInfo = [];
    for (const cid of contactIds) {
      try {
        const c = await at(env, `/${BASE}/${CONTACTS_TBL}/${cid}`);
        contactInfo.push({
          id: cid,
          name: c.fields.Name || `${c.fields.first||''} ${c.fields.last||''}`.trim(),
          assigned: c.fields.assigned_organizer || [],
        });
      } catch (e) {
        contactInfo.push({ id: cid, error: e.message });
      }
    }
    results.push({
      log_id: log.id,
      date: log.fields.date,
      method: log.fields.method,
      result: log.fields.result,
      event: log.fields.event,
      summary: log.fields.Summary,
      notes: log.fields.notes,
      contacts: contactInfo,
    });
  }
  return json({ count: results.length, logs: results });
}
