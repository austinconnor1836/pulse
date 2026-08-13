package com.austinconnor.pulse.shared

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/**
 * W19 — the "free things to do today/tomorrow" client.
 *
 * Deliberately independent of the Supabase [ApiClient]: it GETs a static JSON
 * file (harvested by a free GitHub Actions cron, served from a CDN) and decodes
 * it to [FreeThings]. No auth, no server, no DB — $0 to run.
 */
object FreeThingsConfig {
    // Static, unauthenticated data served from the public repo (free CDN),
    // refreshed by the GitHub Actions cron. `{city}` is substituted per-request.
    const val BASE_URL_TEMPLATE =
        "https://raw.githubusercontent.com/austinconnor1836/pulse/main/harvester/output/{city}.json"
}

class FreeThingsClient(
    httpClient: HttpClient? = null,
    private val baseUrlTemplate: String = FreeThingsConfig.BASE_URL_TEMPLATE,
) {
    private val client: HttpClient = httpClient ?: HttpClient {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                isLenient = true
                encodeDefaults = true
                explicitNulls = false
            })
        }
    }

    /** Fetch + decode the static free-things JSON for [city] (e.g. "omaha"). */
    suspend fun fetch(city: String): FreeThings {
        val url = baseUrlTemplate.replace("{city}", city)
        return client.get(url).body()
    }
}
