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
    // TODO(W19): the `pulse` repo has no git remote yet — replace <owner> with the
    // real GitHub owner once the repo is pushed (see spec Gate A). Until then this
    // URL will 404. `{city}` is substituted per-request by [FreeThingsClient.fetch].
    const val BASE_URL_TEMPLATE =
        "https://raw.githubusercontent.com/<owner>/pulse/main/harvester/output/{city}.json"
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
