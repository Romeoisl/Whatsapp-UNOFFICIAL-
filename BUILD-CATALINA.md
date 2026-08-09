# Build Liquid WhatsApp for Intel Catalina

This project is configured to produce a normal macOS application bundle and a DMG for Intel Macs running macOS Catalina 10.15.x.

## On the 2012 Intel Mac

From Terminal, inside this folder:

```bash
chmod +x build-catalina.sh
./build-catalina.sh
```

The build uses Electron Builder and targets **x64 only**. It will create:

- `dist/Liquid WhatsApp.app` (inside the unpacked/dir build when requested)
- `dist/Liquid-WhatsApp-2.2.2-Catalina-Intel.dmg`
- `dist/Liquid-WhatsApp-2.2.2-Catalina-Intel.zip`

You can also run:

```bash
npm run build:app
```

for the `.app` directory target, or:

```bash
npm run build:catalina
```

for the DMG + ZIP release.

### Important

A real macOS `.app` and DMG are packaged with macOS tooling. Therefore the final packaging step should be run on your Catalina Mac (or another compatible macOS build machine), not Linux/Windows.
