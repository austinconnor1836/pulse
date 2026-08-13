import Foundation

// W19 — the "free things to do today/tomorrow" client.
//
// Deliberately independent of the Supabase-backed `ApiClient`: it GETs a static
// JSON file (harvested by a free GitHub Actions cron, served from a CDN) and
// decodes it to `FreeThings`. No auth, no server, no DB — $0 to run.
//
// Swift mirror of shared/src/.../FreeThingsClient.kt. Will be replaced by the KMP
// `FreeThingsClient` once the shared XCFramework is wired in (W15).

enum FreeThingsConfig {
    // TODO(W19): the `pulse` repo has no git remote yet — replace <owner> with the
    // real GitHub owner once the repo is pushed (see spec Gate A). Until then this
    // URL will 404. `{city}` is substituted per-request by `FreeThingsClient.fetch`.
    static let baseURLTemplate =
        "https://raw.githubusercontent.com/<owner>/pulse/main/harvester/output/{city}.json"
}

@MainActor
final class FreeThingsClient: ObservableObject {
    static let shared = FreeThingsClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let baseURLTemplate: String

    init(baseURLTemplate: String = FreeThingsConfig.baseURLTemplate) {
        self.session = URLSession(configuration: .default)
        self.decoder = JSONDecoder()
        self.baseURLTemplate = baseURLTemplate
    }

    /// Fetch + decode the static free-things JSON for `city` (e.g. "omaha").
    func fetch(city: String) async throws -> FreeThings {
        let urlString = baseURLTemplate.replacingOccurrences(of: "{city}", with: city)
        guard let url = URL(string: urlString) else {
            throw ApiError.missingConfig("FreeThings base URL (malformed)")
        }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ApiError.http(-1, "no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ApiError.http(http.statusCode, body)
        }
        do {
            return try decoder.decode(FreeThings.self, from: data)
        } catch {
            throw ApiError.decoding(error)
        }
    }
}
