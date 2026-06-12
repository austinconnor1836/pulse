package com.austinconnor.pulse.shared

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Source-of-truth spec for the ranking heuristic:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/plan-day/SKILL.md

// ---------- Lockstep ----------

// Bump on any change to the scoring math, wire shapes, or signal set so cached
// results from older versions can be invalidated. Must equal the same constant
// in shared/types.ts and the value in shared/parity-fixture.json.
const val heuristicVersion: String = "5sig-2026.06"

// ---------- Common ----------

@Serializable
data class Location(
    val label: String? = null,
    val lat: Double,
    val lng: Double,
)

// ---------- find-spots ----------

@Serializable
enum class FindSpotsMode {
    @SerialName("lightweight") LIGHTWEIGHT,
    @SerialName("deep") DEEP,
}

@Serializable
data class FindSpotsRequest(
    val purpose: String,
    val location: Location,
    val whenISO: String? = null,
    val mode: FindSpotsMode? = null,
    val maxResults: Int? = null,
)

@Serializable
data class ScoreBreakdown(
    val consensus: Double,
    val recency: Double,
    val useCaseFit: Double,
    val distance: Double,
    val realTimeRelevance: Double = 0.0,
)

@Serializable
data class ScoredSpot(
    val id: String,
    val name: String,
    val address: String,
    val location: Location,
    val walkMinutes: Int,
    val tier: Int,
    val score: Double,
    val breakdown: ScoreBreakdown,
    val why: String,
    val attributes: List<String> = emptyList(),
    val openNow: Boolean? = null,
    val hoursToday: String? = null,
    val photoUrl: String? = null,
    val sources: List<String> = emptyList(),
    val liveEvents: List<Event> = emptyList(),
)

// ---------- events (real-time signal) ----------

@Serializable
enum class EventSource {
    @SerialName("news") NEWS,            // Gothamist, Time Out, NYT, ABC7…
    @SerialName("civic") CIVIC,          // nyc.gov, mayor's office, NYC Parks
    @SerialName("reddit") REDDIT,
    @SerialName("eventbrite") EVENTBRITE,
    @SerialName("dice") DICE,
    @SerialName("ra") RA,                // Resident Advisor
    @SerialName("instagram") INSTAGRAM,
    @SerialName("x") X,
    @SerialName("livesearch") LIVE_SEARCH, // per-query LLM+web fallback
    @SerialName("user") USER,            // submitted in-app
}

@Serializable
enum class EventConfidence {
    @SerialName("confirmed") CONFIRMED,  // primary source, official announcement
    @SerialName("likely") LIKELY,        // 2+ secondary sources
    @SerialName("rumored") RUMORED,      // 1 source, unverified
}

@Serializable
data class Event(
    val id: String,
    val title: String,
    val description: String? = null,
    val startISO: String,
    val endISO: String? = null,
    val venueName: String? = null,
    val venuePlaceId: String? = null,
    val location: Location? = null,
    val tags: List<String> = emptyList(),                 // ["watch-party", "knicks", "free", "outdoor"]
    val sources: List<EventSource> = emptyList(),
    val sourceUrls: List<String> = emptyList(),
    val announcedAtISO: String,                           // when we first saw it — drives recency decay
    val confidence: EventConfidence = EventConfidence.LIKELY,
    val cost: String? = null,                             // "free", "$25", "$50+"
    val supersedes: String? = null,                       // event ID this replaces (e.g., the cancelled MSG watch party)
)

@Serializable
data class EventsFeedRequest(
    val location: Location,
    val whenStartISO: String? = null,                     // default: now
    val whenEndISO: String? = null,                       // default: end of today
    val purposes: List<String> = emptyList(),             // optional purpose filters
    val maxResults: Int? = null,
    val includeLiveSearch: Boolean = true,                // run per-query live web search
)

@Serializable
data class EventsFeedResponse(
    val events: List<Event>,
    val generatedAt: String,
    val freshness: EventsFreshness,
)

@Serializable
data class EventsFreshness(
    val newestAnnouncedAtISO: String?,                    // age of the hottest item — UI surfaces it
    val oldestIngestedAtISO: String?,
    val sourcesPolled: List<EventSource>,
    val cacheHitRatio: Double,                            // 0–1, drives "live" badge in UI
)

@Serializable
data class FindSpotsResponse(
    val spots: List<ScoredSpot>,
    val generatedAt: String,
    val mode: FindSpotsMode,
)

// ---------- plan-day ----------

