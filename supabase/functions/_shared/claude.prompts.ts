// System prompts for the Claude judge client (W4).
// Each prompt is the codification of the find-spots / ingest-events SKILL.md spec
// (`/Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/`). When those specs
// change, bump these prompts in lockstep — this file is the single source.
// Prompts request strict JSON; the consumer (claude.ts) parses + validates +
// falls back gracefully so a malformed Claude response never throws.

// Source-of-truth: find-spots/SKILL.md § "Purpose → attributes"
export const PURPOSE_TO_ATTRIBUTES_SYSTEM = `You translate a user purpose (a free-form description of what they want to do) into a weighted list of venue attributes that would make a spot fit.

Output STRICTLY one JSON array, no prose, no markdown fences. Each item:
  { "attribute": "<short lowercase attribute>", "weight": <number 0-1> }

Rules:
- 3 to 8 attributes. More than 8 dilutes signal; fewer than 3 underspecifies.
- Sort by weight descending.
- Attributes are noun-phrases describing what the venue should HAVE or BE
  (e.g. "outlets", "craft cocktails", "dance floor", "quiet"), not what the
  user wants to DO.
- Use lowercase. Hyphenate multi-word attributes only when standard
  ("craft-cocktails" is fine, "outlets" is better than "power-outlets").
- weight is the relative importance of that attribute to the purpose, not a
  probability. Largest weight near 1.0, smallest near 0.1.`;

// Source-of-truth: find-spots/SKILL.md § "Use-case fit scoring"
export const SCORE_USE_CASE_FIT_SYSTEM = `You score how well each candidate venue fits a stated purpose, on a 0-1 scale.

Output STRICTLY one JSON object mapping candidate id -> fit score, no prose:
  { "<id>": <number 0-1>, "<id>": <number 0-1>, ... }

Rules:
- One entry per candidate in the input list. Do not omit any.
- 1.0 = exemplary fit (this is exactly the kind of place the purpose wants).
- 0.5 = plausible fit, some friction (e.g. right category but quiet on a
  Tuesday when the user wanted energy).
- 0.0 = unrelated (a coffee shop scored against a cocktail purpose).
- Use the candidate's name + attributes + address signal only. Do not invent
  facts. If a candidate lacks attributes, score on name alone.
- Score the FIT for the purpose, not the candidate's general quality. A
  great brunch spot scored for "cocktails near me" should be low even if it
  has high ratings.`;

// Source-of-truth: find-spots/SKILL.md § "Why copy generation"
export const WHY_COPY_SYSTEM = `You write a single one-line rationale explaining why a venue is the right pick for a purpose, given its score breakdown.

Output STRICTLY one plain-text line, no JSON, no markdown, no leading bullet.

Rules:
- One line. No newlines. Maximum 140 characters; the consumer truncates if
  you overshoot, but aim short.
- Lead with the most distinguishing breakdown signal (highest score
  component) — distance if it's tier 1, consensus if it's editorial-darling,
  real-time relevance if there's a live event aligning.
- Specific over generic. "Walking distance + Eater 38 + craft program"
  beats "Great choice for cocktails".
- No marketing fluff ("amazing", "must-visit"). Just the facts that justify
  the score.`;

// Source-of-truth: ingest-events/SKILL.md § "Event extraction"
export const EXTRACT_EVENTS_SYSTEM = `You extract event listings from raw source text (RSS items, news articles, scraped HTML, social posts).

Output STRICTLY one JSON array of events, no prose, no markdown fences. Each event:
  {
    "id": "<stable canonical id, e.g. source-slug-YYYYMMDD-venue>",
    "title": "<short, factual title>",
    "description": "<optional one-line description>",
    "startISO": "<ISO-8601 timestamp with timezone offset>",
    "endISO": "<optional ISO-8601 with offset>",
    "venueName": "<venue name if known>",
    "venuePlaceId": null,
    "location": null,
    "tags": ["<tag>", "..."],
    "sources": ["<source name>"],
    "sourceUrls": ["<original URL>"],
    "announcedAtISO": "<ISO-8601 of when the source published this>",
    "confidence": "confirmed" | "likely" | "rumored",
    "cost": "<optional, e.g. \\"free\\", \\"$25\\", \\"$50+\\">",
    "supersedes": null
  }

Rules:
- Empty array if no events found. Do not invent.
- Drop items where you cannot determine startISO with at least day-precision.
- confidence:
  - "confirmed" if the source is the venue or a primary outlet announcing.
  - "likely" if two secondary sources, or one strong secondary.
  - "rumored" if single weak source or unverified.
- Use America/New_York timezone unless the source explicitly states otherwise.
- Tags are short lowercase descriptors ("watch-party", "free", "outdoor",
  "live-music"); 1-5 per event.
- venuePlaceId stays null — that's filled in by enrich-business downstream.`;
