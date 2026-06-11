import SwiftUI

@MainActor
final class PlannerViewModel: ObservableObject {
    @Published var loading: Set<String> = []     // dateISO values currently loading
    @Published var plans: [String: PlanDayResponse] = [:]   // dateISO -> plan
    @Published var errors: [String: String] = [:]

    private let dateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        return f
    }()

    func iso(_ date: Date) -> String { dateFormatter.string(from: date) }

    func ensurePlan(for date: Date, target: OptimizationTarget = .balanced) async {
        let key = iso(date)
        if plans[key] != nil || loading.contains(key) { return }
        loading.insert(key)
        defer { loading.remove(key) }
        do {
            let res = try await ApiClient.shared.planDay(
                PlanDayRequest(
                    dateISO: key,
                    anchorLocation: .pennStation,
                    optimizeFor: target,
                    energy: nil,
                    itinerary: nil,
                    recentPlans: nil
                )
            )
            plans[key] = res
            errors.removeValue(forKey: key)
        } catch {
            errors[key] = error.localizedDescription
        }
    }
}

struct PlannerView: View {
    @StateObject private var vm = PlannerViewModel()
    @State private var range: Range = .week

    enum Range: String, CaseIterable, Identifiable {
        case today = "Today", tomorrow = "Tomorrow", week = "This Week"
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Range", selection: $range) {
                    ForEach(Range.allCases) { r in Text(r.rawValue).tag(r) }
                }
                .pickerStyle(.segmented)

                ForEach(dates(in: range), id: \.self) { date in
                    DayCard(date: date, vm: vm)
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .task {
            for date in dates(in: range) {
                await vm.ensurePlan(for: date)
            }
        }
        .onChange(of: range) { _, newValue in
            Task {
                for date in dates(in: newValue) {
                    await vm.ensurePlan(for: date)
                }
            }
        }
    }

    private func dates(in range: Range) -> [Date] {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        switch range {
        case .today: return [today]
        case .tomorrow: return [cal.date(byAdding: .day, value: 1, to: today)!]
        case .week: return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: today) }
        }
    }
}

private struct DayCard: View {
    let date: Date
    @ObservedObject var vm: PlannerViewModel

    private var isoKey: String { vm.iso(date) }
    private var heading: String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInTomorrow(date) { return "Tomorrow" }
        let f = DateFormatter()
        f.dateFormat = "EEEE, MMM d"
        return f.string(from: date)
    }

    var body: some View {
        NavigationLink {
            DayDetailView(date: date, vm: vm)
                .navigationTitle(heading)
                .navigationBarTitleDisplayMode(.inline)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(heading).font(.headline)
                    Spacer()
                    if vm.loading.contains(isoKey) {
                        ProgressView().controlSize(.small)
                    } else if let plan = vm.plans[isoKey] {
                        Text("\(plan.slots.count) slots")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if let err = vm.errors[isoKey] {
                    Text(err).font(.caption).foregroundStyle(.red).lineLimit(2)
                } else if let plan = vm.plans[isoKey] {
                    Text(plan.vibe).font(.callout).lineLimit(2)
                    Text("Energy \(plan.energy.rawValue) · ~\(plan.totalTransitMinutes) min transit · $\(Int(plan.spendEstimate.total))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if !vm.loading.contains(isoKey) {
                    Text("Tap to load")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .card()
        }
        .buttonStyle(.plain)
    }
}

struct DayDetailView: View {
    let date: Date
    @ObservedObject var vm: PlannerViewModel
    @State private var target: OptimizationTarget = .balanced

    private var key: String { vm.iso(date) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Optimize for").kicker()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(OptimizationTarget.allCases, id: \.self) { t in
                            Chip(label: t.rawValue, active: target == t) {
                                target = t
                                Task {
                                    vm.plans.removeValue(forKey: key)
                                    await vm.ensurePlan(for: date, target: t)
                                }
                            }
                        }
                    }
                }

                if vm.loading.contains(key) {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                }

                if let err = vm.errors[key] {
                    Text(err).foregroundStyle(.red).font(.callout)
                }

                if let plan = vm.plans[key] {
                    PlanSummary(plan: plan).card()

                    if plan.slots.isEmpty {
                        Text("Backend stub returned no slots — implement the plan-day Edge Function.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(plan.slots) { SlotCard(slot: $0) }
                    }

                    if !plan.tradeoffs.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Trade-offs").kicker().foregroundStyle(Color.tradeoffFg)
                            ForEach(plan.tradeoffs, id: \.self) { t in
                                Text("• \(t)").font(.caption).foregroundStyle(Color.tradeoffFg)
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.tradeoffBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
    }
}

private struct Chip: View {
    let label: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption)
                .fontWeight(active ? .semibold : .regular)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(active ? Color.primary : Color(.systemBackground))
                .foregroundStyle(active ? Color(.systemBackground) : Color.primary)
                .overlay(Capsule().stroke(Color.cardBorder.opacity(0.4), lineWidth: 1))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

private struct PlanSummary: View {
    let plan: PlanDayResponse
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(plan.vibe).font(.headline)
            Text("Energy \(plan.energy.rawValue) · Optimizing \(plan.optimizeFor.rawValue)")
                .font(.caption).foregroundStyle(.secondary)
            Text("~\(plan.totalTransitMinutes) min transit · $\(Int(plan.spendEstimate.total)) est.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

private struct SlotCard: View {
    let slot: PlannedSlot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(slot.kind.rawValue.uppercased())
                .font(.caption2).foregroundStyle(.secondary).kerning(1)
            Text("\(slot.startISO.hourPart) – \(slot.endISO.hourPart)")
                .font(.caption).foregroundStyle(.secondary)
            if let pick = slot.pick {
                Text(pick.name).font(.headline).padding(.top, 2)
                Text(pick.address).font(.caption).foregroundStyle(.secondary)
            } else {
                Text(slot.note ?? "Downtime").font(.callout).italic().foregroundStyle(.secondary)
            }
        }
        .card()
    }
}

private extension String {
    var hourPart: String {
        guard count >= 16 else { return self }
        return String(self[index(startIndex, offsetBy: 11)..<index(startIndex, offsetBy: 16)])
    }
}

#Preview {
    NavigationStack { PlannerView() }
}
