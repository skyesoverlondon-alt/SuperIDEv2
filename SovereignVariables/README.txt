IMPORTANT: HOW TO RUN YOUR PWA
==============================

1. DO NOT double-click index.html
   Browsers block "Service Workers" (the technology that makes PWAs offline) 
   when opened directly from a file folder (file:// protocol).

2. YOU MUST USE A LOCAL SERVER or WEB HOST
   - Option A (Easiest): Upload this folder to Netlify Drop (netlify.com/drop) or GitHub Pages.
   - Option B (Local): If you have Python installed, run "python3 -m http.server" in this folder.
   - Option C (VS Code): Use the "Live Server" extension.

3. INSTALLING ON MOBILE
   Once uploaded to a URL (starts with https://), open it on your phone.
   - iOS: Tap "Share" -> "Add to Home Screen"
   - Android: Tap "Install App" or "Add to Home Screen" from the menu.

Troubleshooting:
- If icons don't show, ensure they are in the same folder as index.html.
- If the app doesn't work offline, ensure you loaded it once while online.