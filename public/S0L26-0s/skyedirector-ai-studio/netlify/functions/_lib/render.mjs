import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PRESETS = {
  youtube: { width: 1920, height: 1080 },
  shorts: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
};

export async function renderTimelineMp4(payload) {
  const preset = PRESETS[payload?.presetKey] || PRESETS.youtube;
  const timeline = payload?.timeline;
  if (!timeline?.tracks?.length) throw new Error('Timeline is missing or empty.');

  const duration = Math.max(
    1,
    ...timeline.tracks.flatMap((track) => track.clips.map((clip) => Number(clip.startSec || 0) + Number(clip.durationSec || 0)))
  );

  const working = await mkdtemp(path.join(tmpdir(), 'skyedirector-'));
  const outputFile = path.join(working, `${slug(payload?.episode?.title || 'episode')}.mp4`);

  try {
    const args = ['-y', '-f', 'lavfi', '-i', `color=c=0x05030a:s=${preset.width}x${preset.height}:d=${duration}:r=30`];
    const filters = ['[0:v]format=yuv420p,setsar=1[base0]'];
    let currentVideoLabel = 'base0';
    let inputIndex = 1;
    const audioLabels = [];
    const deferredTextOverlays = [];

    const videoTracks = timeline.tracks.filter((track) => track.type === 'video');
    for (let trackIndex = 0; trackIndex < videoTracks.length; trackIndex += 1) {
      const track = videoTracks[trackIndex];
      const clips = [...track.clips].sort((a, b) => a.startSec - b.startSec);
      for (const clip of clips) {
        if (clip.kind === 'caption' || (!clip.sourceUrl && clip.kind === 'title')) {
          deferredTextOverlays.push({ clip, placement: trackIndex === 0 ? 'center' : 'lower' });
          continue;
        }
        if (!clip.sourceUrl) continue;
        const localFile = await writeSourceFile(working, clip.sourceUrl, clip.mimeType, `visual_${inputIndex}`);
        const sourceMime = clip.mimeType || inferMime(clip.sourceUrl) || '';
        const isVideo = sourceMime.startsWith('video/');
        if (isVideo) {
          args.push('-stream_loop', '-1', '-i', localFile);
        } else {
          args.push('-loop', '1', '-i', localFile);
        }
        const preparedLabel = `vprep${inputIndex}`;
        if (isVideo) {
          filters.push(
            `[${inputIndex}:v]trim=start=${Number(clip.trimStartSec || 0)}:duration=${Number(clip.durationSec || 1)},setpts=PTS-STARTPTS${videoSizingFilter(clip, preset, trackIndex)}[${preparedLabel}]`
          );
        } else {
          filters.push(
            `[${inputIndex}:v]trim=duration=${Number(clip.durationSec || 1)},setpts=PTS-STARTPTS${imageSizingFilter(clip, preset, trackIndex)}[${preparedLabel}]`
          );
        }
        const nextVideoLabel = `v${inputIndex}`;
        filters.push(
          `[${currentVideoLabel}][${preparedLabel}]overlay=${overlayPosition(clip, preset, trackIndex)}:enable='between(t,${Number(clip.startSec || 0)},${Number(clip.startSec || 0) + Number(clip.durationSec || 0)})'[${nextVideoLabel}]`
        );
        currentVideoLabel = nextVideoLabel;
        inputIndex += 1;
      }
    }

    const captionTracks = timeline.tracks.filter((track) => track.type === 'caption');
    for (const track of captionTracks) {
      for (const clip of track.clips) {
        if (clip.text || clip.label) {
          deferredTextOverlays.push({ clip: { ...clip, text: clip.text || clip.label }, placement: 'lower' });
        }
      }
    }

    let drawIndex = 0;
    for (const entry of deferredTextOverlays) {
      const text = escapeDrawText(entry.clip.text || entry.clip.label || '');
      if (!text) continue;
      const nextVideoLabel = `txt${drawIndex}`;
      const fontsize = Math.max(28, Number(entry.clip.textStyle?.fontSize || (entry.placement === 'center' ? 56 : 42)));
      const yPosition = entry.placement === 'center'
        ? '(h-text_h)/2'
        : `${Math.round(preset.height * Number(entry.clip.textStyle?.y || 0.86))}`;
      const drawFilter = `drawtext=text='${text}':fontcolor=${entry.clip.textStyle?.color || '#ffffff'}:fontsize=${fontsize}:x=(w-text_w)/2:y=${yPosition}:box=1:boxcolor=${entry.clip.textStyle?.boxColor || '#00000088'}:boxborderw=18:enable='between(t,${Number(entry.clip.startSec || 0)},${Number(entry.clip.startSec || 0) + Number(entry.clip.durationSec || 0)})'`;
      filters.push(`[${currentVideoLabel}]${drawFilter}[${nextVideoLabel}]`);
      currentVideoLabel = nextVideoLabel;
      drawIndex += 1;
    }

    const audioTracks = timeline.tracks.filter((track) => track.type === 'audio');
    for (const track of audioTracks) {
      const clips = [...track.clips].sort((a, b) => a.startSec - b.startSec);
      for (const clip of clips) {
        if (!clip.sourceUrl) continue;
        const localFile = await writeSourceFile(working, clip.sourceUrl, clip.mimeType, `audio_${inputIndex}`);
        args.push('-i', localFile);
        const delayedLabel = `a${inputIndex}`;
        const delayMs = Math.max(0, Math.round(Number(clip.startSec || 0) * 1000));
        filters.push(
          `[${inputIndex}:a]atrim=start=${Number(clip.trimStartSec || 0)}:duration=${Number(clip.durationSec || 1)},asetpts=PTS-STARTPTS,volume=${Number(clip.volume ?? 1)},adelay=${delayMs}|${delayMs}[${delayedLabel}]`
        );
        audioLabels.push(delayedLabel);
        inputIndex += 1;
      }
    }

    let audioMap = null;
    if (audioLabels.length) {
      filters.push(`${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`);
      audioMap = '[aout]';
    } else {
      args.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
      audioMap = `${inputIndex}:a`;
      inputIndex += 1;
    }

    args.push(
      '-filter_complex',
      filters.join(';'),
      '-map',
      `[${currentVideoLabel}]`,
      '-map',
      audioMap,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-shortest',
      outputFile
    );

    await spawnFfmpeg(args);
    const buffer = await readFile(outputFile);
    return {
      filename: `${slug(payload?.project?.title || 'project')}-${slug(payload?.episode?.title || 'episode')}.mp4`,
      mimeType: 'video/mp4',
      videoBase64: buffer.toString('base64')
    };
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}

function imageSizingFilter(clip, preset, trackIndex) {
  if ((clip.layout || '').toLowerCase() === 'pip' || trackIndex > 0) {
    const targetWidth = Math.round(preset.width * 0.32 * Number(clip.scale || 1));
    return `,scale=${targetWidth}:-1,setsar=1`;
  }
  return `,scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height},setsar=1`;
}

function videoSizingFilter(clip, preset, trackIndex) {
  if ((clip.layout || '').toLowerCase() === 'pip' || trackIndex > 0) {
    const targetWidth = Math.round(preset.width * 0.32 * Number(clip.scale || 1));
    return `,scale=${targetWidth}:-1,setsar=1`;
  }
  return `,scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height},setsar=1`;
}

function overlayPosition(clip, preset, trackIndex) {
  if ((clip.layout || '').toLowerCase() === 'pip' || trackIndex > 0) {
    const x = Number.isFinite(Number(clip.x)) && Number(clip.x) > 0 ? Math.round(Number(clip.x)) : Math.round(preset.width * 0.64);
    const y = Number.isFinite(Number(clip.y)) && Number(clip.y) > 0 ? Math.round(Number(clip.y)) : Math.round(preset.height * (0.08 + trackIndex * 0.06));
    return `${x}:${y}`;
  }
  return '0:0';
}

async function writeSourceFile(dir, sourceUrl, mimeType, prefix) {
  if (String(sourceUrl).startsWith('blob:')) {
    throw new Error('This render lane cannot access browser blob URLs. Re-upload the asset in a smaller inline form or keep it as generated scene media.');
  }
  const buffer = await fetchBinary(sourceUrl);
  const ext = extensionFor(mimeType || inferMime(sourceUrl));
  const filepath = path.join(dir, `${prefix}.${ext}`);
  await writeFile(filepath, buffer);
  return filepath;
}

async function fetchBinary(sourceUrl) {
  if (String(sourceUrl).startsWith('data:')) {
    return dataUrlToBuffer(sourceUrl);
  }
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch source media: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function dataUrlToBuffer(dataUrl) {
  const [, base64 = ''] = String(dataUrl).split(',');
  return Buffer.from(base64, 'base64');
}

function inferMime(sourceUrl) {
  const match = String(sourceUrl || '').match(/^data:(.*?);/);
  return match?.[1] || '';
}

function extensionFor(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  if (value.includes('webp')) return 'webp';
  if (value.includes('mp4')) return 'mp4';
  if (value.includes('webm')) return 'webm';
  if (value.includes('mpeg')) return 'mp3';
  if (value.includes('wav')) return 'wav';
  if (value.includes('ogg')) return 'ogg';
  return 'bin';
}

function spawnFfmpeg(args) {
  return new Promise((resolve, reject) => {
    getFfmpegBinary().then((binaryPath) => {
      const child = spawn(binaryPath, args);
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `FFmpeg exited with code ${code}`));
        }
      });
    }).catch(reject);
    return;
  });
}

function escapeDrawText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\n/g, ' ')
    .trim();
}

function slug(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'item';
}

async function getFfmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const mod = await import('ffmpeg-static');
    return mod.default || mod;
  } catch {
    return 'ffmpeg';
  }
}
