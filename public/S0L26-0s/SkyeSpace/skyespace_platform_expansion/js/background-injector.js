
(function(){
  const mount = document.getElementById('background-mount');
  if(!mount) return;

  mount.innerHTML = '';
  const wash = document.createElement('div');
  wash.style.position = 'absolute';
  wash.style.inset = '0';
  wash.style.background = [
    'radial-gradient(circle at 18% 20%, rgba(103,216,255,.14), transparent 22%)',
    'radial-gradient(circle at 82% 18%, rgba(245,201,122,.12), transparent 18%)',
    'radial-gradient(circle at 76% 80%, rgba(159,104,255,.16), transparent 24%)',
    'radial-gradient(circle at 24% 82%, rgba(255,122,184,.10), transparent 24%)',
    'linear-gradient(180deg, #04050a 0%, #070912 42%, #04050a 100%)'
  ].join(',');
  mount.appendChild(wash);

  const grid = document.createElement('div');
  grid.style.position = 'absolute';
  grid.style.inset = '0';
  grid.style.backgroundImage = 'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)';
  grid.style.backgroundSize = '80px 80px';
  grid.style.maskImage = 'radial-gradient(circle at center, black 35%, transparent 82%)';
  grid.style.opacity = '.14';
  mount.appendChild(grid);

  const veil = document.createElement('div');
  veil.style.position = 'absolute';
  veil.style.inset = '0';
  veil.style.background = 'linear-gradient(180deg, rgba(2,4,10,.18), transparent 22%, rgba(2,4,10,.22) 100%)';
  mount.appendChild(veil);

  function fallback(){
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    mount.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const pointer = { x: 0, y: 0 };
    let stars = [];

    function resize(){
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stars = Array.from({length: Math.max(140, Math.floor((canvas.width * canvas.height) / 12000))}, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 1.2 + .2,
        size: Math.random() * 2.4 + .4,
        speed: Math.random() * .28 + .06
      }));
    }

    function tick(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      const gx = canvas.width * .5 + pointer.x * 40;
      const gy = canvas.height * .5 + pointer.y * 30;
      stars.forEach((s, i) => {
        ctx.beginPath();
        const hue = i % 5 === 0 ? '245,201,122' : i % 7 === 0 ? '159,104,255' : '103,216,255';
        ctx.fillStyle = `rgba(${hue},${0.35 + s.z * 0.4})`;
        ctx.arc(s.x, s.y, s.size * s.z, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.speed * s.z;
        s.x += Math.sin((s.y + i) * 0.003) * 0.12;
        if(s.y > canvas.height + 20){ s.y = -20; s.x = Math.random() * canvas.width; }
      });
      ctx.beginPath();
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.min(canvas.width, canvas.height) * 0.28);
      grad.addColorStop(0, 'rgba(255,255,255,.06)');
      grad.addColorStop(.35, 'rgba(103,216,255,.08)');
      grad.addColorStop(.6, 'rgba(159,104,255,.06)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,canvas.width,canvas.height);
      requestAnimationFrame(tick);
    }
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth - .5) * 2;
      pointer.y = (e.clientY / window.innerHeight - .5) * 2;
    }, { passive: true });
    window.addEventListener('resize', resize);
    resize();
    tick();
  }

  function initThree(){
    if(!window.THREE){ fallback(); return; }
    const THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.opacity = '.96';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 62);

    const group = new THREE.Group();
    scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);

    const dir1 = new THREE.PointLight(0x67d8ff, 4.2, 260, 2);
    dir1.position.set(24, 12, 34);
    scene.add(dir1);
    const dir2 = new THREE.PointLight(0x9f68ff, 4.8, 260, 2);
    dir2.position.set(-26, -10, 28);
    scene.add(dir2);
    const dir3 = new THREE.PointLight(0xf5c97a, 3.8, 280, 2);
    dir3.position.set(0, 22, 42);
    scene.add(dir3);

    const knotMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      emissive: 0x3f2e74,
      emissiveIntensity: 1.3,
      metalness: 0.82,
      roughness: 0.18,
      transparent: true,
      opacity: 0.88,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
      wireframe: false
    });
    const knotGeo = new THREE.TorusKnotGeometry(11, 2.6, 220, 28, 2, 5);
    const knot = new THREE.Mesh(knotGeo, knotMaterial);
    knot.rotation.x = 0.75;
    knot.rotation.z = 0.18;
    group.add(knot);

    const ringMat1 = new THREE.MeshBasicMaterial({ color: 0x67d8ff, transparent: true, opacity: 0.16, wireframe: true });
    const ringMat2 = new THREE.MeshBasicMaterial({ color: 0xf5c97a, transparent: true, opacity: 0.12, wireframe: true });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(23, 0.55, 20, 120), ringMat1);
    ring1.rotation.x = 1.15;
    ring1.rotation.y = 0.18;
    group.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(31, 0.4, 18, 120), ringMat2);
    ring2.rotation.x = 0.42;
    ring2.rotation.y = -0.34;
    group.add(ring2);

    const shardGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const shardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x5131a4, emissiveIntensity: 1.2, metalness: 0.7, roughness: 0.15, transparent: true, opacity: 0.82 });
    const shards = new THREE.Group();
    for(let i = 0; i < 44; i++){
      const m = new THREE.Mesh(shardGeo, shardMat.clone());
      const radius = 22 + Math.random() * 18;
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI * 2;
      m.position.set(
        Math.cos(a) * radius,
        Math.sin(b) * radius * 0.46,
        Math.sin(a) * radius * 0.78
      );
      const s = Math.random() * 1.9 + 0.55;
      m.scale.setScalar(s);
      m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      m.userData = { spinX: (Math.random() - .5) * 0.01, spinY: (Math.random() - .5) * 0.012, orbit: a, height: m.position.y, speed: Math.random() * 0.003 + 0.0008, radius };
      shards.add(m);
    }
    scene.add(shards);

    const starCount = 2600;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const radii = [];
    const palette = [new THREE.Color(0x67d8ff), new THREE.Color(0x9f68ff), new THREE.Color(0xf5c97a), new THREE.Color(0xffffff), new THREE.Color(0xff7ab8)];
    for(let i = 0; i < starCount; i++){
      const radius = 26 + Math.random() * 110;
      const angle = Math.random() * Math.PI * 2;
      const spread = (Math.random() - .5) * 26;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = spread;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      const c = palette[i % palette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      radii.push(radius);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const particleMat = new THREE.PointsMaterial({ size: 0.72, transparent: true, opacity: 0.92, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    const pointer = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    function resize(){
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    function tick(){
      const t = clock.getElapsedTime();
      knot.rotation.x = 0.72 + t * 0.12;
      knot.rotation.y = t * 0.18;
      knot.rotation.z = 0.18 + t * 0.08;
      ring1.rotation.z = t * 0.09;
      ring2.rotation.z = -t * 0.06;
      group.rotation.y += (pointer.x * 0.28 - group.rotation.y) * 0.02;
      group.rotation.x += (-pointer.y * 0.18 - group.rotation.x) * 0.02;
      camera.position.x += (pointer.x * 6 - camera.position.x) * 0.02;
      camera.position.y += (-pointer.y * 4 - camera.position.y) * 0.02;
      camera.lookAt(0,0,0);

      shards.children.forEach((m, i) => {
        m.rotation.x += m.userData.spinX;
        m.rotation.y += m.userData.spinY;
        m.userData.orbit += m.userData.speed;
        m.position.x = Math.cos(m.userData.orbit + i * 0.02) * m.userData.radius;
        m.position.z = Math.sin(m.userData.orbit + i * 0.02) * m.userData.radius * 0.84;
        m.position.y = m.userData.height + Math.sin(t * 0.6 + i) * 0.85;
      });

      particles.rotation.y = t * 0.02;
      particles.rotation.x = Math.sin(t * 0.1) * 0.05;
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();
  }

  if(window.THREE){
    initThree();
  } else {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js';
    script.onload = initThree;
    script.onerror = fallback;
    document.head.appendChild(script);
  }
})();
