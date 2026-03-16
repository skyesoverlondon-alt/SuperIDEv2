import JSZip from 'jszip';

const STORAGE_KEY = 'skyedirector.projects.v2';
const CLIENT_KEY = 'skyedirector.client.v1';

export const EXPORT_PRESETS = {
  youtube: { key: 'youtube', label: 'YouTube 16:9', width: 1920, height: 1080, ratio: '16:9' },
  shorts: { key: 'shorts', label: 'Shorts / Reels 9:16', width: 1080, height: 1920, ratio: '9:16' },
  square: { key: 'square', label: 'Square 1:1', width: 1080, height: 1080, ratio: '1:1' }
};

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function getClientId() {
  let value = localStorage.getItem(CLIENT_KEY);
  if (!value) {
    value = uid('client');
    localStorage.setItem(CLIENT_KEY, value);
  }
  return value;
}

export function makeScene(index = 1) {
  return {
    id: uid('scene'),
    title: `Scene ${index}`,
    durationSec: 4,
    visualPrompt: '',
    narration: '',
    notes: '',
    imageUrl: '',
    audioUrl: '',
    audioMime: 'audio/mpeg'
  };
}

export function makeTimelineClip(partial = {}) {
  return {
    id: uid('clip'),
    label: partial.label || 'Clip',
    kind: partial.kind || 'image',
    sourceType: partial.sourceType || 'scene',
    sourceRef: partial.sourceRef || '',
    sourceUrl: partial.sourceUrl || '',
    mimeType: partial.mimeType || '',
    startSec: Number(partial.startSec || 0),
    durationSec: Math.max(0.5, Number(partial.durationSec || 4)),
    trimStartSec: Math.max(0, Number(partial.trimStartSec || 0)),
    volume: typeof partial.volume === 'number' ? partial.volume : 1,
    opacity: typeof partial.opacity === 'number' ? partial.opacity : 1,
    x: typeof partial.x === 'number' ? partial.x : 0,
    y: typeof partial.y === 'number' ? partial.y : 0,
    scale: typeof partial.scale === 'number' ? partial.scale : 1,
    layout: partial.layout || 'cover',
    waveform: Array.isArray(partial.waveform) ? partial.waveform : [],
    text: partial.text || '',
    textStyle: partial.textStyle || {
      fontSize: 42,
      color: '#ffffff',
      boxColor: '#00000088',
      y: 0.86
    }
  };
}

export function makeTimeline(title = 'Main Timeline') {
  return {
    id: uid('timeline'),
    title,
    zoom: 56,
    fps: 30,
    tracks: [
      { id: uid('track'), title: 'Video 1', type: 'video', clips: [] },
      { id: uid('track'), title: 'Audio 1', type: 'audio', clips: [] },
      { id: uid('track'), title: 'Captions', type: 'caption', clips: [] }
    ]
  };
}

export function makeEpisode(index = 1) {
  const timeline = makeTimeline(`Episode ${index} Timeline`);
  return {
    id: uid('ep'),
    title: `Episode ${index}`,
    objective: '',
    hook: '',
    summary: '',
    script: '',
    shotList: [],
    tags: [],
    description: '',
    scenes: [makeScene(1), makeScene(2), makeScene(3)],
    captions: '',
    thumbnailPrompt: '',
    timeline,
    youtube: {
      title: '',
      description: '',
      privacyStatus: 'private',
      tags: []
    },
    lastRender: null,
    renderJobs: []
  };
}