@Serializable
enum class OptimizationTarget {
    @SerialName("balanced") BALANCED,
    @SerialName("novelty") NOVELTY,
    @SerialName("meet-people") MEET_PEOPLE,
    @SerialName("enjoyment") ENJOYMENT,
    @SerialName("recovery") RECOVERY,
}

@Serializable
enum class EnergyLevel {
    @SerialName("hard") HARD,
    @SerialName("medium") MEDIUM,
    @SerialName("recovery") RECOVERY,
}

@Serializable
enum class SlotKind {
    @SerialName("morning") MORNING,
    @SerialName("workday") WORKDAY,
    @SerialName("lunch") LUNCH,
    @SerialName("afternoon") AFTERNOON,
    @SerialName("pre-anchor") PRE_ANCHOR,
    @SerialName("anchor") ANCHOR,
    @SerialName("late-night") LATE_NIGHT,
    @SerialName("weekend-daytime") WEEKEND_DAYTIME,
}

@Serializable
data class ItineraryDay(
    val dateISO: String,
    val neighborhood: String? = null,
    val anchorVenue: String? = null,
    val anchorTimeISO: String? = null,
    val gameNight: Boolean? = null,
    val isSober: Boolean? = null,
)

@Serializable
data class RecentPlan(
    val dateISO: String,
    val neighborhoods: List<String>,
    val venueIds: List<String>,
)

@Serializable
data class PlanDayRequest(
    val dateISO: String,
    val anchorLocation: Location,
    val optimizeFor: OptimizationTarget? = null,
    val energy: EnergyLevel? = null,
    val itinerary: ItineraryDay? = null,
    val recentPlans: List<RecentPlan>? = null,
)

@Serializable
data class PlannedSlot(
    val kind: SlotKind,
    val startISO: String,
    val endISO: String,
    val purpose: String,
    val pick: ScoredSpot? = null,
    val alternates: List<ScoredSpot> = emptyList(),
    val fixed: Boolean = false,
    val note: String? = null,
)

@Serializable
data class SpendEstimate(
    val cafe: Double,
    val food: Double,
    val drinks: Double,
    val cover: Double,
    val transit: Double,
    val total: Double,
    val currency: String = "USD",
)

@Serializable
data class PlanDayResponse(
    val dateISO: String,
    val optimizeFor: OptimizationTarget,
    val energy: EnergyLevel,
    val vibe: String,
    val slots: List<PlannedSlot>,
    val geographicFlow: String,
    val totalTransitMinutes: Int,
    val spendEstimate: SpendEstimate,
    val tradeoffs: List<String>,
    val generatedAt: String,
)

// ---------- user feedback (the learning loop) ----------

@Serializable
enum class InteractionKind {
    @SerialName("spot_impression") SPOT_IMPRESSION,
    @SerialName("spot_tap") SPOT_TAP,
    @SerialName("spot_save") SPOT_SAVE,
    @SerialName("spot_directions") SPOT_DIRECTIONS,
    @SerialName("spot_share") SPOT_SHARE,
    @SerialName("plan_view") PLAN_VIEW,
    @SerialName("plan_slot_view") PLAN_SLOT_VIEW,
    @SerialName("plan_save") PLAN_SAVE,
    @SerialName("spot_visit_confirmed") SPOT_VISIT_CONFIRMED,
    @SerialName("spot_rating") SPOT_RATING,
    @SerialName("spot_thumbs_up") SPOT_THUMBS_UP,
    @SerialName("spot_thumbs_down") SPOT_THUMBS_DOWN,
    @SerialName("plan_slot_override") PLAN_SLOT_OVERRIDE,
    @SerialName("plan_target_change") PLAN_TARGET_CHANGE,
    @SerialName("re_query_same_purpose") RE_QUERY_SAME_PURPOSE,
}

@Serializable
data class LogInteractionRequest(
    val kind: InteractionKind,
    val spotPlaceId: String? = null,
    val eventId: String? = null,
    val dayPlanId: String? = null,
    val queryPurpose: String? = null,
    val queryLocation: Location? = null,
    val rankPosition: Int? = null,
    val scoreAtImpression: Double? = null,
    val scoreBreakdown: ScoreBreakdown? = null,
    val ratingValue: Int? = null,
    val overrideFromPlaceId: String? = null,
    val overrideToPlaceId: String? = null,
    val notes: String? = null,
    val heuristicVersion: String? = null,
    val clientApp: String? = null,
    val clientVersion: String? = null,
)

@Serializable
data class LogInteractionResponse(
    val ok: Boolean,
    val dropped: String? = null,
)
