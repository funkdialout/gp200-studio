# GP200 Studio desktop

Electron wrapper around the built web app. GitHub Actions
(`.github/workflows/desktop.yml`) builds it on every push to `PRODUCTION` and
publishes installers to the repo's Releases page:

| OS | File | First launch |
|---|---|---|
| Windows | `GP200-Studio-*-win-x64.exe` | Unsigned: SmartScreen → More info → Run anyway. Installs per-user and adds a desktop icon. |
| macOS (Intel) | `GP200-Studio-*-mac-x64.dmg` | Unsigned: drag to Applications, then right-click → Open once. |
| Linux | `GP200-Studio-*-linux-x86_64.AppImage` | `chmod +x`, then run. Needs `libfuse2` on newer distros. |

How it works: `app/main.cjs` serves `app/dist` (copied in by CI from the root
`npm run build`) on a private `app://gp200` origin, grants MIDI/SysEx and audio
input to that origin only, and opens external links in the default browser.
Settings persist across launches and updates because the origin never changes.