export function makeProject() {
  return {
    id: uid('project'),
    title: 'New Creator Project',
    goal: '',
    audience: '',
    tone: 'Cinematic teacher',
    seriesAngle: '',
    platforms: ['YouTube', 'Shorts', 'Instagram Reels'],
    chat: [
      {
        id: uid('msg'),
        role: 'assistant',
        content:
          'I am your producer brain. Give me the goal, audience, and the kind of content engine you want to build, and I will turn it into episodes, scripts, scenes, timelines, and exports.'
      }
    ],
    episodes: [makeEpisode(1)],
    assets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function ensureProjectShape(project) {
  const next = structuredClone(project);
  next.chat ||= [];
  next.assets ||= [];
  next.platforms ||= ['YouTube'];
  next.episodes = Array.isArray(next.episodes) ? next.episodes : [makeEpisode(1)];
  next.episodes = next.episodes.map((episode, index) => ensureEpisodeShape(episode, index, next));
  next.updatedAt ||= new Date().toISOString();
  next.createdAt ||= next.updatedAt;
  return next;
}

export function ensureEpisodeShape(episode, index = 0, project = null) {
  const next = structuredClone(episode);
  next.id ||= uid('ep');
  next.title ||= `Episode ${index + 1}`;
  next.scenes = Array.isArray(next.scenes) && next.scenes.length ? next.scenes : [makeScene(1), makeScene(2), makeScene(3)];
  next.timeline = ensureEpisodeTimeline(next, project);
  next.youtube ||= { title: next.title, description: next.description || '', privacyStatus: 'private', tags: next.tags || [] };
  next.lastRender ||= null;
  next.renderJobs ||= [];
  return next;
}

export function ensureEpisodeTimeline(episode, project = null) {
  const existing = episode.timeline ? structuredClone(episode.timeline) : makeTimeline(`${episode.title || 'Episode'} Timeline`);
  existing.id ||= uid('timeline');
  existing.title ||= `${episode.title || 'Episode'} Timeline`;
  existing.zoom = clamp(Number(existing.zoom || 56), 28, 140);
  existing.fps ||= 30;
  existing.tracks = Array.isArray(existing.tracks) ? existing.tracks : [];
  if (!existing.tracks.some((track) => track.type === 'video')) {
    existing.tracks.unshift({ id: uid('track'), title: 'Video 1', type: 'video', clips: [] });
  }
  if (!existing.tracks.some((track) => track.type === 'audio')) {
    existing.tracks.push({ id: uid('track'), title: 'Audio 1', type: 'audio', clips: [] });
  }
  if (!existing.tracks.some((track) => track.type === 'caption')) {
    existing.tracks.push({ id: uid('track'), title: 'Captions', type: 'caption', clips: [] });
  }
  existing.tracks = existing.tracks.map((track) => ({
    id: track.id || uid('track'),
    title: track.title || `${capitalize(track.type || 'Track')} Lane`,
    type: track.type || 'video',
    clips: Array.isArray(track.clips) ? track.clips.map((clip) => makeTimelineClip(clip)) : []
  }));

  const clipCount = existing.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  if (!clipCount && episode.scenes?.length) {
    return buildTimelineFromScenes(episode, project, existing);
  }
  return existing;
}

export function buildTimelineFromScenes(episode, project = null, baseTimeline = null) {
  const timeline = baseTimeline ? structuredClone(baseTimeline) : makeTimeline(`${episode.title || 'Episode'} Timeline`);
  const videoTrack = timeline.tracks.find((track) => track.type === 'video') || timeline.tracks[0];
  const audioTrack = timeline.tracks.find((track) => track.type === 'audio') || timeline.tracks[1];
  const captionTrack = timeline.tracks.find((track) => track.type === 'caption') || timeline.tracks[timeline.tracks.length - 1];
  videoTrack.clips = [];
  audioTrack.clips = [];
  captionTrack.clips = [];
  let cursor = 0;
  (episode.scenes || []).forEach((scene, index) => {
    const duration = Math.max(0.5, Number(scene.durationSec || 4));
    videoTrack.clips.push(
      makeTimelineClip({
        label: scene.title || `Scene ${index + 1}`,
        kind: scene.imageUrl ? 'image' : 'title',
        sourceType: 'scene',
        sourceRef: scene.id,
        sourceUrl: scene.imageUrl || '',
        mimeType: scene.imageUrl?.match(/^data:(.*?);/)?.[1] || 'image/png',
        startSec: cursor,
        durationSec: duration,
        text: scene.title || `Scene ${index + 1}`
      })
    );
    captionTrack.clips.push(
      makeTimelineClip({
        label: `Caption ${index + 1}`,
        kind: 'caption',
        sourceType: 'scene',
        sourceRef: scene.id,
        startSec: cursor,
        durationSec: duration,
        text: scene.narration || scene.notes || scene.title || `Scene ${index + 1}`,
        textStyle: { fontSize: 42, color: '#ffffff', boxColor: '#00000088', y: 0.86 }
      })
    );
    if (scene.audioUrl) {
      audioTrack.clips.push(
        makeTimelineClip({
          label: `${scene.title || `Scene ${index + 1}`} Voice`,
          kind: 'audio',
          sourceType: 'scene',
          sourceRef: scene.id,
          sourceUrl: scene.audioUrl,
          mimeType: scene.audioMime || scene.audioUrl?.match(/^data:(.*?);/)?.[1] || 'audio/mpeg',
          startSec: cursor,
          durationSec: duration,
          waveform: []
        })
      );
    }
    cursor += duration;
  });
  return timeline;
}

export function loadLocalProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((project) => ensureProjectShape(project)) : [];
  } catch {
    return [];
  }
}

