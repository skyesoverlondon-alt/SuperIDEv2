import { useEffect, useMemo, useState } from 'react';
import {
  EXPORT_PRESETS,
  buildEpisodeSrt,
  buildTimelineFromScenes,
  buildWaveformPeaksFromUrl,
  downloadBlob,
  ensureProjectShape,
  exportProjectPackage,
  exportStoryboardVideo,
  getClientId,
  getEpisodeDuration,
  getTimelineDuration,
  loadLocalProjects,
  makeEpisode,
  makeProject,
  makeScene,
  makeTimelineClip,
  postJson,
  saveLocalProjects,
  secondsLabel,
  serializeTimelineForRender,
  slugify
} from './lib';

const LOGO_URL = import.meta.env.VITE_LOGO_URL || 'https://cdn1.sharemyimage.com/2026/02/17/Logo-2-1.png';
const FOUNDER_LOGO_URL =
  import.meta.env.VITE_FOUNDER_LOGO_URL || 'https://cdn1.sharemyimage.com/2026/02/16/logo1_transparent.png';

const TABS = [
  { key: 'overview', label: 'Project Core' },
  { key: 'producer', label: 'Producer Brain' },
  { key: 'episodes', label: 'Episode Forge' },
  { key: 'assets', label: 'Assets + Transcript' },
  { key: 'storyboard', label: 'Storyboard + Voice' },
  { key: 'timeline', label: 'Timeline Forge' },
  { key: 'export', label: 'Export House' }
];

