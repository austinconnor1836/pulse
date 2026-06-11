# Local TestFlight ship (`fastlane beta`)

Make a code change → run one command → TestFlight notifies your iPhone in ~15 min. No PR, no CI.

## One-time setup

### 1. Install ruby gems

```sh
cd ios
bundle install
```

(Installs fastlane + xcpretty into `ios/vendor/bundle` via `Gemfile.lock`.)

### 2. App Store Connect API key

The key is reused from Clipfire (same Apple team `L6AS5GG2MB`).

- `ASC_KEY_ID` = `M2HP9X2H75` (from `~/Downloads/AuthKey_M2HP9X2H75.p8`)
- `ASC_ISSUER_ID` = grab from https://appstoreconnect.apple.com → Users and Access → Integrations → App Store Connect API (top of page)
- `ASC_KEY_CONTENT` = base64 of the `.p8` file

Export them into your fish shell once (put in `~/.config/fish/conf.d/asc.fish` so they stick):

```fish
set -x ASC_KEY_ID M2HP9X2H75
set -x ASC_ISSUER_ID <issuer-id-from-asc-page>
set -x ASC_KEY_CONTENT (base64 -i ~/Downloads/AuthKey_M2HP9X2H75.p8 | tr -d '\n')
set -x APPLE_TEAM_ID L6AS5GG2MB
set -x APPLE_ID aconnor731@gmail.com
```

Then `source ~/.config/fish/conf.d/asc.fish` (or open a new shell).

### 3. App Store Connect record

Already created via developer.apple.com (App ID `com.austinconnor.pulse`) + appstoreconnect.apple.com (My Apps → New App, SKU `pulse-001`). One-time.

## Shipping a build

```sh
cd ios
bundle exec fastlane beta
```

What happens:

1. `xcodegen generate` regenerates `Pulse.xcodeproj` from `project.yml`.
2. fastlane queries TestFlight for the latest build number and bumps to `+1` (so you don't have to touch `project.yml`).
3. `xcodebuild` archives a Release build using the **Apple Distribution** cert already in your keychain (no `cert.p12` import — that path is for CI).
4. Signed `.ipa` is uploaded to App Store Connect.
5. Apple processes the build (~5–20 min). TestFlight on your iPhone notifies you when it's ready.

## First-build auto-distribution setup (one-time)

This is what makes new builds appear on the phone **automatically** (the Clipfire pattern):
an **internal** group with **automatic distribution** on. The App Store Connect API can't
create internal groups, so this one step is done in the UI:

1. https://appstoreconnect.apple.com/apps/6778923958/testflight/ios → wait until build 1
   state = **Ready to Submit / Ready to Test**.
2. Under **Internal Testing** (left sidebar) click the **+** → name the group `Admin` → Create.
3. Open the `Admin` group → toggle **Automatically distribute new builds** ON. (This is the
   `hasAccessToAllBuilds` flag — every future `fastlane beta` build is added with no clicks.)
4. In the group's **Testers** tab → **+** → add the Apple ID signed into TestFlight on your
   iPhone (`austin.connor1123@gmail.com` — same tester as Clipfire). Internal testers must be
   a Users & Access member; this one already is.
5. Install TestFlight on the iPhone (App Store) if needed, signed in as that Apple ID → Pulse
   appears → **Install**.

After this, every `cd ios && bundle exec fastlane beta` auto-distributes to the `Admin` group
and TestFlight on the phone notifies you — tap **Update** to install. No per-build clicks.

## Common issues

- **"No team found for selected provisioning profile"**: Your distribution cert expired. Open Xcode → Pulse target → Signing & Capabilities → toggle Automatic signing off and on again so Xcode regenerates the profile.
- **"Build number must be greater than the previous build number"**: TestFlight has a build with the same `CFBundleVersion`. The lane bumps automatically, but if you hand-edited `project.yml` it can race. Re-run `bundle exec fastlane beta`.
- **`xcodegen: command not found`**: `brew install xcodegen`.
- **`bundle: command not found`**: `gem install bundler` (or `brew install ruby`).
