// Source-of-truth spec for the ranking heuristic:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/plan-day/SKILL.md
//
// This file is the TypeScript mirror of
// shared/src/commonMain/kotlin/com/austinconnor/pulse/shared/Types.kt
// — the Kotlin file is the source of truth; the two must stay in lockstep.
// Enums map to string-literal union types matching the Kotlin @SerialName values verbatim.

// ---------- Lockstep ----------

// Bump on any change to the scoring math, wire shapes, or signal set so cached
// results from older versions can be invalidated. Must equal the same constant
// in Types.kt and the value in shared/parity-fixture.json.
export const heuristicVersion = '5sig-2026.06';

// ---------- Common ----------

export interface Location {
  label?: string;
  lat: number;
  lng: number;
}

// ---------- find-spots ----------

export type FindSpotsMode = 'lightweight' | 'deep';

export interface FindSpotsRequest {
  purpose: string;
  location: Location;
  whenISO?: string;
  mode?: FindSpotsMode;
  maxResults?: number;
}

export interface ScoreBreakdown {
  consensus: number;
  recency: number;
  useCaseFit: number;
  distance: number;
  // Kotlin default: 0.0 — optional on the wire, treat undefined as 0.
  realTimeRelevance?: number;
}

export interface ScoredSpot {
  id: string;
  name: string;
  address: string;
  location: Location;
  walkMinutes: number;
  tier: number;
  score: number;
  breakdown: ScoreBreakdown;
  why: string;
  attributes?: string[];
  openNow?: boolean;
  hoursToday?: string;
  photoUrl?: string;
  sources?: string[];
  liveEvents?: Event[];
}

// ---------- events (real-time signal) ----------

export type EventSource =
  | 'news'          // Gothamist, Time Out, NYT, ABC7…
  | 'civic'         // nyc.gov, mayor's office, NYC Parks
  | 'reddit'
  | 'eventbrite'
  | 'dice'
  | 'ra'            // Resident Advisor
  | 'instagram'
  | 'x'
  | 'livesearch'    // per-query LLM+web fallback
  | 'user';         // submitted in-app

export type EventConfidence =
  | 'confirmed'     // primary source, official announcement
  | 'likely'        // 2+ secondary sources
  | 'rumored';      // 1 source, unverified

export interface Event {
  id: string;
  title: string;
  description?: string;
  startISO: string;
  endISO?: string;
  venueName?: string;
  venuePlaceId?: string;
  location?: Location;
  tags?: string[];                  // ["watch-party", "knicks", "free", "outdoor"]
  sources?: EventSource[];
  sourceUrls?: string[];
  announcedAtISO: string;           // when we first saw it — drives recency decay
  confidence?: EventConfidence;     // Kotlin default: 'likely'
  cost?: string;                    // "free", "$25", "$50+"
  supersedes?: string;              // event ID this replaces
}

export interface EventsFeedRequest {
  location: Location;
  whenStartISO?: string;            // default: now
  whenEndISO?: string;              // default: end of today
  purposes?: string[];              // optional purpose filters
  maxResults?: number;
  includeLiveSearch?: boolean;      // default: true — per-query live web search
}

export interface EventsFreshness {
  newestAnnouncedAtISO: string | null;  // age of the hottest item — UI surfaces it
  oldestIngestedAtISO: string | null;
  sourcesPolled: EventSource[];
  cacheHitRatio: number;            // 0–1, drives "live" badge in UI
}

export interface EventsFeedResponse {
  events: Event[];
  generatedAt: string;
  freshness: EventsFreshness;
}

export interface FindSpotsResponse {
  spots: ScoredSpot[];
  generatedAt: string;
  mode: FindSpotsMode;
}

// ---------- plan-day ----------

export type OptimizationTarget =
  | 'balanced'
  | 'novelty'
  | 'meet-people'
  | 'enjoyment'
  | 'recovery';

export type EnergyLevel = 'hard' | 'medium' | 'recovery';

export type SlotKind =
  | 'morning'
  | 'workday'
  | 'lunch'
  | 'afternoon'
  | 'pre-anchor'
  | 'anchor'
  | 'late-night'
  | 'weekend-daytime';

export interface ItineraryDay {
  dateISO: string;
  neighborhood?: string;
  anchorVenue?: string;
  anchorTimeISO?: string;
  gameNight?: boolean;
  isSober?: boolean;
}

export interface RecentPlan {
  dateISO: string;
  neighborhoods: string[];
  venueIds: string[];
}

export interface PlanDayRequest {
  dateISO: string;
  anchorLocation: Location;
  optimizeFor?: OptimizationTarget;
  energy?: EnergyLevel;
  itinerary?: ItineraryDay;
  recentPlans?: RecentPlan[];
}

export interface PlannedSlot {
  kind: SlotKind;
  startISO: string;
  endISO: string;
  purpose: string;
  pick?: ScoredSpot;
  alternates?: ScoredSpot[];
  fixed?: boolean;
  note?: string;
}

export interface SpendEstimate {
  cafe: number;
  food: number;
  drinks: number;
  cover: number;
  transit: number;
  total: number;
  currency?: string;                // Kotlin default: "USD"
}

export interface PlanDayResponse {
  dateISO: string;
  optimizeFor: OptimizationTarget;
  energy: EnergyLevel;
  vibe: string;
  slots: PlannedSlot[];
  geographicFlow: string;
  totalTransitMinutes: number;
  spendEstimate: SpendEstimate;
  tradeoffs: string[];
  generatedAt: string;
}

// ---------- user feedback (the learning loop) ----------

export type InteractionKind =
  | 'spot_impression'
  | 'spot_tap'
  | 'spot_save'
  | 'spot_directions'
  | 'spot_share'
  | 'plan_view'
  | 'plan_slot_view'
  | 'plan_save'
  | 'spot_visit_confirmed'
  | 'spot_rating'
  | 'spot_thumbs_up'
  | 'spot_thumbs_down'
  | 'plan_slot_override'
  | 'plan_target_change'
  | 're_query_same_purpose';

export interface LogInteractionRequest {
  kind: InteractionKind;
  spotPlaceId?: string;
  eventId?: string;
  dayPlanId?: string;
  queryPurpose?: string;
  queryLocation?: Location;
  rankPosition?: number;
  scoreAtImpression?: number;
  scoreBreakdown?: ScoreBreakdown;
  ratingValue?: number;
  overrideFromPlaceId?: string;
  overrideToPlaceId?: string;
  notes?: string;
  heuristicVersion?: string;
  clientApp?: string;
  clientVersion?: string;
}

export interface LogInteractionResponse {
  ok: boolean;
  dropped?: string;
}
