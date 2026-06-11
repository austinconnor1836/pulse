package com.austinconnor.pulse.shared

import kotlinx.datetime.Instant

// Pure functions — no I/O, no LLM calls. Implements the find-spots 5-signal
// heuristic in code form. Source-of-truth spec:
//   /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/find-spots/SKILL.md

object Scoring {

    /** Distance signal bucket. Caller drops the candidate if it returns -1 (hard filter). */
    fun distanceScore(walkMinutes: Int): Int = when {
        walkMinutes <= 10 -> 2
        walkMinutes <= 18 -> 1
        walkMinutes <= 25 -> 0
        else -> -1
    }

    /** UI tier from walk minutes. Tier 1: 0–5, Tier 2: 5–15, Tier 3: 15+. */
    fun tierFor(walkMinutes: Int): Int = when {
        walkMinutes <= 5 -> 1
        walkMinutes <= 15 -> 2
        else -> 3
    }

    fun totalScore(b: ScoreBreakdown): Double =
        b.consensus + b.recency + b.useCaseFit + b.distance + b.realTimeRelevance

    /**
     * Real-time event signal. Time-decays from +3 to 0 as the event passes.
     *
     * Logic mirrors find-spots SKILL.md "Real-time event signal":
     *   +3 if the event matches purpose AND is in the relevant window
     *   +2 if announced within last 24h (breaking-news bump)
     *   +1 if a related event is at a nearby spillover venue
     *   decay to 0 after the event ends
     */
    fun realTimeRelevance(
        eventStartISO: String,
        eventEndISO: String?,
        announcedAtISO: String,
        nowISO: String,
        isAtThisVenue: Boolean,
        isPurposeAligned: Boolean,
    ): Double {
        val now = parseInstant(nowISO)
        val start = parseInstant(eventStartISO)
        val end = eventEndISO?.let(::parseInstant) ?: start
        if (now > end) return 0.0
        val announced = parseInstant(announcedAtISO)
        val hoursSinceAnnounced = (now - announced) / 3600.0
        val breakingBump = if (hoursSinceAnnounced <= 24.0) 2.0 else 0.0
        val base = when {
            isAtThisVenue && isPurposeAligned -> 3.0
            !isAtThisVenue && isPurposeAligned -> 1.0
            else -> 0.0
        }
        // Cap at 3.0 so this signal can't dominate the other four combined.
        return minOf(3.0, base + breakingBump * 0.5)
    }

    private fun parseInstant(iso: String): Double = Instant.parse(iso).epochSeconds.toDouble()

    /**
     * Re-weights use-case fit (and friends) per the plan-day optimization target.
     * Spec: /Users/austin/Developer/nyc-trip-jun-2026/.claude/skills/plan-day/SKILL.md
     */
    fun applyOptimizationWeights(
        b: ScoreBreakdown,
        target: OptimizationTarget,
    ): ScoreBreakdown = when (target) {
        OptimizationTarget.BALANCED -> b
        OptimizationTarget.MEET_PEOPLE -> b.copy(useCaseFit = b.useCaseFit * 1.4)
        OptimizationTarget.NOVELTY -> b.copy(recency = b.recency * 1.5)
        OptimizationTarget.ENJOYMENT -> b.copy(
            consensus = b.consensus * 1.3,
            useCaseFit = b.useCaseFit * 1.2,
        )
        OptimizationTarget.RECOVERY -> b.copy(
            useCaseFit = b.useCaseFit * 1.3,
            distance = b.distance * 1.3,
        )
    }
}
