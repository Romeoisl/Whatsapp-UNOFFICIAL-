# Liquid WhatsApp 2.1

Liquid WhatsApp is an unofficial Electron desktop client using the WhatsApp protocol through Baileys. It targets macOS Catalina and Intel Macs.

### Credits
Made by Gerald (Mateo devs). We look forward to adding more features and making more useful utilities for older Macs.

WhatsApp and the WhatsApp name, logo and related marks are trademarks of Meta Platforms, Inc. Liquid WhatsApp is independent, unofficial software and is not affiliated with or endorsed by Meta.

## 2.1 highlights

- Native macOS notifications with preview/sound controls
- Persistent append-only local message database (`messages.db.jsonl`) with legacy migration
- Offline text outbox with automatic retry after reconnection
- Automatic local backup plus manual JSON export (auth/session credentials are not exported)
- Chat search and in-chat message search
- Contact/profile and group-management views
- Media gallery and drag-and-drop attachments
- Pin, mute, archive and starred messages
- System/light/dark/Liquid Glass themes
- macOS keyboard shortcuts: `⌘K` chat search, `⌘F` message search, `Esc` close/cancel
- Dock unread badge and notification click-to-open-chat
- Reconnection and session recovery improvements
- Full WhatsApp-style Settings & Preferences navigation
- Profile, Account, Privacy, Chats, Notifications, Storage & data, Shortcuts, AI and About sections
- In-app credits for Gerald (Mateo devs) and WhatsApp/Meta trademark attribution
- Reduced-motion preference and improved settings persistence

## Run

```bash
npm install
npm run check
npm start
```

## Build for Intel Catalina

```bash
npm run dist
```

The build is configured for x64 and a minimum macOS version of 10.15.

## Important limitations

This is an unofficial client. It does not implement the proprietary WhatsApp Desktop voice/video media stack. Baileys can expose call signaling, but a real WhatsApp media call requires the official call stack. View-once privacy protections are not bypassed.


## v2.2 Liquid Glass-inspired UI
This release adds a Tahoe/iOS 26-inspired glass visual layer: translucent panels, adaptive blur/saturation, soft specular highlights, floating controls, clear/tinted/performance glass modes, and reduced-motion support. Because Catalina predates macOS 26, these are implemented with Electron/CSS rather than Apple's native Liquid Glass APIs.

## FFmpeg voice-note pipeline (v2.2.1)

Voice recordings made by Electron are normalized with the bundled `ffmpeg-static` binary before upload. The app converts browser WebM/Opus recordings to OGG/Opus (`audio/ogg; codecs=opus`) and sends them as WhatsApp push-to-talk audio (`ptt: true`).

Install dependencies before running or building:

```bash
npm install
npm run check
npm start
```

For Intel Catalina packaging:

```bash
npm run dist
```

The electron-builder configuration unpacks the FFmpeg binary so it can execute outside the ASAR archive.
