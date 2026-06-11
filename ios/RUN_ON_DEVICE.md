# Run on your iPhone (skip the simulator)

For dev iteration, you don't need TestFlight OR the iOS Simulator runtime. Build directly to your iPhone via USB — ~30s per build vs. ~30 min for a TestFlight roundtrip, and bypasses the multi-hour simulator download entirely.

## One-time setup (~5 min)

### On your iPhone

1. **Settings → Privacy & Security → Developer Mode** → toggle **on** → iPhone restarts.
   - Developer Mode only appears once Xcode has paired the device once. If you don't see it: plug into Mac, open Xcode, then check again.
2. After restart, iPhone prompts to confirm Developer Mode → tap **Turn On** → enter passcode.

### On your Mac

3. Plug iPhone in via USB-C or Lightning. (Wireless works after first pair, but USB is fastest for first run.)
4. On the iPhone, when prompted "Trust This Computer?" → **Trust** → enter passcode.
5. Open Xcode (already open on `Pulse.xcodeproj`).

### Configure the build target

6. Top bar device dropdown → your iPhone should appear under **iOS Device**. Select it.
   - If it shows "Preparing iPhone for development…" with a spinner — wait, Xcode is copying symbol files. ~2 min first time.
   - If it shows "Untrusted developer" — see "Trust the dev profile" below.
7. Hit **▶ Run** (⌘R).
   - Xcode auto-creates the dev provisioning profile on first run.
   - App installs on the phone in ~30 sec.
   - When complete, the app launches on the phone automatically.

### Trust the dev profile (first-run only)

8. If iPhone shows "Untrusted Developer" the first time the app tries to launch:
   - On iPhone: **Settings → General → VPN & Device Management** → tap your team name → **Trust "Austin Connor"** → confirm.
   - Tap the app icon again. It opens.

## Subsequent runs

After the first run, every code change → ⌘R installs the new build in ~10–30 sec. No App Store Connect, no TestFlight, no review wait.

## When this is NOT the right path

- **Sharing with someone else** (friends, investors, designers): use TestFlight via `SHIP_TO_TESTFLIGHT.md`. Device-direct only works for devices paired to your developer team.
- **Testing across many device types**: simulator is faster for that (you can spin up iPhone 15 / iPhone SE / iPad in seconds — once it's downloaded).
- **Release build verification**: Archive uses Release config; ⌘R uses Debug. Always do a TestFlight build before a real ship.

## What if Xcode still says "iOS 26.5 not installed" when targeting your phone?

The error we hit on CLI was about the **simulator runtime**, not device support. Device support installs automatically the first time you plug in a real iPhone running iOS 26.5 (Xcode pulls symbol files just-in-time). You don't need the full multi-GB simulator runtime download.

If Xcode insists on the platform download when targeting a real device:
1. Plug in the iPhone.
2. Wait until "Preparing iPhone for development…" finishes (top of Xcode window).
3. Try ⌘R again.

If it still fails: the platform download is genuinely required. Settings → Platforms → iOS → Download. You can then deselect "iOS Simulator runtime" in some Xcode versions to skip the largest part.

## Once it's running on your phone

You can demo:
- **Things to Do tab**: search field at top, ranked list below (currently empty — backend not wired).
- **Planner tab**: segmented Today / Tomorrow / This Week, day cards, tap into detail view with optimization-target chips.
- **Both tabs**: pull-to-refresh, navigation, dark/light mode follows system, layout adapts to your iPhone size.

Tapping the action buttons will throw "Missing config" — that's the backend not being wired yet, not a bug. Use the device build to refine UI/UX while the backend gets implemented.