export function saveLocalProjects(projects) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export async function api(path, options = {}) {
  const clientId = getClientId();
  const headers = {
    'x-skye-client-id': clientId,
    ...(options.headers || {})
  };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    ...options,
    headers
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response;
}

export async function postJson(path, body) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

export function blobFromBase64(base64, mime = 'application/octet-stream') {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export function dataUrlToBlob(dataUrl) {
  const [head, base64] = String(dataUrl || '').split(',');
  const mime = head.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream';
  return blobFromBase64(base64 || '', mime);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function buildEpisodeSrt(episode) {
  const captionTrack = ensureEpisodeTimeline(episode).tracks.find((track) => track.type === 'caption');
  if (captionTrack?.clips?.length) {
    return captionTrack.clips
      .slice()
      .sort((a, b) => a.startSec - b.startSec)
      .map((clip, index) => {
        const start = formatSrtTime(clip.startSec);
        const end = formatSrtTime(clip.startSec + clip.durationSec);
        return `${index + 1}\n${start} --> ${end}\n${(clip.text || clip.label || '').trim()}\n`;
      })
      .join('\n');
  }

  let time = 0;
  const lines = [];
  episode.scenes.forEach((scene, index) => {
    const duration = Math.max(1, Number(scene.durationSec) || 4);
    const start = formatSrtTime(time);
    time += duration;
    const end = formatSrtTime(time);
    const text = (scene.narration || scene.title || `Scene ${index + 1}`).trim();
    lines.push(`${index + 1}\n${start} --> ${end}\n${text}\n`);
  });
  return lines.join('\n');
}

function formatSrtTime(totalSeconds) {
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const whole = Math.floor(totalSeconds);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':') + `,${String(ms).padStart(3, '0')}`;
}

export function getTimelineDuration(timeline) {
  return Math.max(
    1,
    ...(timeline?.tracks || []).flatMap((track) => (track.clips || []).map((clip) => Number(clip.startSec || 0) + Number(clip.durationSec || 0)))
  );
}

export function getEpisodeDuration(episode) {
  return getTimelineDuration(ensureEpisodeTimeline(episode));
}

export function secondsLabel(value) {
  const sec = Number(value || 0);
  const whole = Math.max(0, Math.round(sec));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function buildWaveformPeaksFromAudioBuffer(audioBuffer, samples = 64) {
  const channel = audioBuffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(channel.length / samples));
  const peaks = [];
  for (let i = 0; i < samples; i += 1) {
    let sum = 0;
    const start = i * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    for (let j = start; j < end; j += 1) {
      sum += Math.abs(channel[j]);
    }
    peaks.push(Number((sum / Math.max(1, end - start)).toFixed(4)));
  }
  const max = Math.max(...peaks, 0.01);
  return peaks.map((value) => Number((value / max).toFixed(4)));
}

export async function buildWaveformPeaksFromUrl(url, samples = 64) {
  if (!url) return [];
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const peaks = buildWaveformPeaksFromAudioBuffer(buffer, samples);
  await audioContext.close();
  return peaks;
}

export function resolveClipSource(project, episode, clip) {
  if (clip.sourceUrl) return clip.sourceUrl;
  if (clip.sourceType === 'scene') {
    const scene = episode.scenes.find((item) => item.id === clip.sourceRef);
    if (!scene) return '';
    if (clip.kind === 'audio') return scene.audioUrl || '';
    if (clip.kind === 'caption') return '';
    return scene.imageUrl || '';
  }
  if (clip.sourceType === 'asset') {
    const asset = project.assets.find((item) => item.id === clip.sourceRef);
    return asset?.url || '';
  }
  return '';
}

export function resolveClipMime(project, episode, clip) {
  if (clip.mimeType) return clip.mimeType;
  const sourceUrl = resolveClipSource(project, episode, clip);
  return sourceUrl.match(/^data:(.*?);/)?.[1] || '';
}

export function serializeTimelineForRender({ project, episode, presetKey }) {
  const timeline = ensureEpisodeTimeline(episode, project);
  return {
    project: {
      id: project.id,
      title: project.title,
      brand: 'Skyes Over London LC'
    },
    episode: {
      id: episode.id,
      title: episode.title
    },
    presetKey,
    timeline: {
      ...timeline,
      tracks: timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          sourceUrl: resolveClipSource(project, episode, clip),
          mimeType: resolveClipMime(project, episode, clip)
        }))
      }))
    }
  };
}

