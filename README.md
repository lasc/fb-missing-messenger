# FB Missing Messenger

![FB Missing Messenger Showcase](./resources/screenshots/showcase.jpg)

A native wrapper for Messenger and Facebook Marketplace, built for macOS.

## Features

- **Native Experience**: Standalone Electron app for Messenger and Facebook.
- **Enhanced Sidebar**: Custom sidebar for quick navigation between Messenger, Marketplace, and Saved items.
- **Marketplace Power Tools**:
    - **Tab Management**: Opens listings in new sidebar tabs, preventing duplicates.
    - **Clean UI**: Aggressively hides distractions, chat bubbles, and "Marketplace Assistant" popups.
- **Saved Items**:
    - Includes a custom "Unsave" button injector for easier list management.
- **macOS Integration**:
    - Native Notifications for messages.
    - Dock badging for unread counts.
    - Dock bouncing (throttled) for new alerts.

## Tech Stack

- **Electron**: Main process handling and native integration.
- **React**: Renderer UI and component management.
- **TypeScript**: Type-safe development.
- **Vite**: Fast development server and bundling.

## Installation

1. Download the latest `.dmg` from [Releases](https://github.com/lasc/fb-missing-messenger/releases)
2. Open the DMG and drag **FB Missing Messenger** to your Applications folder
3. **Important — macOS Gatekeeper**: Since this app isn't notarized with Apple, macOS will block it on first launch. Run these commands in Terminal to fix it:

   ```bash
   xattr -cr "/Applications/FB Missing Messenger.app"
   codesign --force --deep --sign - "/Applications/FB Missing Messenger.app"
   ```

4. Launch the app from your Applications folder or Dock

> **Note**: You only need to do step 3 once. In-app updates will work without this step.

## Development

### Install Dependencies

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Build for Production

This project uses `electron-builder` for distribution.

```bash
npm run dist
```

## License

LGPL-3.0-or-later © 2026 Eugeny Perepelyatnikov
