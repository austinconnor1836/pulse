// Google Places client — Text Search (Places API New) + Distance Matrix (Maps legacy).
// Consumed by find-spots (W5), plan-day via find-spots (W6), enrich-business (W11).
// Pagination + 429/5xx backoff + optional fixture/replay built in. Never logs API keys.
// Source-of-truth spec: specs/W3-google-places-client/spec.md

import { config } from './env.ts';
import type { Location } from '../../../shared/types.ts';

export interface PlacesCandidate {
  id: string;
  name: string;
  address: string;
  location: Location;
  rating?: number;
  hoursToday?: string;
}

export class PlacesError extends Error {
  constructor(
    public readonly operation: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Places ${operation} failed (${status}): ${truncate(body, 200)}`);
    this.name = 'PlacesError';
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

export const DEFAULT_BACKOFF_MS = [1000, 4000] as const;

export interface FetchOpts {
  backoffMs?: readonly number[];
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const TEXT_SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,' +
  'places.rating,places.regularOpeningHours,nextPageToken';
const MAX_TEXT_SEARCH_RESULTS = 60;
const MAX_DISTANCE_MATRIX_BATCH = 25;
const TEXT_SEARCH_RADIUS_M = 5000;

// JSON.stringify replacer that sorts object keys recursively so the hash is stable
// regardless of in-source key order.
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

async function hashRequest(operation: string, request: unknown): Promise<string> {
  const payload = operation + '|' + JSON.stringify(request, sortKeysReplacer);
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}

function fixturePath(dir: string, hash: string): string {
  return `${dir.replace(/\/$/, '')}/${hash}.json`;
}

async function readFixture(dir: string, hash: string): Promise<unknown | null> {
  try {
    const text = await Deno.readTextFile(fixturePath(dir, hash));
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function writeFixture(dir: string, hash: string, payload: unknown): Promise<void> {
  try {
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fixturePath(dir, hash), JSON.stringify(payload, null, 2));
  } catch {
    // Best-effort capture; never fail the request because we couldn't record.
  }
}

interface FetchInit {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  // The cache key uses (url, body) — query-string state is already in url for GET.
  cacheKey: { url: string; body?: string };
}

async function fetchJson<T>(
  operation: string,
  init: FetchInit,
  opts: FetchOpts = {},
): Promise<T> {
  const fixtureDir = Deno.env.get('PLACES_FIXTURE_DIR');
  const recordDir = Deno.env.get('PLACES_RECORD_DIR');
  const hash = fixtureDir || recordDir ? await hashRequest(operation, init.cacheKey) : '';

  if (fixtureDir) {
    const cached = await readFixture(fixtureDir, hash);
    if (cached !== null) return cached as T;
  }

  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  let attempt = 0;
  // Loop runs once + at most `backoff.length` retries.
  while (true) {
    const res = await fetch(init.url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    if (res.ok) {
      const payload = await res.json();
      if (recordDir) await writeFixture(recordDir, hash, payload);
      return payload as T;
    }
    const retryable = RETRYABLE_STATUSES.has(res.status) && attempt < backoff.length;
    if (!retryable) {
      const body = await res.text();
      throw new PlacesError(operation, res.status, body);
    }
    await new Promise((r) => setTimeout(r, backoff[attempt]));
    attempt++;
  }
}

// Google's regularOpeningHours.weekdayDescriptions is Monday-first;
// JS Date.getDay() is Sunday=0. Map: Sun→6, Mon→0, Tue→1, …, Sat→5.
function todayWeekdayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

interface RawTextSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location: { latitude: number; longitude: number };
    rating?: number;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
  }>;
  nextPageToken?: string;
}

function normalizeTextSearchPlace(
  p: NonNullable<RawTextSearchResponse['places']>[number],
): PlacesCandidate {
  return {
    id: p.id,
    name: p.displayName?.text ?? p.id,
    address: p.formattedAddress ?? '',
    location: { lat: p.location.latitude, lng: p.location.longitude },
    rating: typeof p.rating === 'number' ? p.rating : undefined,
    hoursToday: p.regularOpeningHours?.weekdayDescriptions?.[todayWeekdayIndex()],
  };
}

export async function textSearch(
  purpose: string,
  location: Location,
  opts: FetchOpts = {},
): Promise<PlacesCandidate[]> {
  const apiKey = config.googlePlacesApiKey; // throws ConfigError if unset
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': apiKey,
    'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
  };
  const candidates: PlacesCandidate[] = [];
  let pageToken: string | undefined;
  while (candidates.length < MAX_TEXT_SEARCH_RESULTS) {
    const body: Record<string, unknown> = {
      textQuery: purpose,
      locationBias: {
        circle: {
          center: { latitude: location.lat, longitude: location.lng },
          radius: TEXT_SEARCH_RADIUS_M,
        },
      },
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;
    const bodyStr = JSON.stringify(body);
    const response = await fetchJson<RawTextSearchResponse>(
      'textSearch',
      {
        url: TEXT_SEARCH_URL,
        method: 'POST',
        headers,
        body: bodyStr,
        cacheKey: { url: TEXT_SEARCH_URL, body: bodyStr },
      },
      opts,
    );
    for (const p of response.places ?? []) {
      candidates.push(normalizeTextSearchPlace(p));
      if (candidates.length >= MAX_TEXT_SEARCH_RESULTS) break;
    }
    if (!response.nextPageToken) break;
    pageToken = response.nextPageToken;
  }
  return candidates;
}

interface RawDistanceMatrixResponse {
  rows?: Array<{
    elements?: Array<{
      status?: string;
      duration?: { value?: number; text?: string };
    }>;
  }>;
}

export async function distanceMatrix(
  origin: Location,
  candidates: readonly PlacesCandidate[],
  opts: FetchOpts = {},
): Promise<Map<string, number>> {
  const apiKey = config.googlePlacesApiKey;
  const result = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += MAX_DISTANCE_MATRIX_BATCH) {
    const chunk = candidates.slice(i, i + MAX_DISTANCE_MATRIX_BATCH);
    const destinations = chunk
      .map((c) => `${c.location.lat},${c.location.lng}`)
      .join('|');
    const url =
      `${DISTANCE_MATRIX_URL}?origins=${origin.lat},${origin.lng}` +
      `&destinations=${encodeURIComponent(destinations)}` +
      `&mode=walking&key=${encodeURIComponent(apiKey)}`;
    const cacheKeyUrl =
      `${DISTANCE_MATRIX_URL}?origins=${origin.lat},${origin.lng}` +
      `&destinations=${encodeURIComponent(destinations)}&mode=walking`;
    const response = await fetchJson<RawDistanceMatrixResponse>(
      'distanceMatrix',
      {
        url,
        method: 'GET',
        headers: {},
        cacheKey: { url: cacheKeyUrl },
      },
      opts,
    );
    const elements = response.rows?.[0]?.elements ?? [];
    elements.forEach((el, idx) => {
      if (el.status === 'OK' && typeof el.duration?.value === 'number') {
        result.set(chunk[idx].id, Math.round(el.duration.value / 60));
      }
    });
  }
  return result;
}
