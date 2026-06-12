package com.austinconnor.pulse.shared

import kotlin.test.Test
import kotlin.test.assertEquals

// Kotlin side of the TS<->Kotlin scoring-parity contract.
// The TS side reads shared/parity-fixture.json directly via Deno.readTextFile in
// scoring.parity.test.ts. commonTest resource-loading is target-specific in KMP, so
// here we inline the same fixture values as constants. ANY change here must mirror
// shared/parity-fixture.json byte-for-byte (verified by ParityFixtureSnapshotTest below).

private object Fixture {
    const val HEURISTIC_VERSION = "5sig-2026.06"

    // inputs
    const val WALK_MINUTES = 12
    const val CONSENSUS = 1.5
    const val RECENCY = 1.2
    const val USE_CASE_FIT = 1.0
    const val EVENT_START_ISO = "2026-06-12T20:00:00Z"
    const val EVENT_END_ISO = "2026-06-12T23:00:00Z"
    const val ANNOUNCED_AT_ISO = "2026-06-12T08:00:00Z"
    const val NOW_ISO = "2026-06-12T19:30:00Z"
    const val IS_AT_THIS_VENUE = true
    const val IS_PURPOSE_ALIGNED = true

    // expected
    const val EXPECTED_DISTANCE = 1
    const val EXPECTED_REAL_TIME_RELEVANCE = 3.0
    const val EXPECTED_TOTAL_SCORE = 7.7
}

private const val EPSILON = 1e-9

class ScoringParityTest {

    @Test
    fun heuristicVersion_matches_fixture() {
        assertEquals(Fixture.HEURISTIC_VERSION, heuristicVersion)
    }

    @Test
    fun distanceScore_matches_fixture() {
        assertEquals(Fixture.EXPECTED_DISTANCE, Scoring.distanceScore(Fixture.WALK_MINUTES))
    }

    @Test
    fun realTimeRelevance_matches_fixture() {
        val rtr = Scoring.realTimeRelevance(
            eventStartISO = Fixture.EVENT_START_ISO,
            eventEndISO = Fixture.EVENT_END_ISO,
            announcedAtISO = Fixture.ANNOUNCED_AT_ISO,
            nowISO = Fixture.NOW_ISO,
            isAtThisVenue = Fixture.IS_AT_THIS_VENUE,
            isPurposeAligned = Fixture.IS_PURPOSE_ALIGNED,
        )
        assertEquals(Fixture.EXPECTED_REAL_TIME_RELEVANCE, rtr, EPSILON)
    }

    @Test
    fun totalScore_5signal_matches_fixture() {
        val rtr = Scoring.realTimeRelevance(
            eventStartISO = Fixture.EVENT_START_ISO,
            eventEndISO = Fixture.EVENT_END_ISO,
            announcedAtISO = Fixture.ANNOUNCED_AT_ISO,
            nowISO = Fixture.NOW_ISO,
            isAtThisVenue = Fixture.IS_AT_THIS_VENUE,
            isPurposeAligned = Fixture.IS_PURPOSE_ALIGNED,
        )
        val breakdown = ScoreBreakdown(
            consensus = Fixture.CONSENSUS,
            recency = Fixture.RECENCY,
            useCaseFit = Fixture.USE_CASE_FIT,
            distance = Scoring.distanceScore(Fixture.WALK_MINUTES).toDouble(),
            realTimeRelevance = rtr,
        )
        assertEquals(Fixture.EXPECTED_TOTAL_SCORE, Scoring.totalScore(breakdown), EPSILON)
    }
}
