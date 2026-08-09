# Build the Catalina Intel DMG on GitHub

This project includes a GitHub Actions workflow that builds the existing
Electron app as an unsigned Intel (`x64`) macOS DMG.

## Steps

1. Create a GitHub repository.
2. Upload the contents of this project.
3. Open **Actions**.
4. Select **Build Liquid WhatsApp DMG**.
5. Click **Run workflow**.
6. Wait for the build to finish.
7. Open the completed workflow run.
8. Download the **Liquid-WhatsApp-Catalina-Intel-DMG** artifact.

The workflow uses a GitHub-hosted Intel macOS runner, so your 2012 Catalina Mac
does not need to install Xcode just to perform this build.

The resulting DMG is unsigned/not notarized. macOS may therefore show a
security warning when opening it. This workflow does not include Apple signing
credentials or attempt to bypass Gatekeeper.
