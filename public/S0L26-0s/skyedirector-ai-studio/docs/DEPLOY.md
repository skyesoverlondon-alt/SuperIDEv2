# Deploy guide

This app should be deployed to Netlify via Git.

## 1. Push the repo to GitHub

Put the full repo in a GitHub repository.

## 2. Import to Netlify

In Netlify:
- Add new site from Git
- Choose the repo
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

## 3. Add env vars in Netlify

Add these in Site configuration → Environment variables.

Required:
- `OPENAI_API_KEY`

Recommended:
- `DATABASE_URL`

Optional YouTube lane:
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REFRESH_TOKEN`

## 4. Trigger deploy

Deploy the site.

## 5. Test the lanes

After deploy, verify:
- Producer Brain chat works
- Episode packet generation works
- TTS works
- Image generation works
- Timeline Forge opens
- FFmpeg render returns a downloadable MP4
- YouTube config endpoint returns `ready: true` if creds are set

## Notes

- The FFmpeg render lane uses `ffmpeg-static`, so Git deployment matters.
- The background render endpoint returns `202` and runs asynchronously. To make long renders useful in production, add a storage or callback lane.
- If you plan to publish to YouTube, set up a Google Cloud project and OAuth refresh token for the channel you control.
