const introShell = document.getElementById('intro-shell');
const appShell = document.getElementById('app');
const stage1 = document.getElementById('cinematic-stage');
const stage2 = document.getElementById('post-intro-stage');
const subtitle = document.getElementById('subtitle');
const mainTitle = document.getElementById('main-title');
const logo1 = document.getElementById('company-logo');
const tagline = document.getElementById('tagline');
const architect = document.getElementById('architect-text');
const potential = document.getElementById('potential-text');
const logo2 = document.getElementById('kaixu-logo');
const skipBtn = document.getElementById('skip-btn');
const enterBtn = document.getElementById('enter-app');

const rainCanvas = document.getElementById('rain-layer');
const rainCtx = rainCanvas?.getContext('2d');
const lightCanvas = document.getElementById('lightning-layer');
const lightCtx = lightCanvas?.getContext('2d');
const lensCanvas = document.getElementById('lens-layer');
const lensCtx = lensCanvas?.getContext('2d');

let width = 0;
let height = 0;
let drops = [];
let skipped = false;
let revealTriggered = false;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function revealApp() {
  introShell?.remove();
  appShell?.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('skyetime:intro-finished'));
}

function resizeCanvases() {
  if (!rainCanvas || !lightCanvas || !lensCanvas) return;
  width = window.innerWidth;
  height = window.innerHeight;
  [rainCanvas, lightCanvas, lensCanvas].forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });
  initRain();
  drawLensDrops();
}

function drawLensDrops() {
  if (!lensCtx) return;
  lensCtx.clearRect(0, 0, width, height);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() * 34 + 8;
    const opacity = Math.random() * 0.14 + 0.04;
    const gradient = lensCtx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
    gradient.addColorStop(0.8, `rgba(190,210,255,${opacity * 0.45})`);
    gradient.addColorStop(1, 'transparent');
    lensCtx.fillStyle = gradient;
    lensCtx.beginPath();
    lensCtx.arc(x, y, r, 0, Math.PI * 2);
    lensCtx.fill();
  }
}

function initRain() {
  drops = [];
  const count = Math.max(220, Math.floor(width * 0.45));
  for (let i = 0; i < count; i++) {
    const z = Math.random();
    drops.push({
      x: Math.random() * width,
      y: Math.random() * height,
      z,
      len: (Math.random() * 28 + 12) * (z + 0.5),
      speed: (Math.random() * 18 + 12) * (z + 0.5),
      opacity: (Math.random() * 0.16 + 0.05) * (z + 0.5),
      wind: (Math.random() * 2 + 1)
    });
  }
}

function renderRain() {
  if (!rainCtx || reducedMotion) return;
  rainCtx.clearRect(0, 0, width, height);
  rainCtx.lineCap = 'round';
  for (const d of drops) {
    rainCtx.beginPath();
    rainCtx.moveTo(d.x, d.y);
    rainCtx.lineTo(d.x + d.wind, d.y + d.len);
    rainCtx.strokeStyle = `rgba(180,200,240,${d.opacity})`;
    rainCtx.lineWidth = d.z * 1.4 + 0.45;
    rainCtx.stroke();
    d.y += d.speed;
    d.x += d.wind;
    if (d.y > height) {
      d.y = -d.len;
      d.x = Math.random() * width;
    }
  }
  requestAnimationFrame(renderRain);
}

function drawLightningBranch(x1, y1, x2, y2, thickness, opacity) {
  if (!lightCtx) return;
  lightCtx.beginPath();
  lightCtx.moveTo(x1, y1);
  lightCtx.lineTo(x2, y2);
  lightCtx.lineWidth = thickness;
  lightCtx.strokeStyle = `rgba(230,240,255,${opacity})`;
  lightCtx.shadowBlur = thickness * 5;
  lightCtx.shadowColor = '#b456ff';
  lightCtx.stroke();
}

