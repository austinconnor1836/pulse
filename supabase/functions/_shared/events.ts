// Shared events query layer (W7). One owner for both reads (find-spots
// real-time-relevance + events-feed) and writes (ingest-events cron). PostGIS
// KNN runs in the `public.nearby_events` SQL function
// (migration 00000000000008); this module is the thin TS wrapper + the
// row<->Event mapping. Source-of-truth: specs/W7-events-query-layer/spec.md

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.39.7';
import type {
  Event,
  EventConfidence,
  EventSource,
  Location,
} from '../../../shared/types.ts';

export interface TimeWindow {
  startISO?: string;
  endISO?: string;
}

export class EventsQueryError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string,
    public readonly details: string,
  ) {
    super(`Events ${operation} failed (${code}): ${details}`);
    this.name = 'EventsQueryError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

const VALID_CONFIDENCE: ReadonlySet<EventConfidence> = new Set<EventConfidence>([
  'confirmed', 'likely', 'rumored',
]);

const VALID_SOURCE: ReadonlySet<EventSource> = new Set<EventSource>([
  'news', 'civic', 'reddit', 'eventbrite', 'dice', 'ra', 'instagram', 'x',
  'livesearch', 'user',
]);

interface NearbyEventsRow {
  id: string;
  canonical_key: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  announced_at: string;
  ingested_at: string;
  venue_name: string | null;
  venue_place_id: string | null;
  lat: number | null;
  lng: number | null;
  tags: string[] | null;
  sources: string[] | null;
  source_urls: string[] | null;
  confidence: string | null;
  cost: string | null;
  supersedes_id: string | null;
}

export function rowToEvent(row: NearbyEventsRow): Event {
  const event: Event = {
    id: row.id,
    title: row.title,
    startISO: row.start_at,
    announcedAtISO: row.announced_at,
  };
  if (row.description) event.description = row.description;
  if (row.end_at) event.endISO = row.end_at;
  if (row.venue_name) event.venueName = row.venue_name;
  if (row.venue_place_id) event.venuePlaceId = row.venue_place_id;
  if (row.lat !== null && row.lng !== null) {
    event.location = { lat: row.lat, lng: row.lng };
  }
  if (row.tags && row.tags.length > 0) event.tags = row.tags;
  if (row.sources && row.sources.length > 0) {
    event.sources = row.sources.filter((s): s is EventSource => VALID_SOURCE.has(s as EventSource));
  }
  if (row.source_urls && row.source_urls.length > 0) event.sourceUrls = row.source_urls;
  if (row.confidence && VALID_CONFIDENCE.has(row.confidence as EventConfidence)) {
    event.confidence = row.confidence as EventConfidence;
  }
  if (row.cost) event.cost = row.cost;
  if (row.supersedes_id) event.supersedes = row.supersedes_id;
  return event;
}

interface EventRowForUpsert {
  canonical_key: string;
  title: string;
  description?: string;
  start_at: string;
  end_at?: string;
  announced_at: string;
  venue_name?: string;
  venue_place_id?: string;
  geo?: string;
  tags: string[];
  sources: string[];
  source_urls: string[];
  confidence: EventConfidence;
  cost?: string;
  supersedes_id?: string;
}

export function eventToRow(event: Event): EventRowForUpsert {
  const row: EventRowForUpsert = {
    canonical_key: idToCanonicalKey(event),
    title: event.title,
    start_at: event.startISO,
    announced_at: event.announcedAtISO,
    tags: event.tags ?? [],
    sources: event.sources ?? [],
    source_urls: event.sourceUrls ?? [],
    confidence: event.confidence ?? 'likely',
  };
  if (event.description) row.description = event.description;
  if (event.endISO) row.end_at = event.endISO;
  if (event.venueName) row.venue_name = event.venueName;
  if (event.venuePlaceId) row.venue_place_id = event.venuePlaceId;
  if (event.location) {
    row.geo = `SRID=4326;POINT(${event.location.lng} ${event.location.lat})`;
  }
  if (event.cost) row.cost = event.cost;
  if (event.supersedes) row.supersedes_id = event.supersedes;
  return row;
}

// Event.id is the wire-shape identifier; the DB's `canonical_key` is what
// dedupes ingestions. We pass event.id as the canonical_key — W4's
// extractEvents emits stable ids ("source-slug-YYYYMMDD-venue") that already
// fit that semantic. ingest-events callers can also supply their own
// canonical_key by overriding event.id pre-upsert.
function idToCanonicalKey(event: Event): string {
  return event.id;
}

export async function nearbyEvents(
  client: SupabaseClient,
  location: Location,
  radiusMeters: number,
  timeWindow: TimeWindow = {},
): Promise<Event[]> {
  const now = new Date();
  const startISO = timeWindow.startISO ?? now.toISOString();
  const endISO = timeWindow.endISO ?? new Date(now.getTime() + DAY_MS).toISOString();
  const { data, error } = await client.rpc('nearby_events', {
    origin_lat: location.lat,
    origin_lng: location.lng,
    radius_m: radiusMeters,
    when_start: startISO,
    when_end: endISO,
    max_results: 50,
  });
  if (error) {
    throw new EventsQueryError('nearbyEvents', error.code ?? 'unknown', error.message ?? String(error));
  }
  const rows = (data ?? []) as NearbyEventsRow[];
  return rows.map(rowToEvent);
}

export async function upsertEvents(
  client: SupabaseClient,
  events: readonly Event[],
): Promise<{ upserted: number; errors: number }> {
  if (events.length === 0) return { upserted: 0, errors: 0 };
  const rows = events.map(eventToRow);
  const { error } = await client
    .from('events')
    .upsert(rows, { onConflict: 'canonical_key', ignoreDuplicates: false });
  if (error) {
    console.error(`upsertEvents: ${events.length} row(s) failed`, error);
    return { upserted: 0, errors: events.length };
  }
  return { upserted: events.length, errors: 0 };
}
