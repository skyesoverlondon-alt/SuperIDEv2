SkyeAce
=======

What this is:
A Netlify Drop-ready static browser game inspired by Spades, with a battle layer.

What is included:
- Offline vs AI mode with 4 difficulty levels
- Couch PvP mode on one device (South player vs East player, with AI partners)
- Score + health bar battle system
- Level unlocks stored in browser localStorage

What is NOT included in this static build:
- Real cross-user online multiplayer across separate devices/browsers
- Login, matchmaking, live rooms, or synced state over the internet

Why:
A plain static Netlify site cannot keep two remote players synchronized by itself. For that you would need a backend lane such as Netlify Functions + a database/realtime layer.

Deploy:
1. Drag this whole folder into Netlify Drop, or zip it first and deploy the zip contents.
2. Publish.
3. Open the site and click New Battle.

Files:
- index.html
- styles.css
- app.js
