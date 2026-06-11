import SwiftUI

extension Color {
    static let cardBackground = Color(.systemBackground)
    static let cardBorder = Color(.separator)
    static let mutedForeground = Color(.secondaryLabel)
    static let tradeoffBg = Color(red: 1.0, green: 0.973, blue: 0.898)
    static let tradeoffFg = Color(red: 0.4, green: 0.333, blue: 0.133)
}

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.cardBackground)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.cardBorder.opacity(0.4), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

extension View {
    func card() -> some View { modifier(CardModifier()) }

    func kicker() -> some View {
        self
            .font(.caption)
            .fontWeight(.medium)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .kerning(1)
    }
}
