# FB Missing Messenger

![FB Missing Messenger Showcase](./resources/screenshots/showcase.jpg)

A native wrapper for Messenger and Facebook Marketplace , built for macOS.

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
*Note: macOS code signing is currently skipped/self-signed.*

## License

ISC © 2026 Eugeny Perepelyatnikov
