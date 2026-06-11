import SwiftUI

@main
struct PulseApp: App {
    var body: some Scene {
        WindowGroup {
            RootTabs()
                .tint(.primary)
        }
    }
}

struct RootTabs: View {
    @State private var selectedTab: Tab = .pulse

    enum Tab: Hashable { case pulse, plan }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                PulseView()
                    .navigationTitle("Pulse")
                    .navigationBarTitleDisplayMode(.large)
            }
            .tabItem { Label("Pulse", systemImage: "waveform.path.ecg") }
            .tag(Tab.pulse)

            NavigationStack {
                PlannerView()
                    .navigationTitle("Plan")
                    .navigationBarTitleDisplayMode(.large)
            }
            .tabItem { Label("Plan", systemImage: "calendar") }
            .tag(Tab.plan)
        }
    }
}
