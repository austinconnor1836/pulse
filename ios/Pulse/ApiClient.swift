import Foundation

// Thin HTTP client over the Supabase Edge Functions. Auth is currently the anon
// key — swap to the signed-in user's JWT before TestFlight.
//
// Supabase config is read from Info.plist (which gets values from Config.xcconfig
// at build time). Keep keys off the device for any secret; Supabase ANON_KEY is
// publishable so it's fine here.

enum ApiError: LocalizedError {
    case missingConfig(String)
    case http(Int, String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .missingConfig(let key):
            return "Missing config key \(key). Edit Config.xcconfig and rebuild."
        case .http(let status, let body):
            return "HTTP \(status): \(body)"
        case .decoding(let error):
            return "Decoding error: \(error.localizedDescription)"
        }
    }
}

@MainActor
final class ApiClient: ObservableObject {
    static let shared = ApiClient()

    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    private init() {
        self.session = URLSession(configuration: .default)
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    func findSpots(_ req: FindSpotsRequest) async throws -> FindSpotsResponse {
        try await call("find-spots", body: req)
    }

    func planDay(_ req: PlanDayRequest) async throws -> PlanDayResponse {
        try await call("plan-day", body: req)
    }

    func eventsFeed(_ req: EventsFeedRequest) async throws -> EventsFeedResponse {
        try await call("events-feed", body: req)
    }

    private func call<Req: Encodable, Res: Decodable>(
        _ functionName: String,
        body: Req
    ) async throws -> Res {
        let url = try functionURL(functionName)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let anon = try anonKey()
        request.setValue("Bearer \(anon)", forHTTPHeaderField: "Authorization")
        request.httpBody = try encoder.encode(body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ApiError.http(-1, "no response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ApiError.http(http.statusCode, body)
        }
        do {
            return try decoder.decode(Res.self, from: data)
        } catch {
            throw ApiError.decoding(error)
        }
    }

    // MARK: - Config

    private func functionURL(_ functionName: String) throws -> URL {
        let base = try configValue("SUPABASE_URL")
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        guard let url = URL(string: "\(trimmed)/functions/v1/\(functionName)") else {
            throw ApiError.missingConfig("SUPABASE_URL (malformed)")
        }
        return url
    }

    private func anonKey() throws -> String {
        try configValue("SUPABASE_ANON_KEY")
    }

    private func configValue(_ key: String) throws -> String {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !raw.isEmpty else {
            throw ApiError.missingConfig(key)
        }
        return raw
    }
}
