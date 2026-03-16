function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

export function youtubeReady() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

async function accessToken() {
  const params = new URLSearchParams({
    client_id: required('YOUTUBE_CLIENT_ID'),
    client_secret: required('YOUTUBE_CLIENT_SECRET'),
    refresh_token: required('YOUTUBE_REFRESH_TOKEN'),
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.access_token;
}

export async function uploadVideoToYoutube({ base64, mimeType = 'video/mp4', title, description, tags = [], privacyStatus = 'private' }) {
  if (!youtubeReady()) {
    throw new Error('YouTube env vars are not configured. Add YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN.');
  }
  const token = await accessToken();
  const buffer = Buffer.from(base64, 'base64');
  const metadata = {
    snippet: {
      title,
      description,
      tags
    },
    status: {
      privacyStatus
    }
  };
  const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(buffer.byteLength),
      'X-Upload-Content-Type': mimeType
    },
    body: JSON.stringify(metadata)
  });
  if (!initRes.ok) throw new Error(await initRes.text());
  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) throw new Error('YouTube resumable upload URL was not returned.');

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': String(buffer.byteLength),
      'Content-Type': mimeType
    },
    body: buffer
  });
  if (!uploadRes.ok) throw new Error(await uploadRes.text());
  const json = await uploadRes.json();
  return {
    videoId: json.id,
    url: `https://www.youtube.com/watch?v=${json.id}`
  };
}