function createFractalBolt(startX, startY, endY, isMainBolt = true) {
  let currX = startX;
  let currY = startY;
  const segments = isMainBolt ? Math.floor(Math.random() * 10) + 15 : Math.floor(Math.random() * 5) + 5;
  const segmentLength = (endY - startY) / segments;
  let currentThickness = isMainBolt ? Math.random() * 3 + 3 : Math.random() * 1.5 + 0.6;
  let currentOpacity = isMainBolt ? 1 : 0.6;

  for (let i = 0; i < segments; i++) {
    const nextY = currY + segmentLength;
    const nextX = currX + (Math.random() - 0.5) * (isMainBolt ? 96 : 44);
    drawLightningBranch(currX, currY, nextX, nextY, currentThickness, currentOpacity);
    if (Math.random() > 0.72 && currentThickness > 1) {
      createFractalBolt(currX, currY, currY + (Math.random() * 180 + 90), false);
    }
    currX = nextX;
    currY = nextY;
    currentThickness *= 0.9;
    currentOpacity *= 0.96;
  }
}

function triggerStrike(intensity, massive = false) {
  if (!lightCtx || reducedMotion) return;
  lightCtx.clearRect(0, 0, width, height);
  lightCtx.fillStyle = `rgba(180,86,255,${intensity * 0.14})`;
  lightCtx.fillRect(0, 0, width, height);
  lightCtx.fillStyle = `rgba(255,255,255,${intensity * 0.26})`;
  lightCtx.fillRect(0, 0, width, height);
  const bolts = massive ? Math.floor(Math.random() * 3) + 2 : 1;
  for (let i = 0; i < bolts; i++) {
    createFractalBolt((Math.random() * 0.8 + 0.1) * width, -10, height * (Math.random() * 0.45 + 0.45), true);
  }
  setTimeout(() => {
    lightCtx.clearRect(0, 0, width, height);
    lightCtx.fillStyle = `rgba(180,86,255,${intensity * 0.05})`;
    lightCtx.fillRect(0, 0, width, height);
    setTimeout(() => lightCtx.clearRect(0, 0, width, height), 90);
  }, 55);
}

function switchToStageTwo() {
  if (revealTriggered) return;
  revealTriggered = true;
  skipped = true;
  stage1.style.transition = 'opacity 1.5s ease';
  stage1.style.opacity = '0';
  setTimeout(() => {
    stage1.style.display = 'none';
    stage2.classList.add('active');
    architect.classList.add('reveal-architect');
    potential.classList.add('reveal-potential');
    logo2.classList.add('reveal-kaixu');
    setTimeout(() => {
      if (enterBtn) enterBtn.focus();
    }, 1600);
  }, 1400);
}

function runTimeline() {
  if (reducedMotion) {
    stage1.style.display = 'none';
    stage2.classList.add('active');
    architect.style.opacity = '1';
    potential.style.opacity = '1';
    logo2.style.opacity = '1';
    skipBtn.style.display = 'none';
    return;
  }

  setTimeout(() => { skipBtn.style.opacity = '0.65'; }, 1800);
  setTimeout(() => triggerStrike(0.35, false), 400);
  setTimeout(() => subtitle.classList.add('reveal-subtitle'), 900);
  setTimeout(() => subtitle.classList.replace('reveal-subtitle', 'hide-subtitle'), 3600);
  setTimeout(() => {
    triggerStrike(1, true);
    mainTitle.classList.add('reveal-title');
    logo1.classList.add('reveal-logo');
    tagline.classList.add('reveal-tagline');
    setTimeout(() => triggerStrike(0.5, true), 150);
  }, 4700);
  setTimeout(() => triggerStrike(0.35, false), 8500);
  setTimeout(() => {
    if (!skipped) switchToStageTwo();
  }, 10800);
}

window.addEventListener('resize', resizeCanvases);
resizeCanvases();
renderRain();
setTimeout(runTimeline, 250);

skipBtn?.addEventListener('click', switchToStageTwo);
enterBtn?.addEventListener('click', revealApp);
