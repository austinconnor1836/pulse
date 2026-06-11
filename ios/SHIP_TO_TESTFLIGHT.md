# Ship to TestFlight

You already use TestFlight for Polemicyst. ~30 minutes end-to-end. **Xcode is already open** — start there.

## Three manual prerequisites (do these first, ~10 min)

These can't be done from CLI; we hit them all when trying to automate the archive.

### 1. Install iOS 26.5 platform support in Xcode

Xcode → **Settings** (⌘,) → **Platforms** → click the **+** at the bottom-left → select **iOS 26.5** → Download. ~10 min depending on your connection.

> This is why `xcodebuild` reports "iOS 26.5 is not installed" — the Swift SDK is on disk, but the device-support runtime isn't. Xcode GUI downloads it; CLI can't trigger that download.

### 2. Accept the updated Apple Program License Agreement

Go to https://developer.apple.com → sign in → if there's a "Review Agreement" banner, click it → Accept. Required before provisioning works.

### 3. Create the App Store Connect record

https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**:

- Platform: iOS
- Name: **Pulse**
- Primary Language: English (U.S.)
- Bundle ID: `com.austinconnor.pulse` (must match what's wired in `project.yml`)
- SKU: anything unique, e.g., `pulse-001`
- User Access: Full Access

## Ship the build (~15 min in Xcode)

Team ID `L6AS5GG2MB` is already in `project.yml`. In Xcode:

1. Confirm scheme dropdown (top bar) shows **Pulse**.
2. Device dropdown → **Any iOS Device (arm64)**. (If it doesn't appear, prereq #1 isn't finished.)
3. Select target **Pulse** → **Signing & Capabilities** → confirm Team shows **Austin Connor (L6AS5GG2MB)** and **Automatically manage signing** is checked.
4. **Product → Archive**. First archive: Xcode prompts to register the bundle ID + create the provisioning profile — click yes. Takes ~3 min total.
5. When Organizer opens with your archive: **Distribute App** → **App Store Connect** → **Upload** → walk through prompts (defaults are fine).

Upload triggers App Store Connect processing (~10–30 min).

## Install on your phone

1. https://appstoreconnect.apple.com → your app → **TestFlight** tab.
2. Wait until build state = **Ready to Test**.
3. **Internal Testing** → **+** → add yourself (the email on your Apple Dev account). You're auto-approved.
4. Open TestFlight on your phone. The new app appears at the top of the list. Tap **Install**.

## What you'll see

- Bottom tab bar with two tabs: **Things to Do** + **Planner**.
- **Things to Do**: search field at top; ranked list below with score breakdowns (Consensus / Recency / Use-case fit / Distance / Real-time). The empty-state appears because the backend isn't wired — the API call will return a "Missing config" error in dev/local but on TestFlight it'll just show the empty feed.
- **Planner**: segmented control (Today / Tomorrow / This Week); cards per day; tap a day for the time-blocked detail.

You can demo the surface area to anyone today. The backend wire-up (Edge Functions + Supabase project + Google Places + Claude API + ingestion cron) is the next chunk of real work — fully architected in `docs/architecture.md`, `docs/realtime-ingestion.md`, and the migrations in `supabase/migrations/`.

## Incrementing builds (for subsequent uploads)

Bump `CFBundleVersion` in `project.yml`:

```yaml
info:
  properties:
    CFBundleVersion: "2"    # was "1"
```

Then `cd ios && xcodegen generate && open Pulse.xcodeproj`, re-Archive.

## Common fixes

- **"Failed to register bundle identifier"**: Bundle ID taken by another dev account. Change `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` (e.g., `com.austinconnor.pulsenyc`), re-run `xcodegen generate`.
- **"No matching provisioning profile"**: PLA not accepted (step 2) OR bundle ID not registered (Xcode normally creates it on first Archive).
- **Archive button greyed out**: Device dropdown is set to a simulator — switch to "Any iOS Device (arm64)".

## What's not in this build (yet)

- ❌ Backend wired (Supabase + Edge Functions are stubbed)
- ❌ Real ranking (UI flows are in place; Edge Functions return empty)
- ❌ Real events feed (architecture exists; ingestion not yet running)
- ❌ KMP shared module integration (Swift uses hand-mirrored types — see `ios/README.md`)
- ❌ Auth (currently sends the anon key; swap to user JWT before real users)

That's the next sprint. Everything above the line is ready for TestFlight today.
