import MapKit
import SwiftUI

@MainActor
final class PulseViewModel: ObservableObject {
    @Published var query: String = ""
    @Published var mode: ViewMode = .feed
    @Published var loading: Bool = false
    @Published var error: String?
    @Published var spots: [ScoredSpot] = []
    @Published var events: [Event] = []

    enum ViewMode: Hashable { case feed, map }

    /// Default "what's pulsing right now" — runs on first appear with no query.
    /// Empty query → backend ranks by total score across all 5 signals, weighting
    /// real-time relevance and recency higher (the "what's hot" sort).
    func loadDefault() async {
        await search(query: "")
    }

    func search(query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        loading = true
        error = nil
        defer { loading = false }
        do {
            // Spots: ranked places near you, biased toward what's currently active.
            async let spotsRes = ApiClient.shared.findSpots(
                FindSpotsRequest(
                    purpose: trimmed.isEmpty ? "what's hot right now" : trimmed,
                    location: .pennStation
                )
            )
            // Events: time-bound things happening tonight + this week.
            async let eventsRes = ApiClient.shared.eventsFeed(
                EventsFeedRequest(
                    location: .pennStation,
                    purposes: trimmed.isEmpty ? [] : [trimmed],
                    includeLiveSearch: true
                )
            )
            let (s, e) = try await (spotsRes, eventsRes)
            spots = s.spots
            events = e.events
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct PulseView: View {
    @StateObject private var vm = PulseViewModel()
    @FocusState private var focused: Bool
    @State private var hasLoaded = false

    var body: some View {
        VStack(spacing: 12) {
            PulseSearchBar(
                text: $vm.query,
                focused: $focused,
                onSubmit: { Task { await vm.search(query: vm.query) } }
            )
            .padding(.horizontal, 20)

            Picker("View mode", selection: $vm.mode) {
                Label("Feed", systemImage: "list.bullet").tag(PulseViewModel.ViewMode.feed)
                Label("Map", systemImage: "map").tag(PulseViewModel.ViewMode.map)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)

            Group {
                switch vm.mode {
                case .feed: PulseFeed(vm: vm)
                case .map: PulseMap(vm: vm)
                }
            }
        }
        .background(Color(.systemGroupedBackground))
        .task {
            guard !hasLoaded else { return }
            hasLoaded = true
            await vm.loadDefault()
        }
    }
}

// MARK: - Search bar

private struct PulseSearchBar: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Narrow it down — cocktails, drag, work…", text: $text)
                .focused(focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onSubmit(onSubmit)
            if !text.isEmpty {
                Button {
                    text = ""
                    onSubmit()
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Feed

private struct PulseFeed: View {
    @ObservedObject var vm: PulseViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if vm.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                }
                if let error = vm.error {
                    Text(error).foregroundStyle(.red).font(.callout)
                }

                if vm.spots.isEmpty && vm.events.isEmpty && !vm.loading && vm.error == nil {
                    EmptyState()
                }

                if !vm.events.isEmpty {
                    SectionHeader(title: "Happening Now")
                    ForEach(vm.events) { EventRow(event: $0) }
                }

                if !vm.spots.isEmpty {
                    SectionHeader(title: "What's Hot")
                        .padding(.top, vm.events.isEmpty ? 0 : 8)
                    ForEach(vm.spots) { SpotRow(spot: $0) }
                }
            }
            .padding(20)
        }
        .refreshable {
            await vm.search(query: vm.query)
        }
    }
}

private struct SectionHeader: View {
    let title: String
    var body: some View {
        Text(title.uppercased())
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(.secondary)
            .kerning(1.2)
    }
}

private struct EventRow: View {
    let event: Event

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(event.title).font(.headline).lineLimit(2)
                Spacer()
                if let cost = event.cost {
                    Text(cost)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color(.tertiarySystemFill))
                        .clipShape(Capsule())
                }
            }
            if let venue = event.venueName {
                Text(venue).font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Image(systemName: "clock").font(.caption2).foregroundStyle(.tertiary)
                Text(event.startISO.dateTimeShort)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !event.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(event.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(Capsule())
                        }
                    }
                }
            }
        }
        .card()
    }
}

private struct SpotRow: View {
    let spot: ScoredSpot

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(spot.name).font(.headline)
                Spacer()
                ScorePill(score: spot.score)
            }
            Text("\(spot.address) · \(spot.walkMinutes) min")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(spot.why).font(.callout)
            if !spot.attributes.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(spot.attributes, id: \.self) { attr in
                            Text(attr)
                                .font(.caption2)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            BreakdownBar(breakdown: spot.breakdown)
        }
        .card()
    }
}

private struct ScorePill: View {
    let score: Double
    var body: some View {
        Text(String(format: "%.1f", score))
            .font(.subheadline.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Color.primary)
            .foregroundStyle(Color(.systemBackground))
            .clipShape(Capsule())
    }
}

private struct BreakdownBar: View {
    let breakdown: ScoreBreakdown
    var body: some View {
        HStack(spacing: 6) {
            label("C", value: breakdown.consensus)
            label("R", value: breakdown.recency)
            label("U", value: breakdown.useCaseFit)
            label("D", value: breakdown.distance)
            label("RT", value: breakdown.realTimeRelevance)
        }
        .font(.caption2)
        .foregroundStyle(.tertiary)
        .padding(.top, 2)
    }
    private func label(_ name: String, value: Double) -> some View {
        Text("\(name) \(String(format: "%g", value))")
    }
}

private struct EmptyState: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "waveform.path.ecg")
                .font(.largeTitle)
                .foregroundStyle(.tertiary)
            Text("Nothing pulsing yet")
                .font(.headline)
            Text("Backend isn't wired — implement the find-spots and events-feed Edge Functions to populate this feed.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}

// MARK: - Map

private struct PulseMap: View {
    @ObservedObject var vm: PulseViewModel
    @State private var camera: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 40.7506, longitude: -73.9939),
            span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03)
        )
    )

    var body: some View {
        Map(position: $camera) {
            ForEach(vm.spots) { spot in
                Annotation(spot.name, coordinate: CLLocationCoordinate2D(
                    latitude: spot.location.lat,
                    longitude: spot.location.lng
                )) {
                    HotPin(score: spot.score)
                }
            }
            ForEach(vm.events) { event in
                if let loc = event.location {
                    Annotation(event.title, coordinate: CLLocationCoordinate2D(
                        latitude: loc.lat,
                        longitude: loc.lng
                    )) {
                        EventPin()
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
    }
}

private struct HotPin: View {
    let score: Double
    var body: some View {
        ZStack {
            Circle()
                .fill(scoreColor)
                .frame(width: 28, height: 28)
            Text(String(format: "%.0f", score))
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white)
        }
        .shadow(radius: 2)
    }
    private var scoreColor: Color {
        switch score {
        case 10...: return .red
        case 8..<10: return .orange
        case 6..<8: return .yellow
        default: return .gray
        }
    }
}

private struct EventPin: View {
    var body: some View {
        Image(systemName: "sparkles")
            .font(.title3)
            .foregroundStyle(.white)
            .padding(6)
            .background(Color.purple)
            .clipShape(Circle())
            .shadow(radius: 2)
    }
}

// MARK: - Helpers

private extension String {
    /// "2026-06-09T19:00:00-04:00" → "Tue 7:00 PM"
    var dateTimeShort: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: self) else { return self }
        let out = DateFormatter()
        out.dateFormat = "EEE h:mm a"
        return out.string(from: date)
    }
}

#Preview {
    NavigationStack { PulseView() }
}
