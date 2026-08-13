// Pulse free-things harvester (W19) — the entire "backend".
// $0 to run: a plain Node script (no DB, no Claude, no Google Places). Meant to
// run on a GitHub Actions cron and commit output/{city}.json, which the app
// fetches as a static file. Sources are STRUCTURED (deterministic parsing),
// so there is zero per-run API cost.
//
// Usage: node harvest.mjs omaha
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- date window: today + tomorrow, in the city's timezone ----
function cityDays(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date());
  const t = new Date(today + "T00:00:00");
  const tomorrow = fmt.format(new Date(t.getTime() + 86400000));
  return { today, tomorrow, set: new Set([today, tomorrow]) };
}

async function get(url, ms = 20000, headers = {}) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: c.signal });
  } finally {
    clearTimeout(timer);
  }
}

const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const canonical = (title, venue, date) => `${slug(title)}|${slug(venue)}|${date}`;

// Drop promo/spam that isn't a real "thing to do", and things outside the metro.
const SPAM = /(complimentary|free trial|work for a day|best workday|backpack giveaway|real estate investor|empower your finances|open house|we create|webinar|make money|side hustle|credit repair|\bmlm\b|board of regents|regus)/i;
function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function relevant(e, city) {
  if (SPAM.test(e.title || "")) return false;
  if (e.online) return true; // online free things are fine
  if (e.location) return haversineKm(e.location, city.center) <= (city.metroRadiusKm ?? 45);
  // no coords: keep only if the venue/address names an in-metro place
  const hay = `${e.venue} ${e.address}`.toLowerCase();
  const near = (city.nearby ?? []).some((n) => hay.includes(n));
  const farCity = /\b(lincoln|york|sioux city|grand island|kearney|norfolk|fremont)\b/i.test(hay);
  return near && !farCity;
}

// ---------- Eventbrite: date-scoped FREE pages (structured JS blob) ----------
function parseEventbriteServerData(html) {
  const m = html.match(/window\.__SERVER_DATA__\s*=\s*(\{)/);
  if (!m) return [];
  const start = m.index + m[0].length - 1;
  let depth = 0, end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return [];
  let data;
  try { data = JSON.parse(html.slice(start, end)); } catch { return []; }
  const results = data?.search_data?.events?.results ?? [];
  return results.map((e) => {
    const v = e.primary_venue ?? {};
    const addr = v.address ?? {};
    return {
      name: e.name, date: e.start_date, time: e.start_time || "",
      venue: v.name || "", address: addr.localized_address_display || "",
      lat: addr.latitude ? Number(addr.latitude) : null,
      lng: addr.longitude ? Number(addr.longitude) : null,
      online: !!e.is_online_event, url: e.url || "",
      summary: (e.summary || "").slice(0, 160),
      tags: (e.tags || []).map((t) => t.display_name).filter(Boolean).slice(0, 3),
    };
  });
}

async function eventbrite(city, win) {
  const events = [];
  for (const scope of ["today", "tomorrow", "this-weekend"]) {
    try {
      const r = await get(`https://www.eventbrite.com/d/${city.state}--${city.name.toLowerCase()}/free--events--${scope}/`);
      const html = await r.text();
      for (const e of parseEventbriteServerData(html)) {
        if (!win.set.has(e.date)) continue;
        events.push({
          source: "eventbrite",
          title: e.name,
          startISO: e.time ? `${e.date}T${e.time}:00` : `${e.date}T00:00:00`,
          date: e.date,
          venue: e.online ? "Online" : e.venue,
          address: e.online ? "" : e.address,
          location: e.lat != null && e.lng != null ? { lat: e.lat, lng: e.lng } : null,
          url: e.url,
          summary: e.summary,
          category: (e.tags[0] || "event").toLowerCase(),
          free: true,
          price: "Free",
        });
      }
    } catch { /* one scope failing is fine */ }
  }
  return events;
}

// ---------- Localist (universities / civic) — free JSON API ----------
async function localist(city, win) {
  const out = [];
  for (const base of city.localistBases ?? []) {
    try {
      const r = await get(`${base}/api/2/events?days=2&pp=100`);
      if (!r.ok) continue;
      const j = await r.json();
      for (const wrap of j.events ?? []) {
        const ev = wrap.event ?? wrap;
        const inst = (ev.event_instances ?? [])[0]?.event_instance ?? {};
        const start = inst.start || ev.first_date || "";
        const date = String(start).slice(0, 10);
        if (!win.set.has(date)) continue;
        const free = ev.free === true || ev.ticket_cost === "" || /(^|\b)free\b/i.test(ev.ticket_cost || "");
        out.push({
          source: `localist:${new URL(base).hostname}`,
          title: ev.title,
          startISO: start,
          date,
          venue: ev.venue_name || ev.location_name || "",
          address: ev.address || "",
          location: ev.geo?.latitude ? { lat: Number(ev.geo.latitude), lng: Number(ev.geo.longitude) } : null,
          url: ev.localist_url || ev.url || "",
          summary: (ev.description_text || "").slice(0, 160),
          category: (ev.filters?.event_types?.[0]?.name || "event").toLowerCase(),
          free,
          price: free ? "Free" : (ev.ticket_cost || ""),
        });
      }
    } catch { /* skip a dead base */ }
  }
  return out;
}

// ---------- run ----------
const cityId = process.argv[2] || "omaha";
const city = JSON.parse(fs.readFileSync(path.join(__dirname, "cities", `${cityId}.json`), "utf8"));
const win = cityDays(city.tz);
console.error(`Harvesting ${city.name} · ${win.today} + ${win.tomorrow}`);

const collected = (await Promise.allSettled([eventbrite(city, win), localist(city, win)]))
  .flatMap((r) => (r.status === "fulfilled" ? r.value : []));

// keep only free (or cheap<$10) for this slice; dedupe by title+date
const seen = new Set();
const events = collected
  .filter((e) => e.title && e.free && relevant(e, city))
  .filter((e) => {
    const k = canonical(e.title, e.venue, e.date);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  })
  .sort((a, b) => String(a.startISO).localeCompare(String(b.startISO)));

const result = {
  city: city.id,
  cityName: city.name,
  center: city.center,
  window: { today: win.today, tomorrow: win.tomorrow },
  generatedAt: new Date().toISOString(),
  counts: {
    total: events.length,
    today: events.filter((e) => e.date === win.today).length,
    tomorrow: events.filter((e) => e.date === win.tomorrow).length,
  },
  events,
  evergreen: city.evergreen ?? [],
};

const outPath = path.join(__dirname, "output", `${city.id}.json`);
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.error(`\nFREE events: ${result.counts.total} (today ${result.counts.today}, tomorrow ${result.counts.tomorrow}) + ${result.evergreen.length} evergreen`);
for (const e of events.slice(0, 20)) {
  const day = e.date === win.today ? "TODAY" : "TMRW ";
  console.error(`  ${day} ${(e.startISO.slice(11, 16) || "--:--")}  ${e.title.slice(0, 46).padEnd(46)} @ ${e.venue.slice(0, 24)}`);
}
console.error(`\nwrote ${path.relative(process.cwd(), outPath)}`);
