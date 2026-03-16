import { json } from './_lib/http.mjs';
import { youtubeReady } from './_lib/youtube.mjs';

export default async function handler() {
  return json({ ready: youtubeReady() });
}