export async function exportProjectPackage(project, presetKey = 'youtube') {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file(
    'README.txt',
    [
      `${project.title}`,
      '',
      `Goal: ${project.goal || 'Not set'}`,
      `Audience: ${project.audience || 'Not set'}`,
      `Preset: ${EXPORT_PRESETS[presetKey]?.label || presetKey}`,
      '',
      'This package includes scripts, captions, prompts, asset references, timeline JSON, and latest FFmpeg render metadata from SkyeDirector AI Studio.'
    ].join('\n')
  );

  project.episodes.forEach((episode, index) => {
    const folder = zip.folder(`episodes/${String(index + 1).padStart(2, '0')}-${slugify(episode.title || `episode-${index + 1}`)}`);
    folder.file('episode.json', JSON.stringify(episode, null, 2));
    folder.file('timeline.json', JSON.stringify(ensureEpisodeTimeline(episode, project), null, 2));
    folder.file('script.md', episode.script || '');
    folder.file('description.txt', episode.description || '');
    folder.file('thumbnail-prompt.txt', episode.thumbnailPrompt || '');
    folder.file('captions.srt', buildEpisodeSrt(episode));
    folder.file(
      'shot-list.md',
      (episode.shotList || []).map((shot, shotIndex) => `- Shot ${shotIndex + 1}: ${shot}`).join('\n')
    );

    episode.scenes.forEach((scene, sceneIndex) => {
      const sceneFolder = folder.folder(`scenes/${String(sceneIndex + 1).padStart(2, '0')}-${slugify(scene.title || `scene-${sceneIndex + 1}`)}`);
      sceneFolder.file('scene.json', JSON.stringify(scene, null, 2));
      sceneFolder.file('prompt.txt', scene.visualPrompt || '');
      sceneFolder.file('narration.txt', scene.narration || '');
      if (scene.imageUrl?.startsWith('data:image/')) {
        const [head, data] = scene.imageUrl.split(',');
        const ext = head.includes('jpeg') ? 'jpg' : head.includes('webp') ? 'webp' : 'png';
        sceneFolder.file(`visual.${ext}`, data, { base64: true });
      }
      if (scene.audioUrl?.startsWith('data:audio/')) {
        const [head, data] = scene.audioUrl.split(',');
        const ext = head.includes('wav') ? 'wav' : head.includes('ogg') ? 'ogg' : 'mp3';
        sceneFolder.file(`voiceover.${ext}`, data, { base64: true });
      }
    });

    if (episode.lastRender?.base64) {
      folder.file(`renders/${slugify(episode.title || 'episode')}.mp4`, episode.lastRender.base64, { base64: true });
      folder.file('renders/render.json', JSON.stringify(episode.lastRender, null, 2));
    }
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${slugify(project.title || 'skyedirector-project')}.zip`);
}

export async function exportStoryboardVideo({ project, episode, presetKey = 'youtube', onProgress }) {
  const preset = EXPORT_PRESETS[presetKey] || EXPORT_PRESETS.youtube;
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');

  const scenes = (episode.scenes || []).map((scene, index) => ({
    ...scene,
    durationSec: Math.max(1, Number(scene.durationSec) || 4),
    fallbackTitle: `Scene ${index + 1}`
  }));
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  if (!totalDuration) throw new Error('No scenes to export');

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const destination = audioContext.createMediaStreamDestination();

  const preparedScenes = await Promise.all(
    scenes.map(async (scene) => {
      const prepared = { ...scene, image: null, audioBuffer: null };
      if (scene.imageUrl) {
        prepared.image = await loadImage(scene.imageUrl);
      }
      if (scene.audioUrl) {
        const response = await fetch(scene.audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        prepared.audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      }
      return prepared;
    })
  );

  const captureStream = canvas.captureStream(30);
  const mixedStream = new MediaStream([...captureStream.getVideoTracks(), ...destination.stream.getAudioTracks()]);

  const mimeCandidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
  const chunks = [];
  const recorder = new MediaRecorder(mixedStream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const startAt = audioContext.currentTime + 0.15;
  let runningOffset = 0;
  preparedScenes.forEach((scene) => {
    if (scene.audioBuffer) {
      const source = audioContext.createBufferSource();
      source.buffer = scene.audioBuffer;
      source.connect(destination);
      source.start(startAt + runningOffset);
    }
    runningOffset += scene.durationSec;
  });

  recorder.start(250);
  await audioContext.resume();

  const brandName = (import.meta.env.VITE_BRAND_ORG || 'Skyes Over London LC').toUpperCase();
  const projectName = project.title || 'Creator Project';
  const started = performance.now();

  await new Promise((resolve) => {
    function drawFrame(now) {
      const elapsedSec = (now - started) / 1000;
      const clamped = Math.min(elapsedSec, totalDuration);
      const current = sceneAt(preparedScenes, clamped);
      const sceneStart = sumDurations(preparedScenes.slice(0, current.index));
      const sceneTime = clamped - sceneStart;
      renderSceneFrame(ctx, preset, current.scene, sceneTime, brandName, projectName);
      if (typeof onProgress === 'function') {
        onProgress(Math.min(100, Math.round((clamped / totalDuration) * 100)));
      }
      if (elapsedSec < totalDuration + 0.08) {
        requestAnimationFrame(drawFrame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(drawFrame);
  });

  await sleep(250);
  recorder.stop();
  await new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  const ext = mimeType.includes('vp9') || mimeType.includes('webm') ? 'webm' : 'mp4';
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  downloadBlob(blob, `${slugify(project.title || 'skyedirector')}-${slugify(episode.title || 'episode')}-${preset.key}.${ext}`);
  destination.stream.getTracks().forEach((track) => track.stop());
  captureStream.getTracks().forEach((track) => track.stop());
  await audioContext.close();
}

function renderSceneFrame(ctx, preset, scene, sceneTime, brandName, projectName) {
  const { width, height } = preset;
  const progress = Math.min(1, Math.max(0, sceneTime / Math.max(1, scene.durationSec)));
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#05030a');
  gradient.addColorStop(0.45, '#140b21');
  gradient.addColorStop(1, '#04070d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = 'rgba(168,106,255,0.16)';
  for (let x = 0; x < width; x += Math.max(48, Math.round(width / 28))) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += Math.max(48, Math.round(height / 28))) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  if (scene.image) {
    const zoom = 1.02 + progress * 0.05;
    const baseW = width * zoom;
    const baseH = height * zoom;
    const ratio = Math.max(baseW / scene.image.width, baseH / scene.image.height);
    const drawW = scene.image.width * ratio;
    const drawH = scene.image.height * ratio;
    const shiftX = (width - drawW) / 2 - progress * 22;
    const shiftY = (height - drawH) / 2 - progress * 14;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.drawImage(scene.image, shiftX, shiftY, drawW, drawH);
    ctx.restore();
    const overlay = ctx.createLinearGradient(0, 0, 0, height);
    overlay.addColorStop(0, 'rgba(6,4,12,0.15)');
    overlay.addColorStop(0.6, 'rgba(6,4,12,0.35)');
    overlay.addColorStop(1, 'rgba(2,2,6,0.82)');
    ctx.fillStyle = overlay;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.fillStyle = 'rgba(255, 214, 96, 0.92)';
  ctx.font = `${Math.round(width * 0.018)}px Inter, Arial`;
  ctx.fillText(brandName, width * 0.06, height * 0.09);

  ctx.fillStyle = 'white';
  ctx.font = `700 ${Math.round(width * 0.052)}px Inter, Arial`;
  wrapText(ctx, scene.title || scene.fallbackTitle, width * 0.06, height * 0.2, width * 0.52, width * 0.06);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `500 ${Math.round(width * 0.024)}px Inter, Arial`;
  wrapText(ctx, scene.narration || scene.notes || 'Add narration for this scene.', width * 0.06, height * 0.42, width * 0.56, width * 0.035);

  if (scene.visualPrompt) {
    ctx.fillStyle = 'rgba(168,106,255,0.95)';
    ctx.font = `${Math.round(width * 0.017)}px IBM Plex Mono, monospace`;
    wrapText(ctx, `VISUAL: ${scene.visualPrompt}`, width * 0.06, height * 0.74, width * 0.52, width * 0.024);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.68)';
  ctx.font = `${Math.round(width * 0.017)}px IBM Plex Mono, monospace`;
  ctx.fillText(projectName, width * 0.06, height * 0.93);
  ctx.fillText(`Duration ${scene.durationSec}s`, width * 0.78, height * 0.93);

  ctx.fillStyle = 'rgba(255,214,96,0.9)';
  ctx.fillRect(width * 0.06, height * 0.96, width * 0.88 * progress, height * 0.008);
}

function sceneAt(scenes, elapsed) {
  let running = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    running += scenes[index].durationSec;
    if (elapsed <= running) return { scene: scenes[index], index };
  }
  return { scene: scenes[scenes.length - 1], index: scenes.length - 1 };
}

function sumDurations(scenes) {
  return scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let currentY = y;
  words.forEach((word) => {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = trial;
    }
  });
  if (line) ctx.fillText(line, x, currentY);
}

export function slugify(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'item';
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
