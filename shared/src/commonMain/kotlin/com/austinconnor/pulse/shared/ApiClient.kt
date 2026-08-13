package com.austinconnor.pulse.shared

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/**
 * Thin HTTP client over the Supabase Edge Functions.
 *
 * iOS + Android both consume this via the KMP shared module. Auth is currently
 * the anon key — swap to the signed-in user's JWT before TestFlight.
 */
class ApiClient(
    private val supabaseUrl: String,
    private val supabaseAnonKey: String,
    httpClient: HttpClient? = null,
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

    suspend fun findSpots(req: FindSpotsRequest): FindSpotsResponse =
        invoke("find-spots", req)

    suspend fun planDay(req: PlanDayRequest): PlanDayResponse =
        invoke("plan-day", req)

    suspend fun eventsFeed(req: EventsFeedRequest): EventsFeedResponse =
        invoke("events-feed", req)

    /**
     * Fire-and-forget interaction logger. Powers the user-decision feedback
     * loop — see /Users/austin/Developer/pulse/docs/feedback-loop.md.
     * Failures are swallowed; never surface a logging error to the UI.
     */
    suspend fun logInteraction(req: LogInteractionRequest): LogInteractionResponse =
        try {
            invoke("log-interaction", req)
        } catch (_: Throwable) {
            LogInteractionResponse(ok = false, dropped = "client-swallowed")
        }

    private suspend inline fun <reified Req, reified Res> invoke(
        functionName: String,
        body: Req,
    ): Res {
        require(supabaseUrl.isNotBlank()) {
            "supabaseUrl is empty. Set EXPO_PUBLIC_SUPABASE_URL or equivalent."
        }
        val response = client.post("$supabaseUrl/functions/v1/$functionName") {
            contentType(ContentType.Application.Json)
            headers {
                // TODO: replace with signed-in user JWT before TestFlight.
                append("Authorization", "Bearer $supabaseAnonKey")
            }
            setBody(body)
        }
        return response.body()
    }
}

object Defaults {
    val PENN_STATION = Location(label = "Penn Station", lat = 40.7506, lng = -73.9939)
    val OMAHA = Location(label = "Omaha", lat = 41.2565, lng = -95.9345)
}