export default function App() {
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeEpisodeId, setActiveEpisodeId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [messageInput, setMessageInput] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('Booting studio…');
  const [bootDone, setBootDone] = useState(false);
  const [exportPreset, setExportPreset] = useState('youtube');
  const [renderProgress, setRenderProgress] = useState(0);
  const [serverSyncEnabled, setServerSyncEnabled] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState('');
  const [playheadSec, setPlayheadSec] = useState(0);
  const [youtubeReady, setYoutubeReady] = useState(false);

  useEffect(() => {
    const local = loadLocalProjects();
    const seeded = local.length ? local : [makeProject()];
    setProjects(seeded);
    setActiveProjectId(seeded[0]?.id || '');
    setActiveEpisodeId(seeded[0]?.episodes?.[0]?.id || '');

    fetch('/api/project-list', {
      headers: { 'x-skye-client-id': getClientId() }
    })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((json) => {
        if (!json?.projects?.length) return;
        setServerSyncEnabled(true);
        setProjects((current) => {
          const merged = mergeProjects(current, json.projects.map(ensureProjectShape));
          saveLocalProjects(merged);
          return merged;
        });
      })
      .catch(() => {
        /* local mode */
      });

    fetch('/api/youtube-config', { headers: { 'x-skye-client-id': getClientId() } })
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((json) => {
        if (json?.ready) setYoutubeReady(true);
      })
      .catch(() => {
        /* optional */
      });

    const timer = setTimeout(() => {
      setBootDone(true);
      setNotice('Studio live. Build something people can feel.');
    }, 1700);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!projects.length) return;
    saveLocalProjects(projects.map(ensureProjectShape));
  }, [projects]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || null,
    [projects, activeProjectId]
  );

  const activeEpisode = useMemo(() => {
    const fallback = activeProject?.episodes?.[0] || null;
    const found = activeProject?.episodes?.find((episode) => episode.id === activeEpisodeId) || fallback;
    return found ? ensureProjectShape({ ...activeProject, episodes: [found] }).episodes[0] : null;
  }, [activeProject, activeEpisodeId]);

  const activeTimeline = useMemo(() => activeEpisode?.timeline || null, [activeEpisode]);
  const timelineDuration = useMemo(() => (activeEpisode ? getEpisodeDuration(activeEpisode) : 1), [activeEpisode]);
  const activeTimelineTracks = activeTimeline?.tracks || [];

  const selectedClip = useMemo(() => {
    if (!selectedClipId || !activeTimeline) return null;
    for (const track of activeTimeline.tracks) {
      const clip = track.clips.find((item) => item.id === selectedClipId);
      if (clip) return { track, clip };
    }
    return null;
  }, [activeTimeline, selectedClipId]);

  const previewFrame = useMemo(() => {
    if (!activeProject || !activeEpisode || !activeTimeline) return null;
    const videoTracks = activeTimeline.tracks.filter((track) => track.type === 'video');
    const captionTracks = activeTimeline.tracks.filter((track) => track.type === 'caption');
    const activeVisual = [...videoTracks]
      .reverse()
      .flatMap((track) => track.clips)
      .filter((clip) => playheadSec >= clip.startSec && playheadSec <= clip.startSec + clip.durationSec)
      .sort((a, b) => b.startSec - a.startSec)[0];
    const activeCaption = captionTracks
      .flatMap((track) => track.clips)
      .filter((clip) => playheadSec >= clip.startSec && playheadSec <= clip.startSec + clip.durationSec)
      .sort((a, b) => a.startSec - b.startSec)[0];
    const scene = activeVisual?.sourceType === 'scene' ? activeEpisode.scenes.find((item) => item.id === activeVisual.sourceRef) : null;
    const asset = activeVisual?.sourceType === 'asset' ? activeProject.assets.find((item) => item.id === activeVisual.sourceRef) : null;
    return {
      visual: activeVisual,
      caption: activeCaption,
      scene,
      asset,
      imageUrl: activeVisual?.sourceUrl || scene?.imageUrl || (asset?.type?.startsWith('image/') ? asset.url : ''),
      videoUrl: activeVisual?.kind === 'video' ? activeVisual.sourceUrl || asset?.url || '' : ''
    };
  }, [activeProject, activeEpisode, activeTimeline, playheadSec]);

  useEffect(() => {
    if (!activeProject) return;
    if (!activeProject.episodes.some((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(activeProject.episodes[0]?.id || '');
    }
  }, [activeProject, activeEpisodeId]);

  useEffect(() => {
    setSelectedClipId('');
    setPlayheadSec(0);
  }, [activeEpisodeId]);

  function updateActiveProject(mutator) {
    setProjects((current) => {
      const updated = current.map((project) => {
        if (project.id !== activeProject.id) return project;
        const next = ensureProjectShape(structuredClone(project));
        mutator(next);
        next.updatedAt = new Date().toISOString();
        return next;
      });
      return updated;
    });
  }

  function updateActiveEpisode(mutator) {
    updateActiveProject((project) => {
      const episode = project.episodes.find((item) => item.id === activeEpisode.id);
      if (!episode) return;
      mutator(episode, project);
    });
  }

  async function syncProject(optionalProject = null) {
    const project = optionalProject || activeProject;
    if (!project) return;
    try {
      await postJson('/api/project-save', { project: ensureProjectShape(project) });
      setServerSyncEnabled(true);
      setNotice('Saved to your browser and the optional Neon lane.');
    } catch {
      setNotice('Saved locally. Neon lane is not wired yet in this environment.');
    }
  }

  function createProject() {
    const project = makeProject();
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setActiveEpisodeId(project.episodes[0]?.id || '');
    setActiveTab('overview');
    setNotice('New project forged.');
  }

  function duplicateEpisode() {
    if (!activeProject || !activeEpisode) return;
    const copy = structuredClone(activeEpisode);
    copy.id = `ep_${crypto.randomUUID()}`;
    copy.title = `${activeEpisode.title} Copy`;
    copy.scenes = copy.scenes.map((scene) => ({ ...scene, id: `scene_${crypto.randomUUID()}` }));
    copy.timeline.id = `timeline_${crypto.randomUUID()}`;
    copy.timeline.tracks = copy.timeline.tracks.map((track) => ({
      ...track,
      id: `track_${crypto.randomUUID()}`,
      clips: track.clips.map((clip) => ({ ...clip, id: `clip_${crypto.randomUUID()}` }))
    }));
    updateActiveProject((project) => {
      project.episodes.push(copy);
    });
    setActiveEpisodeId(copy.id);
    setNotice('Episode duplicated.');
  }

  async function sendProducerMessage() {
    if (!messageInput.trim() || !activeProject) return;
    const outgoing = {
      id: `msg_${crypto.randomUUID()}`,
      role: 'user',
      content: messageInput.trim()
    };
    updateActiveProject((project) => {
      project.chat.push(outgoing);
    });
    const payload = {
      project: activeProject,
      message: messageInput.trim(),
      episode: activeEpisode,
      mode: 'producer'
    };
    setMessageInput('');
    setBusy('producer');
    try {
      const data = await postJson('/api/chat-producer', payload);
      updateActiveProject((project) => {
        project.chat.push({
          id: `msg_${crypto.randomUUID()}`,
          role: 'assistant',
          content: data.reply || 'No reply returned.'
        });
      });
      setNotice('Producer brain delivered new direction.');
    } catch (error) {
      setNotice(error.message || 'Producer lane failed.');
    } finally {
      setBusy('');
    }
  }

  async function generateSeries() {
    if (!activeProject) return;
    setBusy('series');
    try {
      const data = await postJson('/api/generate-series', {
        goal: activeProject.goal,
        audience: activeProject.audience,
        tone: activeProject.tone,
        platforms: activeProject.platforms,
        seriesAngle: activeProject.seriesAngle
      });
      const episodes = (data.episodes || []).map((episode, index) => {
        const next = makeEpisode(index + 1);
        next.title = episode.title || `Episode ${index + 1}`;
        next.objective = episode.objective || '';
        next.hook = episode.hook || '';
        next.summary = episode.summary || '';
        next.thumbnailPrompt = episode.thumbnailPrompt || '';
        next.tags = episode.tags || [];
        next.scenes = (episode.scenes || []).length
          ? episode.scenes.map((scene, sceneIndex) => ({
              ...makeScene(sceneIndex + 1),
              title: scene.title || `Scene ${sceneIndex + 1}`,
              durationSec: Number(scene.durationSec) || 4,
              visualPrompt: scene.visualPrompt || '',
              narration: scene.narration || '',
              notes: scene.notes || ''
            }))
          : [makeScene(1), makeScene(2), makeScene(3)];
        next.timeline = buildTimelineFromScenes(next, activeProject);
        return next;
      });
      updateActiveProject((project) => {
        project.episodes = episodes.length ? episodes : [makeEpisode(1)];
        project.chat.push({
          id: `msg_${crypto.randomUUID()}`,
          role: 'assistant',
          content: data.summary || 'Series map generated.'
        });
      });
      setActiveEpisodeId(episodes[0]?.id || '');
      setActiveTab('episodes');
      setNotice('Series map generated.');
      await syncProject({ ...activeProject, episodes });
    } catch (error) {
      setNotice(error.message || 'Series generation failed.');
    } finally {
      setBusy('');
    }
  }

  async function generateEpisodePackage() {
    if (!activeProject || !activeEpisode) return;
    setBusy('episode');
    try {
      const data = await postJson('/api/generate-episode', {
        project: {
          title: activeProject.title,
          goal: activeProject.goal,
          audience: activeProject.audience,
          tone: activeProject.tone,
          platforms: activeProject.platforms,
          seriesAngle: activeProject.seriesAngle
        },
        episode: activeEpisode
      });
      updateActiveEpisode((episode) => {
        episode.objective = data.objective || episode.objective;
        episode.hook = data.hook || episode.hook;
        episode.summary = data.summary || episode.summary;
        episode.script = data.script || episode.script;
        episode.description = data.description || episode.description;
        episode.tags = data.tags || episode.tags;
        episode.youtube.tags = data.tags || episode.youtube.tags;
        episode.youtube.description = data.description || episode.youtube.description;
        episode.youtube.title = episode.youtube.title || episode.title;
        episode.thumbnailPrompt = data.thumbnailPrompt || episode.thumbnailPrompt;
        episode.shotList = data.shotList || episode.shotList;
        if (Array.isArray(data.scenes) && data.scenes.length) {
          episode.scenes = data.scenes.map((scene, index) => ({
            ...makeScene(index + 1),
            title: scene.title || `Scene ${index + 1}`,
            durationSec: Number(scene.durationSec) || 4,
            visualPrompt: scene.visualPrompt || '',
            narration: scene.narration || '',
            notes: scene.notes || ''
          }));
          episode.timeline = buildTimelineFromScenes(episode, activeProject);
        }
      });
      setActiveTab('storyboard');
      setNotice('Episode package built.');
      await syncProject();
    } catch (error) {
      setNotice(error.message || 'Episode generation failed.');
    } finally {
      setBusy('');
    }
  }

  async function generateSceneImage(scene) {
    if (!scene.visualPrompt) {
      setNotice('Give the scene a visual prompt first.');
      return;
    }
    setBusy(scene.id);
    try {
      const ratio = exportPreset === 'shorts' ? '1024x1536' : exportPreset === 'square' ? '1024x1024' : '1536x1024';
      const data = await postJson('/api/image-generate', {
        prompt: scene.visualPrompt,
        size: ratio
      });
      updateActiveEpisode((episode) => {
        const target = episode.scenes.find((item) => item.id === scene.id);
        if (target && data.imageBase64) {
          target.imageUrl = `data:${data.mimeType || 'image/png'};base64,${data.imageBase64}`;
        }
        episode.timeline = buildTimelineFromScenes(episode, activeProject);
      });
      setNotice('Scene visual generated.');
    } catch (error) {
      setNotice(error.message || 'Image generation failed.');
    } finally {
      setBusy('');
    }
  }

  async function generateSceneVoice(scene) {
    const text = scene.narration || scene.notes || scene.title;
    if (!text) {
      setNotice('Give the scene narration first.');
      return;
    }
    setBusy(`${scene.id}-voice`);
    try {
      const data = await postJson('/api/tts', {
        input: text,
        voice: 'coral',
        instructions: 'Speak like a smart cinematic teacher with confident pacing.'
      });
      updateActiveEpisode((episode) => {
        const target = episode.scenes.find((item) => item.id === scene.id);
        if (target && data.audioBase64) {
          target.audioUrl = `data:${data.mimeType || 'audio/mpeg'};base64,${data.audioBase64}`;
          target.audioMime = data.mimeType || 'audio/mpeg';
        }
      });
      updateActiveEpisode((episode) => {
        episode.timeline = buildTimelineFromScenes(episode, activeProject);
      });
      await enrichWaveforms();
      setNotice('Scene voiceover generated.');
    } catch (error) {
      setNotice(error.message || 'Voice generation failed.');
    } finally {
      setBusy('');
    }
  }

  async function generateAllSceneVoices() {
    if (!activeEpisode) return;
    for (const scene of activeEpisode.scenes) {
      // eslint-disable-next-line no-await-in-loop
      await generateSceneVoice(scene);
    }
  }

  async function handleAssetUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length || !activeProject) return;
    const prepared = await Promise.all(
      files.map(async (file) => {
        const isInline = (file.type.startsWith('image/') || file.type.startsWith('audio/') || file.type.startsWith('video/')) && file.size < 30_000_000;
        const url = isInline ? await toDataUrl(file) : URL.createObjectURL(file);
        const waveform = file.type.startsWith('audio/') ? await buildWaveformPeaksFromUrl(url).catch(() => []) : [];
        return {
          id: `asset_${crypto.randomUUID()}`,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          file,
          url,
          transcript: '',
          status: 'ready',
          waveform
        };
      })
    );
    updateActiveProject((project) => {
      project.assets.unshift(...prepared);
    });
    setNotice(`${prepared.length} asset${prepared.length === 1 ? '' : 's'} loaded into the vault.`);
  }

  async function transcribeAsset(asset) {
    if (!asset.file) {
      setNotice('This asset came from a prior session and no longer has raw file bytes attached. Upload it again for transcription.');
      return;
    }
    setBusy(asset.id);
    try {
      const formData = new FormData();
      formData.append('file', asset.file, asset.name);
      formData.append('language', 'en');
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'x-skye-client-id': getClientId() },
        body: formData
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      updateActiveProject((project) => {
        const target = project.assets.find((item) => item.id === asset.id);
        if (target) target.transcript = data.transcript || '';
      });
      setNotice('Transcript attached to asset.');
    } catch (error) {
      setNotice(error.message || 'Transcription failed.');
    } finally {
      setBusy('');
    }
  }

  function removeAsset(assetId) {
    updateActiveProject((project) => {
      project.assets = project.assets.filter((asset) => asset.id !== assetId);
    });
  }

  function rebuildTimelineFromCurrentScenes() {
    if (!activeEpisode) return;
    updateActiveEpisode((episode) => {
      episode.timeline = buildTimelineFromScenes(episode, activeProject);
    });
    setSelectedClipId('');
    setPlayheadSec(0);
    setNotice('Timeline rebuilt from scene order.');
  }

  async function enrichWaveforms() {
    if (!activeEpisode) return;
    setBusy('waveforms');
    try {
      const updates = [];
      for (const track of activeEpisode.timeline.tracks.filter((item) => item.type === 'audio')) {
        for (const clip of track.clips) {
          if (!clip.waveform?.length && clip.sourceUrl) {
            // eslint-disable-next-line no-await-in-loop
            const waveform = await buildWaveformPeaksFromUrl(clip.sourceUrl).catch(() => []);
            updates.push({ trackId: track.id, clipId: clip.id, waveform });
          }
        }
      }
      if (updates.length) {
        updateActiveEpisode((episode) => {
          updates.forEach((update) => {
            const track = episode.timeline.tracks.find((item) => item.id === update.trackId);
            const clip = track?.clips.find((item) => item.id === update.clipId);
            if (clip) clip.waveform = update.waveform;
          });
        });
        setNotice('Waveform lanes built.');
      } else {
        setNotice('Waveforms were already present.');
      }
    } finally {
      setBusy('');
    }
  }

  function addTrack(type) {
    if (!activeEpisode) return;
    updateActiveEpisode((episode) => {
      const count = episode.timeline.tracks.filter((track) => track.type === type).length + 1;
      episode.timeline.tracks.push({
        id: `track_${crypto.randomUUID()}`,
        title: `${capitalize(type)} ${count}`,
        type,
        clips: []
      });
    });
    setNotice(`${capitalize(type)} lane added.`);
  }

  async function addSceneClipToTimeline(scene, laneType) {
    if (!activeEpisode) return;
    const track = activeEpisode.timeline.tracks.find((item) => item.type === laneType);
    if (!track) {
      addTrack(laneType);
      return;
    }
    const startSec = getTimelineDuration(activeEpisode.timeline);
    const duration = Math.max(0.5, Number(scene.durationSec || 4));
    const clip = makeTimelineClip({
      label: laneType === 'audio' ? `${scene.title} Voice` : scene.title,
      kind: laneType === 'audio' ? 'audio' : scene.imageUrl ? 'image' : 'title',
      sourceType: 'scene',
      sourceRef: scene.id,
      sourceUrl: laneType === 'audio' ? scene.audioUrl : scene.imageUrl,
      mimeType: laneType === 'audio' ? scene.audioMime || 'audio/mpeg' : 'image/png',
      startSec,
      durationSec: duration,
      text: scene.narration || scene.title
    });
    if (laneType === 'audio' && clip.sourceUrl) {
      clip.waveform = await buildWaveformPeaksFromUrl(clip.sourceUrl).catch(() => []);
    }
    updateActiveEpisode((episode) => {
      const targetTrack = episode.timeline.tracks.find((item) => item.id === track.id);
      targetTrack?.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    setNotice(`${laneType === 'audio' ? 'Voice' : 'Scene'} clip dropped into ${track.title}.`);
  }

  async function addAssetClipToTimeline(asset) {
    if (!activeEpisode) return;
    const laneType = asset.type.startsWith('audio/') ? 'audio' : 'video';
    const track = activeEpisode.timeline.tracks.find((item) => item.type === laneType);
    if (!track) {
      addTrack(laneType);
      return;
    }
    const clip = makeTimelineClip({
      label: asset.name,
      kind: asset.type.startsWith('video/') ? 'video' : asset.type.startsWith('audio/') ? 'audio' : 'image',
      sourceType: 'asset',
      sourceRef: asset.id,
      sourceUrl: asset.url,
      mimeType: asset.type,
      startSec: getTimelineDuration(activeEpisode.timeline),
      durationSec: asset.type.startsWith('audio/') ? 6 : 5,
      waveform: asset.waveform || []
    });
    updateActiveEpisode((episode) => {
      const targetTrack = episode.timeline.tracks.find((item) => item.id === track.id);
      targetTrack?.clips.push(clip);
    });
    setSelectedClipId(clip.id);
    setNotice(`${asset.name} added to ${track.title}.`);
  }

  function updateClip(trackId, clipId, changes) {
    updateActiveEpisode((episode) => {
      const track = episode.timeline.tracks.find((item) => item.id === trackId);
      const clip = track?.clips.find((item) => item.id === clipId);
      if (!clip) return;
      Object.assign(clip, changes);
      if ('startSec' in changes) clip.startSec = Math.max(0, Number(clip.startSec || 0));
      if ('durationSec' in changes) clip.durationSec = Math.max(0.5, Number(clip.durationSec || 0.5));
      if ('trimStartSec' in changes) clip.trimStartSec = Math.max(0, Number(clip.trimStartSec || 0));
      if ('scale' in changes) clip.scale = Math.max(0.1, Number(clip.scale || 1));
      if ('opacity' in changes) clip.opacity = Math.min(1, Math.max(0.1, Number(clip.opacity || 1)));
      if ('volume' in changes) clip.volume = Math.min(2, Math.max(0, Number(clip.volume || 1)));
    });
  }

  function duplicateClip(trackId, clipId) {
    const found = selectedClip?.track.id === trackId && selectedClip.clip.id === clipId ? selectedClip : null;
    if (!found) return;
    const copy = structuredClone(found.clip);
    copy.id = `clip_${crypto.randomUUID()}`;
    copy.startSec = Number(copy.startSec || 0) + Number(copy.durationSec || 1);
    updateActiveEpisode((episode) => {
      const track = episode.timeline.tracks.find((item) => item.id === trackId);
      track?.clips.push(copy);
    });
    setSelectedClipId(copy.id);
    setNotice('Clip duplicated.');
  }

  function deleteClip(trackId, clipId) {
    updateActiveEpisode((episode) => {
      const track = episode.timeline.tracks.find((item) => item.id === trackId);
      if (track) track.clips = track.clips.filter((item) => item.id !== clipId);
    });
    if (selectedClipId === clipId) setSelectedClipId('');
    setNotice('Clip removed from timeline.');
  }

  function moveClipTrack(trackId, clipId, direction) {
    if (!activeTimeline) return;
    const currentIndex = activeTimeline.tracks.findIndex((item) => item.id === trackId);
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= activeTimeline.tracks.length) return;
    const targetTrack = activeTimeline.tracks[targetIndex];
    const sourceTrack = activeTimeline.tracks[currentIndex];
    const clip = sourceTrack.clips.find((item) => item.id === clipId);
    if (!clip || targetTrack.type !== sourceTrack.type) return;
    updateActiveEpisode((episode) => {
      const from = episode.timeline.tracks.find((item) => item.id === trackId);
      const to = episode.timeline.tracks.find((item) => item.id === targetTrack.id);
      const moving = from?.clips.find((item) => item.id === clipId);
      if (!moving || !from || !to) return;
      from.clips = from.clips.filter((item) => item.id !== clipId);
      to.clips.push(moving);
    });
    setNotice(`Clip moved to ${targetTrack.title}.`);
  }

  async function buildHydratedRenderPayload() {
    const payload = serializeTimelineForRender({ project: activeProject, episode: activeEpisode, presetKey: exportPreset });
    for (const track of payload.timeline.tracks) {
      for (const clip of track.clips) {
        if (String(clip.sourceUrl || '').startsWith('blob:') && clip.sourceType === 'asset') {
          const asset = activeProject.assets.find((item) => item.id === clip.sourceRef);
          if (!asset?.file) {
            throw new Error(`The asset "${clip.label}" only exists as a browser blob URL. Re-upload it in this session before FFmpeg render.`);
          }
          clip.sourceUrl = await toDataUrl(asset.file);
        }
      }
    }
    return payload;
  }

  async function renderStoryboardClient() {
    if (!activeProject || !activeEpisode) return;
    setBusy('render');
    setRenderProgress(0);
    try {
      await exportStoryboardVideo({
        project: activeProject,
        episode: activeEpisode,
        presetKey: exportPreset,
        onProgress: setRenderProgress
      });
      setNotice('Storyboard video exported from the browser preview lane.');
    } catch (error) {
      setNotice(error.message || 'Video export failed.');
    } finally {
      setBusy('');
      setRenderProgress(0);
    }
  }

  async function renderWithFfmpeg() {
    if (!activeProject || !activeEpisode) return;
    setBusy('ffmpeg');
    setRenderProgress(12);
    try {
      const payload = await buildHydratedRenderPayload();
      const data = await postJson('/api/render-ffmpeg', payload);
      updateActiveEpisode((episode) => {
        episode.lastRender = {
          base64: data.videoBase64,
          mimeType: data.mimeType || 'video/mp4',
          filename: data.filename || `${slugify(episode.title || 'episode')}.mp4`,
          renderedAt: new Date().toISOString(),
          presetKey: exportPreset,
          timelineDurationSec: timelineDuration,
          youtubePublished: null
        };
        episode.renderJobs.unshift({
          id: `job_${crypto.randomUUID()}`,
          type: 'ffmpeg',
          status: 'complete',
          createdAt: new Date().toISOString(),
          filename: data.filename || `${slugify(episode.title || 'episode')}.mp4`
        });
      });
      setRenderProgress(100);
      const blob = data.videoBase64 ? b64ToBlob(data.videoBase64, data.mimeType || 'video/mp4') : null;
      if (blob) downloadBlob(blob, data.filename || `${slugify(activeEpisode.title || 'episode')}.mp4`);
      setNotice('FFmpeg render completed. MP4 downloaded and cached for YouTube publish.');
    } catch (error) {
      setNotice(error.message || 'FFmpeg render failed.');
    } finally {
      setBusy('');
      setTimeout(() => setRenderProgress(0), 600);
    }
  }

  async function queueBackgroundRender() {
    if (!activeProject || !activeEpisode) return;
    setBusy('queue');
    try {
      const payload = await buildHydratedRenderPayload();
      const response = await fetch('/api/render-ffmpeg-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-skye-client-id': getClientId()
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok && response.status !== 202) {
        throw new Error(await response.text());
      }
      updateActiveEpisode((episode) => {
        episode.renderJobs.unshift({
          id: `job_${crypto.randomUUID()}`,
          type: 'ffmpeg-background',
          status: 'queued',
          createdAt: new Date().toISOString(),
          filename: `${slugify(episode.title || 'episode')}.mp4`
        });
      });
      setNotice('Background render queued. Wire callback storage to persist the finished file lane.');
    } catch (error) {
      setNotice(error.message || 'Background render queue failed.');
    } finally {
      setBusy('');
    }
  }

  function downloadLastRender() {
    if (!activeEpisode?.lastRender?.base64) return;
    const blob = b64ToBlob(activeEpisode.lastRender.base64, activeEpisode.lastRender.mimeType || 'video/mp4');
    downloadBlob(blob, activeEpisode.lastRender.filename || `${slugify(activeEpisode.title || 'episode')}.mp4`);
  }

  async function publishToYouTube() {
    if (!activeEpisode?.lastRender?.base64) {
      setNotice('Render an FFmpeg MP4 first so there is a real file to publish.');
      return;
    }
    setBusy('youtube');
    try {
      const data = await postJson('/api/youtube-publish', {
        base64: activeEpisode.lastRender.base64,
        mimeType: activeEpisode.lastRender.mimeType || 'video/mp4',
        filename: activeEpisode.lastRender.filename || `${slugify(activeEpisode.title || 'episode')}.mp4`,
        title: activeEpisode.youtube.title || activeEpisode.title,
        description: activeEpisode.youtube.description || activeEpisode.description || activeProject.goal,
        tags: activeEpisode.youtube.tags || activeEpisode.tags || [],
        privacyStatus: activeEpisode.youtube.privacyStatus || 'private'
      });
      updateActiveEpisode((episode) => {
        if (episode.lastRender) {
          episode.lastRender.youtubePublished = {
            videoId: data.videoId,
            url: data.url,
            publishedAt: new Date().toISOString()
          };
        }
      });
      setNotice(`Published to YouTube. Video ID: ${data.videoId}`);
    } catch (error) {
      setNotice(error.message || 'YouTube publish failed.');
    } finally {
      setBusy('');
    }
  }

  function exportScriptMarkdown() {
    if (!activeEpisode) return;
    const blob = new Blob([activeEpisode.script || ''], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, `${slugify(activeEpisode.title || 'episode')}.md`);
  }

  function exportSrt() {
    if (!activeEpisode) return;
    const blob = new Blob([buildEpisodeSrt(activeEpisode)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${slugify(activeEpisode.title || 'episode')}.srt`);
  }

  if (!activeProject) {
    return <div className="loading-shell">Booting creator studio…</div>;
  }

  return (
    <div className="app-shell">
      {!bootDone && <BootSequence notice={notice} />}
      <div className="shell-atmo" aria-hidden="true">
        <div className="atmo-grid" />
        <div className="atmo-orb orb-a" />
        <div className="atmo-orb orb-b" />
      </div>

      <header className="topbar glass">
        <div className="brand-lockup">
          <img src={LOGO_URL} alt="kAIxU" className="brand-logo main" />
          <div>
            <p className="eyebrow">Skyes Over London · Creator OS</p>
            <h1>SkyeDirector AI Studio</h1>
            <p className="topbar-sub">Real AI planning, voice, timeline lanes, waveform editing, FFmpeg MP4 render, and YouTube publish.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="gold-btn" onClick={createProject}>New Project</button>
          <button className="ghost-btn" onClick={() => syncProject()}>{serverSyncEnabled ? 'Save Project' : 'Save Local + Probe DB'}</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="sidebar glass">
          <div className="side-section">
            <p className="eyebrow">Projects</p>
            <div className="project-list">
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={`project-chip ${project.id === activeProject.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveProjectId(project.id);
                    setActiveEpisodeId(project.episodes[0]?.id || '');
                  }}
                >
                  <span>{project.title}</span>
                  <small>{new Date(project.updatedAt).toLocaleDateString()}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="side-section project-stats">
            <Metric label="Episodes" value={activeProject.episodes.length} />
            <Metric label="Assets" value={activeProject.assets.length} />
            <Metric label="Timeline" value={secondsLabel(timelineDuration)} />
            <Metric label="Client ID" value={getClientId().slice(-8)} />
          </div>

          <div className="side-section">
            <p className="eyebrow">Episodes</p>
            <div className="episode-list">
              {activeProject.episodes.map((episode, index) => (
                <button
                  key={episode.id}
                  className={`episode-pill ${episode.id === activeEpisode?.id ? 'active' : ''}`}
                  onClick={() => setActiveEpisodeId(episode.id)}
                >
                  <strong>{index + 1}. {episode.title}</strong>
                  <span>{getEpisodeDuration(episode)} sec</span>
                </button>
              ))}
            </div>
            <button
              className="ghost-btn full"
              onClick={() => {
                const next = makeEpisode(activeProject.episodes.length + 1);
                updateActiveProject((project) => {
                  project.episodes.push(next);
                });
                setActiveEpisodeId(next.id);
              }}
            >
              Add Episode
            </button>
            <button className="ghost-btn full" onClick={duplicateEpisode}>Duplicate Episode</button>
          </div>

          <div className="side-section founder-panel">
            <img src={FOUNDER_LOGO_URL} alt="Skyes Over London" className="brand-logo founder" />
            <p className="founder-copy">
              Built to fit your stack: branded shell, local-first workspace, Netlify function brain lane, optional Neon persistence,
              real timeline lanes, FFmpeg render path, and direct YouTube publishing from the cached MP4.
            </p>
          </div>
        </aside>

        <main className="main-stage">
          <div className="tabs glass">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`tab-btn ${tab.key === activeTab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-stage">
            {activeTab === 'overview' && (
              <section className="panel-grid">
                <section className="glass panel span-2">
                  <PanelHeader title="Project Core" subtitle="Set the mission, then let the producer brain and timeline lanes do violence to friction." />
                  <div className="form-grid two">
                    <label>
                      Project title
                      <input value={activeProject.title} onChange={(e) => updateActiveProject((project) => { project.title = e.target.value; })} />
                    </label>
                    <label>
                      Audience
                      <input value={activeProject.audience} onChange={(e) => updateActiveProject((project) => { project.audience = e.target.value; })} />
                    </label>
                    <label className="span-2">
                      Goal
                      <textarea rows="4" value={activeProject.goal} onChange={(e) => updateActiveProject((project) => { project.goal = e.target.value; })} />
                    </label>
                    <label>
                      Tone
                      <input value={activeProject.tone} onChange={(e) => updateActiveProject((project) => { project.tone = e.target.value; })} />
                    </label>
                    <label>
                      Series angle
                      <input value={activeProject.seriesAngle} onChange={(e) => updateActiveProject((project) => { project.seriesAngle = e.target.value; })} />
                    </label>
                  </div>
                  <div className="action-row wrap">
                    <button className="gold-btn" onClick={generateSeries} disabled={busy === 'series'}>{busy === 'series' ? 'Generating…' : 'Generate Series Map'}</button>
                    <button className="ghost-btn" onClick={rebuildTimelineFromCurrentScenes}>Rebuild Active Timeline</button>
                    <button className="ghost-btn" onClick={() => exportProjectPackage(activeProject, exportPreset)}>Export Full Package ZIP</button>
                  </div>
                </section>
                <section className="glass panel">
                  <PanelHeader title="What this upgraded build now does" subtitle="No hand-waving, just actual lanes." />
                  <ul className="capability-list compact">
                    <li>Multi-track timeline editing with separate video, audio, and caption lanes.</li>
                    <li>Waveform lanes for audio clips and generated scene voices.</li>
                    <li>FFmpeg MP4 rendering through a server function lane.</li>
                    <li>Background render queue entry point for longer jobs.</li>
                    <li>Direct YouTube upload from the last FFmpeg render when Google creds are wired.</li>
                  </ul>
                </section>
              </section>
            )}

            {activeTab === 'producer' && (
              <section className="panel-grid producer-layout">
                <section className="glass panel producer-chat-panel">
                  <PanelHeader title="Producer Brain" subtitle="Talk messy. Let the model turn that mess into a content machine." />
                  <div className="chat-log">
                    {activeProject.chat.map((message) => (
                      <article key={message.id} className={`chat-bubble ${message.role}`}>
                        <strong>{message.role === 'assistant' ? 'Producer' : 'You'}</strong>
                        <p>{message.content}</p>
                      </article>
                    ))}
                  </div>
                  <div className="composer-row">
                    <textarea rows="5" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} placeholder="Tell the producer what series you want, what the episode should teach, what footage you already have, or what feels weak." />
                    <button className="gold-btn" onClick={sendProducerMessage} disabled={busy === 'producer'}>{busy === 'producer' ? 'Thinking…' : 'Send to Producer'}</button>
                  </div>
                </section>
                <section className="glass panel">
                  <PanelHeader title="Command moves" subtitle="Useful big swings when you want the model to stop dithering." />
                  <div className="prompt-stack">
                    {[
                      'Build a 10-video AI education series for beginners that escalates cleanly.',
                      'Turn this active episode into a stronger teacher-led YouTube lesson with better hooks.',
                      'Make the episode more visual and add tighter short-form cutdown angles.',
                      'Rewrite this project for a founder audience who wants to understand AI without jargon.'
                    ].map((prompt) => (
                      <button key={prompt} className="ghost-btn text-left" onClick={() => setMessageInput(prompt)}>{prompt}</button>
                    ))}
                  </div>
                </section>
              </section>
            )}

            {activeTab === 'episodes' && activeEpisode && (
              <section className="panel-grid">
                <section className="glass panel span-2">
                  <PanelHeader title="Episode Forge" subtitle="Hook, objective, script, cutdown strategy, and publish metadata all in one place." />
                  <div className="form-grid two">
                    <label>
                      Episode title
                      <input value={activeEpisode.title} onChange={(e) => updateActiveEpisode((episode) => { episode.title = e.target.value; episode.youtube.title = e.target.value; })} />
                    </label>
                    <label>
                      Hook
                      <input value={activeEpisode.hook} onChange={(e) => updateActiveEpisode((episode) => { episode.hook = e.target.value; })} />
                    </label>
                    <label className="span-2">
                      Objective
                      <textarea rows="3" value={activeEpisode.objective} onChange={(e) => updateActiveEpisode((episode) => { episode.objective = e.target.value; })} />
                    </label>
                    <label className="span-2">
                      Summary
                      <textarea rows="4" value={activeEpisode.summary} onChange={(e) => updateActiveEpisode((episode) => { episode.summary = e.target.value; })} />
                    </label>
                    <label className="span-2">
                      Script
                      <textarea rows="14" value={activeEpisode.script} onChange={(e) => updateActiveEpisode((episode) => { episode.script = e.target.value; })} />
                    </label>
                    <label className="span-2">
                      Description
                      <textarea rows="6" value={activeEpisode.description} onChange={(e) => updateActiveEpisode((episode) => { episode.description = e.target.value; episode.youtube.description = e.target.value; })} />
                    </label>
                    <label>
                      Tags
                      <input value={(activeEpisode.tags || []).join(', ')} onChange={(e) => updateActiveEpisode((episode) => { episode.tags = e.target.value.split(',').map((value) => value.trim()).filter(Boolean); episode.youtube.tags = episode.tags; })} />
                    </label>
                    <label>
                      Thumbnail prompt
                      <input value={activeEpisode.thumbnailPrompt} onChange={(e) => updateActiveEpisode((episode) => { episode.thumbnailPrompt = e.target.value; })} />
                    </label>
                  </div>
                  <div className="action-row wrap">
                    <button className="gold-btn" onClick={generateEpisodePackage} disabled={busy === 'episode'}>{busy === 'episode' ? 'Building…' : 'Generate Episode Packet'}</button>
                    <button className="ghost-btn" onClick={exportScriptMarkdown}>Export Script Markdown</button>
                    <button className="ghost-btn" onClick={exportSrt}>Export Captions</button>
                  </div>
                </section>
                <section className="glass panel">
                  <PanelHeader title="Shot list" subtitle="One shot or beat per line." />
                  <textarea
                    rows="22"
                    value={(activeEpisode.shotList || []).join('\n')}
                    onChange={(e) => updateActiveEpisode((episode) => {
                      episode.shotList = e.target.value.split('\n').map((value) => value.trim()).filter(Boolean);
                    })}
                  />
                </section>
              </section>
            )}

            {activeTab === 'assets' && (
              <section className="panel-grid">
                <section className="glass panel span-2">
                  <PanelHeader title="Asset Vault" subtitle="Upload clips, voice memos, images, or screen captures. Then push them into the timeline lanes." />
                  <label className="upload-drop">
                    <input type="file" multiple onChange={handleAssetUpload} />
                    <span>Drop files or click to load media into the vault.</span>
                  </label>
                  <div className="asset-grid">
                    {activeProject.assets.map((asset) => (
                      <article key={asset.id} className="asset-card">
                        <div className="asset-head">
                          <strong>{asset.name}</strong>
                          <button className="tiny-btn" onClick={() => removeAsset(asset.id)}>Remove</button>
                        </div>
                        <p>{asset.type || 'Unknown'} · {Math.round((asset.size || 0) / 1024)} KB</p>
                        {asset.type?.startsWith('image/') && <img src={asset.url} alt={asset.name} className="asset-preview image" />}
                        {asset.type?.startsWith('audio/') && <audio controls src={asset.url} className="asset-preview" />}
                        {asset.type?.startsWith('video/') && <video controls src={asset.url} className="asset-preview" />}
                        {asset.waveform?.length ? <WaveformBars peaks={asset.waveform} /> : null}
                        <div className="action-row wrap">
                          <button className="ghost-btn" onClick={() => transcribeAsset(asset)} disabled={busy === asset.id}>{busy === asset.id ? 'Transcribing…' : 'Transcribe'}</button>
                          <button className="ghost-btn" onClick={() => addAssetClipToTimeline(asset)}>Add to timeline</button>
                        </div>
                        <textarea
                          rows="6"
                          value={asset.transcript || ''}
                          onChange={(e) => updateActiveProject((project) => {
                            const target = project.assets.find((item) => item.id === asset.id);
                            if (target) target.transcript = e.target.value;
                          })}
                          placeholder="Transcript lands here."
                        />
                      </article>
                    ))}
                    {!activeProject.assets.length && <EmptyState title="No assets yet" copy="Upload clips, screenshots, or voice memos. The transcription lane needs the original file bytes in the current session." />}
                  </div>
                </section>
                <section className="glass panel">
                  <PanelHeader title="Transcript stack" subtitle="Everything transcribed so far, ready to mine for hooks or captions." />
                  <textarea rows="20" value={activeProject.assets.map((asset) => `## ${asset.name}\n${asset.transcript || ''}`).join('\n\n')} readOnly />
                </section>
              </section>
            )}

            {activeTab === 'storyboard' && activeEpisode && (
              <section className="panel-grid">
                <section className="glass panel span-2">
                  <PanelHeader title="Storyboard + Voice" subtitle="Scene cards still matter because they become real clips, captions, and voice lanes." />
                  <div className="action-row wrap">
                    <button className="ghost-btn" onClick={() => updateActiveEpisode((episode) => { episode.scenes.push(makeScene(episode.scenes.length + 1)); })}>Add Scene</button>
                    <button className="ghost-btn" onClick={generateAllSceneVoices}>Generate Scene Voices</button>
                    <button className="ghost-btn" onClick={rebuildTimelineFromCurrentScenes}>Rebuild Timeline</button>
                    <button className="ghost-btn" onClick={exportSrt}>Export SRT</button>
                  </div>
                  <div className="scene-stack">
                    {activeEpisode.scenes.map((scene, index) => (
                      <article key={scene.id} className="scene-card">
                        <div className="scene-toolbar">
                          <strong>{index + 1}. {scene.title || `Scene ${index + 1}`}</strong>
                          <div className="mini-actions">
                            <button className="tiny-btn" onClick={() => moveScene(activeEpisode.id, scene.id, -1, updateActiveEpisode)}>↑</button>
                            <button className="tiny-btn" onClick={() => moveScene(activeEpisode.id, scene.id, 1, updateActiveEpisode)}>↓</button>
                            <button className="tiny-btn danger" onClick={() => updateActiveEpisode((episode) => { episode.scenes = episode.scenes.filter((item) => item.id !== scene.id); episode.timeline = buildTimelineFromScenes(episode, activeProject); })}>Delete</button>
                          </div>
                        </div>
                        <div className="form-grid two">
                          <label>
                            Scene title
                            <input value={scene.title} onChange={(e) => updateScene(activeEpisode.id, scene.id, 'title', e.target.value, updateActiveEpisode)} />
                          </label>
                          <label>
                            Duration (seconds)
                            <input type="number" min="1" max="60" value={scene.durationSec} onChange={(e) => updateScene(activeEpisode.id, scene.id, 'durationSec', Number(e.target.value), updateActiveEpisode)} />
                          </label>
                          <label className="span-2">
                            Visual prompt
                            <textarea rows="3" value={scene.visualPrompt} onChange={(e) => updateScene(activeEpisode.id, scene.id, 'visualPrompt', e.target.value, updateActiveEpisode)} />
                          </label>
                          <label className="span-2">
                            Narration
                            <textarea rows="3" value={scene.narration} onChange={(e) => updateScene(activeEpisode.id, scene.id, 'narration', e.target.value, updateActiveEpisode)} />
                          </label>
                          <label className="span-2">
                            Notes
                            <textarea rows="3" value={scene.notes} onChange={(e) => updateScene(activeEpisode.id, scene.id, 'notes', e.target.value, updateActiveEpisode)} />
                          </label>
                        </div>
                        <div className="action-row wrap">
                          <button className="gold-btn" onClick={() => generateSceneImage(scene)} disabled={busy === scene.id}>{busy === scene.id ? 'Generating image…' : 'Generate Visual'}</button>
                          <button className="ghost-btn" onClick={() => generateSceneVoice(scene)} disabled={busy === `${scene.id}-voice`}>{busy === `${scene.id}-voice` ? 'Generating voice…' : 'Generate Voice'}</button>
                          <button className="ghost-btn" onClick={() => addSceneClipToTimeline(scene, 'video')}>Drop into Video lane</button>
                          <button className="ghost-btn" onClick={() => addSceneClipToTimeline(scene, 'audio')}>Drop into Audio lane</button>
                        </div>
                        <div className="scene-preview-grid">
                          <div className="scene-preview-box">
                            {scene.imageUrl ? <img src={scene.imageUrl} alt={scene.title} className="scene-preview" /> : <div className="scene-placeholder">No scene visual yet</div>}
                          </div>
                          <div className="scene-preview-box">
                            {scene.audioUrl ? (
                              <>
                                <audio controls src={scene.audioUrl} className="asset-preview" />
                                <WaveformBars peaks={selectedClip?.clip.sourceRef === scene.id && selectedClip?.clip.waveform?.length ? selectedClip.clip.waveform : []} />
                              </>
                            ) : (
                              <div className="scene-placeholder">No voice yet</div>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="glass panel">
                  <PanelHeader title="Storyboard reel" subtitle="Fast visual output for previews and rough pitches." />
                  <label>
                    Output format
                    <select value={exportPreset} onChange={(e) => setExportPreset(e.target.value)}>
                      {Object.values(EXPORT_PRESETS).map((preset) => (
                        <option key={preset.key} value={preset.key}>{preset.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="preview-specs">
                    <Metric label="Scenes" value={activeEpisode.scenes.length} />
                    <Metric label="Approx sec" value={activeEpisode.scenes.reduce((sum, scene) => sum + Number(scene.durationSec || 0), 0)} />
                    <Metric label="Preset" value={EXPORT_PRESETS[exportPreset].label} />
                  </div>
                  <button className="gold-btn full" onClick={renderStoryboardClient} disabled={busy === 'render'}>
                    {busy === 'render' ? `Rendering ${renderProgress}%` : 'Export Storyboard Video'}
                  </button>
                  <p className="mini-note">This lane still renders a branded storyboard reel from the browser. The heavier MP4 lane now lives in Export House via FFmpeg.</p>
                </section>
              </section>
            )}

            {activeTab === 'timeline' && activeEpisode && activeTimeline && (
              <section className="panel-grid timeline-layout">
                <section className="glass panel span-2">
                  <PanelHeader title="Timeline Forge" subtitle="Multi-track editing, waveform lanes, clip timing, captions, and a playhead preview — the real editor lane starts here." />
                  <div className="action-row wrap">
                    <button className="gold-btn" onClick={rebuildTimelineFromCurrentScenes}>Rebuild from scenes</button>
                    <button className="ghost-btn" onClick={() => addTrack('video')}>Add video lane</button>
                    <button className="ghost-btn" onClick={() => addTrack('audio')}>Add audio lane</button>
                    <button className="ghost-btn" onClick={() => addTrack('caption')}>Add caption lane</button>
                    <button className="ghost-btn" onClick={enrichWaveforms} disabled={busy === 'waveforms'}>{busy === 'waveforms' ? 'Building waveforms…' : 'Refresh waveforms'}</button>
                  </div>
                  <div className="timeline-toolbar glass-subtle">
                    <label>
                      Zoom
                      <input type="range" min="28" max="140" value={activeTimeline.zoom} onChange={(e) => updateActiveEpisode((episode) => { episode.timeline.zoom = Number(e.target.value); })} />
                    </label>
                    <label>
                      Playhead
                      <input type="range" min="0" max={timelineDuration} step="0.1" value={playheadSec} onChange={(e) => setPlayheadSec(Number(e.target.value))} />
                    </label>
                    <Metric label="At" value={secondsLabel(playheadSec)} />
                    <Metric label="Total" value={secondsLabel(timelineDuration)} />
                  </div>
                  <div className="timeline-preview-panel">
                    <PreviewStage frame={previewFrame} title={activeProject.title} playheadSec={playheadSec} />
                  </div>
                  <div className="timeline-scroll">
                    <TimelineRuler durationSec={timelineDuration} pxPerSec={activeTimeline.zoom} />
                    {activeTimelineTracks.map((track, trackIndex) => (
                      <TrackLane
                        key={track.id}
                        track={track}
                        trackIndex={trackIndex}
                        durationSec={timelineDuration}
                        pxPerSec={activeTimeline.zoom}
                        selectedClipId={selectedClipId}
                        onSelectClip={setSelectedClipId}
                      />
                    ))}
                  </div>
                </section>
                <section className="glass panel timeline-side-panel">
                  <PanelHeader title="Clip inspector" subtitle="Use this on the selected clip. Brutally direct, like a proper control panel." />
                  {selectedClip ? (
                    <div className="clip-inspector">
                      <label>
                        Label
                        <input value={selectedClip.clip.label} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { label: e.target.value })} />
                      </label>
                      <label>
                        Start sec
                        <input type="number" step="0.1" value={selectedClip.clip.startSec} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { startSec: Number(e.target.value) })} />
                      </label>
                      <label>
                        Duration sec
                        <input type="number" step="0.1" min="0.5" value={selectedClip.clip.durationSec} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { durationSec: Number(e.target.value) })} />
                      </label>
                      <label>
                        Trim start
                        <input type="number" step="0.1" min="0" value={selectedClip.clip.trimStartSec} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { trimStartSec: Number(e.target.value) })} />
                      </label>
                      {selectedClip.track.type === 'audio' && (
                        <label>
                          Volume
                          <input type="number" step="0.1" min="0" max="2" value={selectedClip.clip.volume} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { volume: Number(e.target.value) })} />
                        </label>
                      )}
                      {selectedClip.track.type === 'video' && (
                        <>
                          <label>
                            Opacity
                            <input type="number" step="0.1" min="0.1" max="1" value={selectedClip.clip.opacity} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { opacity: Number(e.target.value) })} />
                          </label>
                          <label>
                            Scale
                            <input type="number" step="0.1" min="0.1" max="2" value={selectedClip.clip.scale} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { scale: Number(e.target.value) })} />
                          </label>
                        </>
                      )}
                      {selectedClip.track.type === 'caption' && (
                        <label>
                          Caption text
                          <textarea rows="4" value={selectedClip.clip.text || ''} onChange={(e) => updateClip(selectedClip.track.id, selectedClip.clip.id, { text: e.target.value })} />
                        </label>
                      )}
                      <div className="action-row wrap">
                        <button className="ghost-btn" onClick={() => updateClip(selectedClip.track.id, selectedClip.clip.id, { startSec: Math.max(0, selectedClip.clip.startSec - 0.5) })}>Nudge left</button>
                        <button className="ghost-btn" onClick={() => updateClip(selectedClip.track.id, selectedClip.clip.id, { startSec: selectedClip.clip.startSec + 0.5 })}>Nudge right</button>
                        <button className="ghost-btn" onClick={() => moveClipTrack(selectedClip.track.id, selectedClip.clip.id, -1)}>Move up lane</button>
                        <button className="ghost-btn" onClick={() => moveClipTrack(selectedClip.track.id, selectedClip.clip.id, 1)}>Move down lane</button>
                        <button className="ghost-btn" onClick={() => duplicateClip(selectedClip.track.id, selectedClip.clip.id)}>Duplicate clip</button>
                        <button className="tiny-btn danger" onClick={() => deleteClip(selectedClip.track.id, selectedClip.clip.id)}>Delete clip</button>
                      </div>
                      {selectedClip.clip.waveform?.length ? <WaveformBars peaks={selectedClip.clip.waveform} /> : null}
                    </div>
                  ) : (
                    <EmptyState title="No clip selected" copy="Click a block in the timeline to edit timing, trim, and lane behavior." />
                  )}
                  <div className="timeline-source-library">
                    <PanelHeader title="Quick-drop library" subtitle="Push scenes or assets straight into lanes." />
                    <div className="quick-drop-list">
                      {activeEpisode.scenes.map((scene) => (
                        <div key={scene.id} className="quick-drop-item">
                          <div>
                            <strong>{scene.title}</strong>
                            <small>{scene.durationSec}s</small>
                          </div>
                          <div className="mini-actions">
                            <button className="tiny-btn" onClick={() => addSceneClipToTimeline(scene, 'video')}>Video</button>
                            <button className="tiny-btn" onClick={() => addSceneClipToTimeline(scene, 'audio')}>Audio</button>
                          </div>
                        </div>
                      ))}
                      {activeProject.assets.map((asset) => (
                        <div key={asset.id} className="quick-drop-item">
                          <div>
                            <strong>{asset.name}</strong>
                            <small>{asset.type}</small>
                          </div>
                          <div className="mini-actions">
                            <button className="tiny-btn" onClick={() => addAssetClipToTimeline(asset)}>Add</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </section>
            )}

            {activeTab === 'export' && activeEpisode && (
              <section className="panel-grid">
                <section className="glass panel span-2">
                  <PanelHeader title="Export House" subtitle="Ship the package, the browser storyboard, the FFmpeg MP4, or publish the MP4 straight to YouTube." />
                  <div className="export-grid">
                    {Object.values(EXPORT_PRESETS).map((preset) => (
                      <button
                        key={preset.key}
                        className={`preset-card ${exportPreset === preset.key ? 'active' : ''}`}
                        onClick={() => setExportPreset(preset.key)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{preset.width} × {preset.height}</span>
                      </button>
                    ))}
                  </div>
                  <div className="action-row wrap">
                    <button className="gold-btn" onClick={renderWithFfmpeg} disabled={busy === 'ffmpeg'}>{busy === 'ffmpeg' ? `Rendering ${renderProgress || 28}%` : 'Render MP4 via FFmpeg'}</button>
                    <button className="ghost-btn" onClick={renderStoryboardClient} disabled={busy === 'render'}>{busy === 'render' ? `Rendering ${renderProgress}%` : 'Browser Storyboard Export'}</button>
                    <button className="ghost-btn" onClick={queueBackgroundRender} disabled={busy === 'queue'}>{busy === 'queue' ? 'Queueing…' : 'Queue Background Render'}</button>
                    <button className="ghost-btn" onClick={downloadLastRender} disabled={!activeEpisode.lastRender?.base64}>Download Last MP4</button>
                    <button className="ghost-btn" onClick={() => exportProjectPackage(activeProject, exportPreset)}>Export Full Package ZIP</button>
                    <button className="ghost-btn" onClick={exportScriptMarkdown}>Script Markdown</button>
                    <button className="ghost-btn" onClick={exportSrt}>Caption SRT</button>
                    <button className="ghost-btn" onClick={() => syncProject()}>Save Project</button>
                  </div>
                  <div className="summary-box">
                    <p><strong>Current episode:</strong> {activeEpisode.title}</p>
                    <p><strong>Timeline lanes:</strong> {activeEpisode.timeline.tracks.length}</p>
                    <p><strong>Timeline duration:</strong> {secondsLabel(timelineDuration)}</p>
                    <p><strong>Cached MP4:</strong> {activeEpisode.lastRender?.filename || 'Not rendered yet'}</p>
                  </div>
                </section>

                <section className="glass panel">
                  <PanelHeader title="YouTube publish" subtitle="This becomes active when Google refresh-token creds are wired in env vars." />
                  <div className={`status-pill ${youtubeReady ? 'ready' : 'offline'}`}>{youtubeReady ? 'YouTube lane configured' : 'YouTube lane not configured yet'}</div>
                  <label>
                    Title
                    <input value={activeEpisode.youtube.title || ''} onChange={(e) => updateActiveEpisode((episode) => { episode.youtube.title = e.target.value; })} />
                  </label>
                  <label>
                    Privacy
                    <select value={activeEpisode.youtube.privacyStatus || 'private'} onChange={(e) => updateActiveEpisode((episode) => { episode.youtube.privacyStatus = e.target.value; })}>
                      <option value="private">Private</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <label>
                    Tags
                    <input value={(activeEpisode.youtube.tags || []).join(', ')} onChange={(e) => updateActiveEpisode((episode) => { episode.youtube.tags = e.target.value.split(',').map((value) => value.trim()).filter(Boolean); })} />
                  </label>
                  <label>
                    Description
                    <textarea rows="7" value={activeEpisode.youtube.description || ''} onChange={(e) => updateActiveEpisode((episode) => { episode.youtube.description = e.target.value; })} />
                  </label>
                  <button className="gold-btn full" onClick={publishToYouTube} disabled={busy === 'youtube' || !activeEpisode.lastRender?.base64}>{busy === 'youtube' ? 'Publishing…' : 'Publish Last MP4 to YouTube'}</button>
                  {activeEpisode.lastRender?.youtubePublished?.url ? (
                    <p className="mini-note">Published URL: <a href={activeEpisode.lastRender.youtubePublished.url} target="_blank" rel="noreferrer">{activeEpisode.lastRender.youtubePublished.url}</a></p>
                  ) : null}
                </section>

                <section className="glass panel">
                  <PanelHeader title="Operator note" subtitle="Truth, not perfume." />
                  <ul className="capability-list compact">
                    <li>This version now has real multi-track timeline lanes.</li>
                    <li>Audio clips can carry waveform previews.</li>
                    <li>FFmpeg MP4 rendering exists as a real server-side lane for small to medium jobs.</li>
                    <li>Background render queue entry exists for longer jobs, but you still need storage/callback wiring for a fully automatic return path.</li>
                    <li>YouTube direct publish works when the Google OAuth env vars are present.</li>
                    <li>It is still not a full Adobe Premiere clone with keyframes, advanced transitions, grading, or team review comments. Those are the next monster lane.</li>
                  </ul>
                </section>
              </section>
            )}
          </div>
        </main>
      </div>

      <footer className="bottombar glass">
        <div>
          <strong>Status:</strong> {notice}
        </div>
        <div className="bottombar-right">
          <span>{serverSyncEnabled ? 'Neon lane reachable' : 'Local-first mode'}</span>
          <span>{youtubeReady ? 'YouTube ready' : 'YouTube env missing'}</span>
          <span>{busy ? `Busy: ${busy}` : 'Idle'}</span>
        </div>
      </footer>
    </div>
  );
}

