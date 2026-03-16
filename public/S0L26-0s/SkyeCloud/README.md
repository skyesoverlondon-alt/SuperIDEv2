# SkyeCloud

SkyeCloud is a from-scratch creative environment split into dedicated app surfaces.

Included surfaces:
- CloudCode IDE
- DocLab
- DataForge
- FlowBoard
- SnippetVault
- PromptStudio
- AssetVault
- BrandBoard
- DeployDesk
- kAIxU Console

## Deploy
1. Upload the full folder to Netlify or deploy with Netlify CLI.
2. For the optional AI lane, set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`.
3. Visit `/.netlify/functions/health` after deploy to confirm runtime status.

## Notes
- Storage uses IndexedDB in the browser for suite data and assets.
- The AI lane is server-side only. No browser provider key is required.
