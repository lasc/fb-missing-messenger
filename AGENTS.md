# Agent Guide — FB Missing Messenger

> **This document is for AI coding agents working on this project.**
> It contains critical context, gotchas, and patterns to avoid repeated mistakes.

---

## ⚠️ Critical: This is NOT a Web App

**This is a native macOS Electron application.** It does NOT run in a web browser.

- **DO NOT** use browser tools (`browser_subagent`, `read_browser_page`, etc.) to preview or test this app. They will always fail with `chrome-error://chromewebdata/`.
- **DO NOT** try to open `localhost:5173` or any dev server URL in a browser agent — the renderer runs inside Electron, not a standalone web server.
- **To test**, the user must run `npm run dev` in a terminal and interact with the native Electron window themselves.
- **To verify code correctness**, use `npx electron-vite build` — if it exits cleanly, TypeScript compiled and Vite bundled successfully.

---

## Project Architecture

```
src/
├── main/
│   └── index.ts          ← Electron main process (BrowserWindow, IPC, native APIs)
├── preload/
│   ├── index.ts           ← Preload for the main BrowserWindow (contextBridge)
│   └── webview-preload.ts ← Preload for <webview> tags (runs inside Facebook pages)
└── renderer/
    └── src/
        ├── main.tsx       ← React entry point
        ├── App.tsx        ← Main app component (tabs, sidebar, webview management)
        ├── Settings.tsx   ← Settings panel component
        └── assets/
            └── index.css  ← All styles (no Tailwind, vanilla CSS only)
```

### Three Execution Contexts

Understanding these is **essential** — code runs in three isolated contexts:

| Context | File | Has access to | Communicates via |
|---------|------|---------------|------------------|
| **Main Process** | `src/main/index.ts` | Node.js, Electron APIs (`app`, `BrowserWindow`, `Notification`, `shell`, `ipcMain`) | `ipcMain.on()` / `ipcMain.handle()` |
| **Renderer** (React) | `src/renderer/src/*.tsx` | DOM, React, `window.electron.ipcRenderer` (exposed via preload) | `window.electron.ipcRenderer.send()` / `.invoke()` / `.on()` |
| **Webview Preload** | `src/preload/webview-preload.ts` | DOM of the Facebook page, `ipcRenderer` (from electron import) | `ipcRenderer.sendToHost()` → received by `<webview>.addEventListener('ipc-message')` in renderer |

### IPC Message Flow

```
Facebook page → webview-preload.ts → (sendToHost) → App.tsx → (ipcRenderer.send) → main/index.ts
```

Key channels:
- `webview-notification` — Facebook fires Notification → preload intercepts → sends to App.tsx for filtering
- `show-notification` — App.tsx (after filtering) → main process → native macOS Notification
- `notification-clicked` — main process → renderer → switch to messenger tab
- `unread-count` — webview preload → App.tsx → main process → dock badge
- `open-external-url` — any context → main process → `shell.openExternal()`
- `open-link` — webview preload → App.tsx → opens marketplace item tab
- `get-settings` / `save-settings` — renderer ↔ main process (JSON persistence)
- `get-app-version` — renderer → main process
- `check-for-updates` / `perform-update` — renderer ↔ main process

---

## Build & Dev

### Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Electron dev mode (hot-reload for renderer)
npm run build        # Build all (main + preload + renderer) to out/
npm run dist         # Build + package as .dmg via electron-builder
```

### Build Verification (for agents)

```bash
npx electron-vite build 2>&1 | tail -20
```

If this exits cleanly with `✓ built in Xms` for all three environments (main, preload, renderer), the code compiles correctly.

### Important Build Notes

- The `electron-vite` config has **two preload entry points**: `index.ts` and `webview-preload.ts` (see `electron.vite.config.ts`)
- Output goes to `out/` directory
- The `webview-preload.js` output path is referenced in `main/index.ts` via `join(__dirname, '../preload/webview-preload.js')`

---

## Key Patterns

### Settings System

Settings are persisted as JSON at `~/Library/Application Support/fb-missing-messenger/app-settings.json`.

```typescript
// Settings interface (defined in Settings.tsx)
interface AppSettings {
    notifications: boolean       // Enable/disable native notifications
    notificationSound: boolean   // Play sound with notifications
    dockBounce: boolean          // Bounce dock icon on new message
    badgeCount: boolean          // Show unread count on dock
    hideChatBubbles: boolean     // Remove chat overlays on Marketplace/Saved
    unsaveButton: boolean        // Inject unsave buttons on Saved page
    debugLogging: boolean        // Verbose console logging
    autoCheckUpdates: boolean    // Check GitHub releases on launch
}
```

- **Renderer** uses a `settingsRef` (React ref) so closure-captured event handlers always read the latest values
- **Main process** reads settings from disk on each use (no caching) since settings change infrequently

### Notification Filtering Pipeline

The notification filter is in `App.tsx` `handleIpcMessage` and has 5 layers:

1. **Source path** — Must come from `/messages` for messenger tab
2. **Title + Body** — Must have both (rejects title-only FB notifications)
3. **Title length** — Must be ≤ 50 chars (sender names are short)
4. **Blocklist** — Rejects patterns like "commented", "friend request", "story", etc.
5. **Allowlist** — Must match message patterns ("sent you a", "new message", etc.) OR have a messenger-specific tag OR short body

Debug logging for this is gated on `settings.debugLogging`.

### Chat Bubble Removal

Non-messenger tabs (Marketplace, Saved) use three strategies to hide Facebook chat overlays:
1. **CSS injection** — `baseHideCSS` and `facebookChromeCSS` (attribute selectors)
2. **DOM MutationObserver** — In `webview-preload.ts`, removes elements by aria-label/role
3. **Periodic interval** — "Scorched earth" scan every 2s for fixed-position elements at bottom-right

All three are gated on `settings.hideChatBubbles`.

### Tab Management

- Three permanent tabs: Messenger (`💬`), Marketplace (`🏪`), Saved (`🔖`)
- Dynamic marketplace item tabs (`📦`) with auto-pruning (max 5)
- All webviews use `partition="persist:webview"` for shared persistent sessions/cookies
- Webviews are kept alive when hidden (moved offscreen) to avoid reloading Facebook

---

## Common Gotchas

1. **`npx` not found** — The user's shell may not have node in PATH. Use: `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" && npx ...`

2. **Stale closures** — Event handlers attached via `addEventListener` in `useEffect` capture variables at attachment time. Use refs (`settingsRef`, `tabsRef`) for values that change.

3. **Webview preload vs main preload** — `src/preload/index.ts` is for the BrowserWindow (exposes `window.electron`). `src/preload/webview-preload.ts` is for `<webview>` tags (runs inside Facebook pages, uses `ipcRenderer.sendToHost()`). Don't confuse them.

4. **Facebook DOM changes** — CSS selectors targeting Facebook elements break frequently. The chat bubble removal uses multiple redundant strategies for resilience.

5. **macOS Gatekeeper** — Built .app bundles need `xattr -cr` and `codesign --force --deep --sign -` to run without a paid Apple Developer cert.

6. **TypeScript `as any` casts** — Some Electron types (e.g., `urgency` on Notification) need explicit casts. This is intentional.

---

## File Quick Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src/main/index.ts` | Main process: window, IPC, updates, notifications, settings | ~470 |
| `src/preload/webview-preload.ts` | Facebook page injection: notification override, unread count, chat removal, link intercept | ~430 |
| `src/preload/index.ts` | BrowserWindow preload: contextBridge setup | ~23 |
| `src/renderer/src/App.tsx` | React app: tabs, sidebar, webview lifecycle, notification filtering | ~1005 |
| `src/renderer/src/Settings.tsx` | Settings panel UI with toggle switches | ~198 |
| `src/renderer/src/assets/index.css` | All CSS (dark theme, sidebar, settings, toggles) | ~520 |
| `electron.vite.config.ts` | Build config with dual preload entry points | ~43 |
| `package.json` | Dependencies, scripts, electron-builder config | ~52 |