function updateScene(activeEpisodeId, sceneId, field, value, updateActiveEpisode) {
  updateActiveEpisode((episode) => {
    const scene = episode.scenes.find((item) => item.id === sceneId);
    if (scene) scene[field] = value;
  });
}

function moveScene(activeEpisodeId, sceneId, direction, updateActiveEpisode) {
  updateActiveEpisode((episode) => {
    const index = episode.scenes.findIndex((item) => item.id === sceneId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= episode.scenes.length) return;
    [episode.scenes[index], episode.scenes[target]] = [episode.scenes[target], episode.scenes[index]];
    episode.timeline = buildTimelineFromScenes(episode);
  });
}

function mergeProjects(localProjects, remoteProjects) {
  const map = new Map();
  [...localProjects, ...remoteProjects].forEach((project) => {
    const clean = ensureProjectShape(project);
    const existing = map.get(clean.id);
    if (!existing || new Date(clean.updatedAt) > new Date(existing.updatedAt)) {
      map.set(clean.id, clean);
    }
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function b64ToBlob(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function BootSequence({ notice }) {
  return (
    <div className="boot-overlay">
      <div className="boot-grid" />
      <img src={LOGO_URL} alt="kAIxU" className="boot-logo" />
      <p className="eyebrow">Skyes Over London LC</p>
      <h2>s0l26-0s Creator Surface</h2>
      <p>{notice}</p>
    </div>
  );
}

function PanelHeader({ title, subtitle }) {
  return (
    <div className="panel-header">
      <div>
        <p className="eyebrow">Studio Lane</p>
        <h2>{title}</h2>
      </div>
      <p className="panel-subtitle">{subtitle}</p>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, copy }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function WaveformBars({ peaks }) {
  if (!peaks?.length) return null;
  return (
    <div className="waveform-bars" aria-hidden="true">
      {peaks.map((peak, index) => (
        <span key={`${index}_${peak}`} style={{ height: `${Math.max(10, peak * 100)}%` }} />
      ))}
    </div>
  );
}

function TimelineRuler({ durationSec, pxPerSec }) {
  const ticks = [];
  const total = Math.ceil(durationSec);
  for (let i = 0; i <= total; i += 1) {
    ticks.push(
      <div key={i} className="timeline-tick" style={{ left: i * pxPerSec }}>
        <span>{secondsLabel(i)}</span>
      </div>
    );
  }
  return <div className="timeline-ruler" style={{ width: Math.max(720, durationSec * pxPerSec + 120) }}>{ticks}</div>;
}

function TrackLane({ track, durationSec, pxPerSec, selectedClipId, onSelectClip }) {
  const laneWidth = Math.max(720, durationSec * pxPerSec + 120);
  return (
    <div className="track-lane-wrap">
      <div className="track-lane-head">
        <strong>{track.title}</strong>
        <span>{track.type}</span>
      </div>
      <div className={`track-lane ${track.type}`} style={{ width: laneWidth }}>
        {(track.clips || []).sort((a, b) => a.startSec - b.startSec).map((clip) => {
          const left = clip.startSec * pxPerSec;
          const width = Math.max(44, clip.durationSec * pxPerSec);
          return (
            <button
              key={clip.id}
              className={`timeline-clip ${track.type} ${selectedClipId === clip.id ? 'selected' : ''}`}
              style={{ left, width }}
              onClick={() => onSelectClip(clip.id)}
              title={`${clip.label} · ${secondsLabel(clip.startSec)} → ${secondsLabel(clip.startSec + clip.durationSec)}`}
            >
              <strong>{clip.label}</strong>
              <small>{secondsLabel(clip.startSec)} · {clip.durationSec.toFixed(1)}s</small>
              {track.type === 'audio' ? <WaveformBars peaks={clip.waveform || []} /> : null}
              {track.type === 'caption' ? <span className="clip-text-preview">{clip.text}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreviewStage({ frame, title, playheadSec }) {
  return (
    <div className="preview-stage-shell">
      <div className="preview-stage">
        {frame?.videoUrl ? (
          <video key={frame.videoUrl} src={frame.videoUrl} controls className="preview-video" />
        ) : frame?.imageUrl ? (
          <img src={frame.imageUrl} alt={frame.visual?.label || title} className="preview-image" />
        ) : (
          <div className="preview-fallback">No active visual at this playhead.</div>
        )}
        <div className="preview-overlay-top">{title}</div>
        {frame?.caption?.text ? <div className="preview-caption">{frame.caption.text}</div> : null}
      </div>
      <div className="preview-stage-meta">
        <strong>Playhead</strong>
        <span>{secondsLabel(playheadSec)}</span>
        <span>{frame?.visual?.label || 'No active clip'}</span>
      </div>
    </div>
  );
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}
