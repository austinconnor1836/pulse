// Swift mirrors of the KMP shared types.
//
// PROVISIONAL: these will be replaced by `import SharedKit` once the KMP
// XCFramework is wired in project.yml. Source-of-truth is the KMP shared module:
//   shared/src/commonMain/kotlin/com/austinconnor/pulse/shared/Types.kt
//
// Until the swap, treat any change to that Kotlin file as a required change here.

import Foundation

// MARK: - Common

struct Location: Codable, Hashable {
    var label: String?
    var lat: Double
    var lng: Double
}

extension Location {
    static let pennStation = Location(label: "Penn Station", lat: 40.7506, lng: -73.9939)
}

// MARK: - find-spots

enum FindSpotsMode: String, Codable {
    case lightweight, deep
}

struct FindSpotsRequest: Codable {
    var purpose: String
    var location: Location
    var whenISO: String?
    var mode: FindSpotsMode?
    var maxResults: Int?
}

struct ScoreBreakdown: Codable, Hashable {
    var consensus: Double
    var recency: Double
    var useCaseFit: Double
    var distance: Double
    var realTimeRelevance: Double = 0
}

struct ScoredSpot: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var address: String
    var location: Location
    var walkMinutes: Int
    var tier: Int
    var score: Double
    var breakdown: ScoreBreakdown
    var why: String
    var attributes: [String] = []
    var openNow: Bool?
    var hoursToday: String?
    var photoUrl: String?
    var sources: [String] = []
    var liveEvents: [Event] = []
}

struct FindSpotsResponse: Codable {
    var spots: [ScoredSpot]
    var generatedAt: String
    var mode: FindSpotsMode
}

// MARK: - events (5th signal)

enum EventSource: String, Codable {
    case news, civic, reddit, eventbrite, dice, ra, instagram, x
    case liveSearch = "livesearch"
    case user
}

enum EventConfidence: String, Codable {
    case confirmed, likely, rumored
}

struct Event: Codable, Hashable, Identifiable {
    var id: String
    var title: String
    var description: String?
    var startISO: String
    var endISO: String?
    var venueName: String?
    var venuePlaceId: String?
    var location: Location?
    var tags: [String] = []
    var sources: [EventSource] = []
    var sourceUrls: [String] = []
    var announcedAtISO: String
    var confidence: EventConfidence = .likely
    var cost: String?
    var supersedes: String?
}

struct EventsFeedRequest: Codable {
    var location: Location
    var whenStartISO: String?
    var whenEndISO: String?
    var purposes: [String] = []
    var maxResults: Int?
    var includeLiveSearch: Bool = true
}

struct EventsFreshness: Codable {
    var newestAnnouncedAtISO: String?
    var oldestIngestedAtISO: String?
    var sourcesPolled: [EventSource]
    var cacheHitRatio: Double
}

struct EventsFeedResponse: Codable {
    var events: [Event]
    var generatedAt: String
    var freshness: EventsFreshness
}

// MARK: - plan-day

enum OptimizationTarget: String, Codable, CaseIterable {
    case balanced, novelty
    case meetPeople = "meet-people"
    case enjoyment, recovery
}

enum EnergyLevel: String, Codable {
    case hard, medium, recovery
}

enum SlotKind: String, Codable {
    case morning, workday, lunch, afternoon
    case preAnchor = "pre-anchor"
    case anchor
    case lateNight = "late-night"
    case weekendDaytime = "weekend-daytime"
}

struct ItineraryDay: Codable {
    var dateISO: String
    var neighborhood: String?
    var anchorVenue: String?
    var anchorTimeISO: String?
    var gameNight: Bool?
    var isSober: Bool?
}

struct RecentPlan: Codable {
    var dateISO: String
    var neighborhoods: [String]
    var venueIds: [String]
}

struct PlanDayRequest: Codable {
    var dateISO: String
    var anchorLocation: Location
    var optimizeFor: OptimizationTarget?
    var energy: EnergyLevel?
    var itinerary: ItineraryDay?
    var recentPlans: [RecentPlan]?
}

struct PlannedSlot: Codable, Hashable, Identifiable {
    var id: String { "\(kind.rawValue)-\(startISO)" }
    var kind: SlotKind
    var startISO: String
    var endISO: String
    var purpose: String
    var pick: ScoredSpot?
    var alternates: [ScoredSpot] = []
    var fixed: Bool = false
    var note: String?
}

struct SpendEstimate: Codable {
    var cafe: Double
    var food: Double
    var drinks: Double
    var cover: Double
    var transit: Double
    var total: Double
    var currency: String = "USD"
}

struct PlanDayResponse: Codable {
    var dateISO: String
    var optimizeFor: OptimizationTarget
    var energy: EnergyLevel
    var vibe: String
    var slots: [PlannedSlot]
    var geographicFlow: String
    var totalTransitMinutes: Int
    var spendEstimate: SpendEstimate
    var tradeoffs: [String]
    var generatedAt: String
}
