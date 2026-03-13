
(function(){
  const existing = document.getElementById('skyeloop-bg-canvas');
  if (existing) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'skyeloop-bg-canvas';
  canvas.className = 'skyeloop-bg-canvas';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0;
  const particles = Array.from({length: 90}, () => ({
    x: Math.random(),
    y: Math.random(),
    z: Math.random(),
    s: Math.random() * 0.7 + 0.3
  }));

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function neonLine(points, color, glow, width){
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for(let i=1;i<points.length;i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function gridPlane(offsetY, direction, color, glow, t){
    const horizon = h * 0.5 + offsetY * 0.01;
    const vanishX = w * 0.5;
    const depthLines = 14;
    const span = Math.max(w, h) * 1.2;
    const speed = 0.55;
    for(let i=0;i<depthLines;i++){
      const z = ((i / depthLines) + (t * speed % 1)) % 1;
      const spread = Math.pow(z, 1.85);
      const y = direction > 0 ? horizon + spread * h * 0.58 : horizon - spread * h * 0.58;
      const alpha = 0.03 + spread * 0.22;
      neonLine([[vanishX - span * spread, y],[vanishX + span * spread, y]], `rgba(${color},${alpha})`, `rgba(${glow},${0.4 + spread * 0.4})`, 1.15);
    }
    const columns = 16;
    for(let i=-columns;i<=columns;i++){
      const ratio = i / columns;
      const x1 = vanishX + ratio * span;
      const x2 = vanishX + ratio * span * 0.04;
      const y2 = horizon;
      const y1 = direction > 0 ? h + 120 : -120;
      neonLine([[x1, y1],[x2, y2]], `rgba(${color},0.16)`, `rgba(${glow},0.45)`, 1);
    }
  }

  function drawLogoHalo(t){
    const cx = w * 0.5;
    const cy = h * 0.29 + Math.sin(t * 1.4) * 6;
    const pulse = 1 + Math.sin(t * 3.8) * 0.03;
    const rx = Math.min(260, w * 0.16) * pulse;
    const ry = rx * 0.58;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * 1.8);
    grad.addColorStop(0, 'rgba(255,215,0,0.18)');
    grad.addColorStop(0.35, 'rgba(255,215,0,0.08)');
    grad.addColorStop(0.7, 'rgba(162,0,255,0.07)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.7, ry * 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawParticles(t){
    for (const p of particles){
      p.z += 0.0015 * p.s;
      if (p.z > 1) { p.z = 0; p.x = Math.random(); p.y = Math.random(); }
      const px = (p.x - 0.5) * w * (0.15 + p.z * 1.35) + w * 0.5;
      const py = (p.y - 0.5) * h * (0.1 + p.z * 1.15) + h * 0.5;
      const r = 0.4 + p.z * 1.8 * p.s;
      ctx.fillStyle = p.z > 0.6 ? 'rgba(255,0,170,0.8)' : 'rgba(162,0,255,0.55)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI*2);
      ctx.fill();
    }
  }

  function frame(ts){
    const t = ts * 0.001;
    ctx.clearRect(0,0,w,h);
    const bg = ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,'rgba(5,0,17,0.92)');
    bg.addColorStop(0.45,'rgba(9,4,24,0.80)');
    bg.addColorStop(1,'rgba(3,4,7,0.98)');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,w,h);

    const fog1 = ctx.createRadialGradient(w*0.25,h*0.15,0,w*0.25,h*0.15,w*0.5);
    fog1.addColorStop(0,'rgba(162,0,255,0.16)');
    fog1.addColorStop(1,'rgba(162,0,255,0)');
    ctx.fillStyle = fog1; ctx.fillRect(0,0,w,h);

    const fog2 = ctx.createRadialGradient(w*0.8,h*0.18,0,w*0.8,h*0.18,w*0.46);
    fog2.addColorStop(0,'rgba(255,215,0,0.10)');
    fog2.addColorStop(1,'rgba(255,215,0,0)');
    ctx.fillStyle = fog2; ctx.fillRect(0,0,w,h);

    gridPlane(h * 0.06, 1, '162,0,255', '162,0,255', t);
    gridPlane(-h * 0.04, -1, '255,0,170', '255,0,170', t * 0.85);
    drawParticles(t);
    drawLogoHalo(t);

    const vignette = ctx.createRadialGradient(w*0.5,h*0.45,Math.min(w,h)*0.12,w*0.5,h*0.45,Math.max(w,h)*0.82);
    vignette.addColorStop(0,'rgba(0,0,0,0)');
    vignette.addColorStop(1,'rgba(0,0,0,0.62)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0,0,w,h);

    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize, {passive:true});
  raf = requestAnimationFrame(frame);
})();
