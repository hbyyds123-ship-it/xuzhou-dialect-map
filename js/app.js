/* ==========================================================
   《乡音册》— 徐州方言数字地图
   3D 地图 / 浮动图标 / 搜索 / 图鉴 / 方言挑战
   ========================================================== */
(function () {
  'use strict';

  /* ---------------------- 常量 ---------------------- */
  const DEPTH = 5.2;
  const SCALE = 55;
  const BBOX = window.XZ_GEO.bbox;
  const CX = (BBOX[0] + BBOX[2]) / 2;
  const CY = (BBOX[1] + BBOX[3]) / 2;
  const KX = Math.cos(CY * Math.PI / 180) * SCALE;

  const CAT_COLOR = {
    '曲艺': '#8C6A3F', '戏曲': '#A63B2A', '文献': '#3F5A6B',
    '研究': '#5E5470', '发音人': '#4B6B57', '活动': '#8A5A63', '方言词': '#6B655B'
  };
  const CAT_ICON = {
    '曲艺': '<path d="M9 17.5V6.2l9-1.7v11.3"/><circle cx="6.6" cy="17.8" r="2.4"/><circle cx="15.6" cy="16" r="2.4"/>',
    '戏曲': '<path d="M12 3.2c4.4 0 7.9 2.7 7.9 6.4 0 2.3-1.5 3.5-3.1 4.3"/><path d="M12 3.2C7.6 3.2 4.1 5.9 4.1 9.6c0 2.3 1.5 3.5 3.1 4.3"/><path d="M9 13.4c0 3 1.3 5.9 3 7.8 1.7-1.9 3-4.8 3-7.8"/>',
    '文献': '<path d="M5.4 4.2h8.4a2 2 0 0 1 2 2v13.6H7.4a2 2 0 0 1-2-2z"/><path d="M5.4 17.6a2 2 0 0 1 2-2h8.4"/><path d="M8.6 8h4.4"/>',
    '研究': '<path d="M3 16.6l4.1-6 3 3 3.9-6.8 3 4.1 3.4-2.4"/><circle cx="3" cy="16.6" r="1.1"/><circle cx="20.4" cy="8.5" r="1.1"/>',
    '发音人': '<rect x="9.2" y="3" width="5.6" height="10.6" rx="2.8"/><path d="M5.4 11.2a6.6 6.6 0 0 0 13.2 0"/><path d="M12 17.8v3.2"/>',
    '活动': '<path d="M12 3.4l2.1 5 5.4.5-4 3.7 1.1 5.3L12 15.2l-4.6 2.7 1.1-5.3-4-3.7 5.4-.5z"/>',
    '方言词': '<path d="M4.2 5h15.6v10.4H9.4L4.2 19z"/>'
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* ---------------------- 数据与状态（统一真源） ----------------------
     所有渲染只读 data/atlas.js + core/store.js 的派生结果，
     本文件不再持有第二份状态。
     ------------------------------------------------------------------ */
  const ATLAS = window.ATLAS;
  const STORE = window.XZ.store;
  const ACT = window.XZ.actions;
  const SEL = window.XZ.selectors;
  const ROUTER = window.XZ.router;

  /* 把统一 JSON 摊平成渲染层熟悉的字段，避免模板大改 */
  const SPOTS = ATLAS.spots.map(function (s) {
    const d = SEL.district(s.districtId);
    const w = s.wordIds.length ? SEL.word(s.wordIds[0]) : null;
    const cat = ATLAS.spotCategories[s.category] || { label: '方言词' };
    const link = (s.links && s.links[0]) || { url: '', label: '' };
    return {
      id: s.id, name: s.name, districtId: s.districtId, district: d ? d.name : '',
      category: cat.label, categoryKey: s.category,
      lnglat: s.lnglat, thumb: s.thumb, tag: s.tag, desc: s.desc,
      wordIds: s.wordIds,
      word: w ? w.w : '', meaning: w ? w.meaning : '', py: w ? w.py : '',
      link: link.url, linkLabel: link.label
    };
  });

  const DISTRICTS = ATLAS.districts;
  const SCENES = ATLAS.scenes || [];

  const WORDS = ATLAS.words.map(function (w) {
    const d = SEL.district(w.districtId);
    return {
      id: w.id, w: w.w, p: w.py, m: w.meaning, e: w.example,
      d: d ? d.name : '', cat: w.cat, difficulty: w.difficulty, levelId: w.levelId
    };
  });

  const LEVELS = ATLAS.tiers;

  /* 旧代码用 explored.has/add/size，这里桥接到 store */
  const explored = {
    has: function (id) { return SEL.isSpotExplored(id); },
    add: function (id) { ACT.exploreSpot(id); return this; },
    get size() { return SEL.exploredCount(); }
  };

  const spotById = {};
  SPOTS.forEach(s => { spotById[s.id] = s; });
  const districtByName = {};
  DISTRICTS.forEach(d => { districtByName[d.name] = d; });

  /* ---------------------- 投影 ---------------------- */
  function proj(ll) {
    return [(ll[0] - CX) * KX, (ll[1] - CY) * SCALE];
  }
  function toWorld(ll, y) {
    const p = proj(ll);
    return new THREE.Vector3(p[0], y || 0, -p[1]);
  }

  /* ---------------------- 场景 ---------------------- */
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xEFE7D6, 0.0019);

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 1400);
  const HOME = { dist: 112, phi: 0.82, theta: 0 };
  camera.position.copy(new THREE.Vector3().setFromSpherical(
    new THREE.Spherical(178, 0.58, -0.55)
  ));

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.62;
  controls.zoomSpeed = 0.72;
  controls.minDistance = 48;
  controls.maxDistance = 280;
  controls.minPolarAngle = 0.14;
  controls.maxPolarAngle = Math.PI * 0.455;

  /* 灯光 */
  scene.add(new THREE.AmbientLight(0xFFF6E6, 0.46));
  const key = new THREE.DirectionalLight(0xFFFBF0, 0.92);
  key.position.set(70, 130, 90); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9AA3A0, 0.30);
  rim.position.set(-110, 55, -95); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xC8B79A, 0.22);
  fill.position.set(20, 40, -120); scene.add(fill);
  const core = new THREE.PointLight(0xFFF1D6, 0.22, 320);
  core.position.set(0, 46, 0); scene.add(core);

  /* 纸本皮肤：原来的"地面辉光"（青色光晕 + 极坐标环）与星尘已移除。
     它们模拟的是屏幕光，在纸面上会变成一块发白的板子（实测过）。
     现在靠 body::after 的一层纸面投影把地形"按"在纸上，见 css/paper.css。 */

  /* ---------------------- 地图 ---------------------- */
  const mapGroup = new THREE.Group();
  scene.add(mapGroup);

  const TOP_COLORS = ['#B5A78C', '#AFA186', '#B9AB90', '#B2A487', '#B7A98E',
    '#AC9E83', '#B8AA8F', '#B1A386', '#B6A88D', '#B0A285'];

  const districtMeshes = [];
  const districtMap = {};

  window.XZ_GEO.districts.forEach((gd, idx) => {
    const geoDist = gd;
    const meta = districtByName[gd.name] || { name: gd.name, intro: '', type: '' };

    const shapes = [];
    geoDist.polys.forEach(poly => {
      const outer = poly[0].map(p => { const q = proj(p); return new THREE.Vector2(q[0], q[1]); });
      if (outer.length < 3) return;
      const shape = new THREE.Shape(outer);
      for (let i = 1; i < poly.length; i++) {
        const hp = poly[i].map(p => { const q = proj(p); return new THREE.Vector2(q[0], q[1]); });
        if (hp.length >= 3) shape.holes.push(new THREE.Path(hp));
      }
      shapes.push(shape);
    });
    if (!shapes.length) return;

    const extrude = new THREE.ExtrudeGeometry(shapes, {
      depth: DEPTH, bevelEnabled: true,
      bevelThickness: 0.30, bevelSize: 0.30, bevelSegments: 1, curveSegments: 1
    });

    const capMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(TOP_COLORS[idx % TOP_COLORS.length]),
      roughness: 0.68, metalness: 0.32,
      emissive: new THREE.Color(0x000000), emissiveIntensity: 1
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#B9AE99'), roughness: 0.95, metalness: 0.02,
      emissive: new THREE.Color(0x000000)
    });

    const mesh = new THREE.Mesh(extrude, [capMat, sideMat]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.district = gd.name;
    mapGroup.add(mesh);

    // 顶面描边
    const lineGroup = new THREE.Group();
    geoDist.polys.forEach(poly => {
      poly.forEach(ring => {
        const pts = ring.map(p => {
          const q = proj(p);
          return new THREE.Vector3(q[0], DEPTH + 0.02, -q[1]);
        });
        pts.push(pts[0].clone());
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(lg, new THREE.LineBasicMaterial({
          color: 0x6B655B, transparent: true, opacity: 0.30, depthWrite: false
        }));
        lineGroup.add(line);
      });
    });
    mapGroup.add(lineGroup);

    const rec = {
      name: gd.name, meta: meta, geo: geoDist,
      mesh: mesh, capMat: capMat, lineGroup: lineGroup,
      baseY: 0, targetY: 0, selected: false, hovered: false
    };
    districtMeshes.push(rec);
    districtMap[gd.name] = rec;
  });

  /* ---------------------- 方言点 3D ---------------------- */
  const spotGroup = new THREE.Group();
  mapGroup.add(spotGroup);

  const pinLayer = $('#pinLayer');
  const pins = [];

  SPOTS.forEach(function (s) {
    const w = toWorld(s.lnglat, DEPTH);
    const color = CAT_COLOR[s.category] || '#e8b54b';

    // 光柱
    const h = 7.5;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.42, h, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color), transparent: true, opacity: 0.14,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    beam.position.set(w.x, DEPTH + h / 2, w.z);
    // 纸本皮肤下这根"光柱"会变成一根灰白细棍，像渲染瑕疵；点已经由 CSS 画了，这里不显示
    beam.visible = false;
    spotGroup.add(beam);

    // 地面光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.5, 28),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color), transparent: true, opacity: 0.42,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(w.x, DEPTH + 0.06, w.z);
    spotGroup.add(ring);

    const anchor = new THREE.Vector3(w.x, DEPTH + h + 0.2, w.z);

    // HTML 浮动图标
    const el = document.createElement('button');
    el.className = 'pin';
    el.style.setProperty('--c', color);
    el.dataset.id = s.id;
    /* 它是画布上的**装饰标记**，不是控件：CSS 里 pointer-events:none，
       所以既不能点也没有键盘语义。此前它仍是 <button>（tabIndex 0），
       于是键盘 Tab 能停上去、回车却什么都不发生。真正可达的入口是底部队县条、
       搜索框与面板里的按钮 —— 这里明确标成装饰，别给键盘用户一个假入口。 */
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<span class="pin-inner">' +
      '<span class="pin-halo"></span>' +
      '<span class="pin-dot"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
      (CAT_ICON[s.category] || '') + '</svg></span>' +
      '<span class="pin-tip">' + esc(s.name) + ' <b>' + esc(s.word) + '</b></span>' +
      '</span>';
    pinLayer.appendChild(el);

    pins.push({ id: s.id, el: el, anchor: anchor, spot: s, beam: beam, ring: ring, color: color });
  });

  /* 区县标签 */
  const dlabels = [];
  window.XZ_GEO.districts.forEach(function (gd) {
    const rec = districtMap[gd.name];
    if (!rec) return;
    const w = toWorld(gd.label, DEPTH + 0.4);
    const el = document.createElement('div');
    el.className = 'dlabel';
    el.textContent = gd.name;
    pinLayer.appendChild(el);
    dlabels.push({ el: el, anchor: w, name: gd.name });
  });

  /* ---------------------- 相机飞行 ---------------------- */
  let fly = null;
  function flyTo(toPos, toTarget, dur) {
    fly = {
      fromPos: camera.position.clone(),
      toPos: toPos.clone(),
      fromTgt: controls.target.clone(),
      toTgt: toTarget.clone(),
      t0: performance.now(),
      dur: dur || 950
    };
  }
  controls.addEventListener('start', function () {
    fly = null;
    lastInteract = performance.now();
    swayPhase = 0;
    baseTheta = controls.getAzimuthalAngle();
  });

  const _sph = new THREE.Spherical();
  function camPos(target, dist, phi, theta) {
    _sph.set(dist, phi, theta);
    return new THREE.Vector3().setFromSpherical(_sph).add(target);
  }

  function homeView() {
    flyTo(camPos(new THREE.Vector3(0, 0, 0), HOME.dist, HOME.phi, 0),
      new THREE.Vector3(0, 0, 0), 1000);
    selectDistrict(null);
    closePanel();
  }

  function focusDistrict(name) {
    const rec = districtMap[name];
    if (!rec) return;
    const w = toWorld(rec.geo.label, 0);
    const tgt = new THREE.Vector3(w.x, 1.5, w.z);
    flyTo(camPos(tgt, 74, 0.80, controls.getAzimuthalAngle()), tgt, 1000);
  }

  function focusSpot(id) {
    const p = pins.find(v => v.id === id);
    if (!p) return;
    const tgt = new THREE.Vector3(p.anchor.x, DEPTH + 2, p.anchor.z);
    flyTo(camPos(tgt, 62, 0.78, controls.getAzimuthalAngle()), tgt, 950);
  }

  /* ---------------------- 自动旋转 ---------------------- */
  /* 动效敏感用户不要一进来就被自动摇摆推着走（CSS 侧还有一条 prefers-reduced-motion 关掉脉动） */
  let autoMode = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'sway';
  let swayPhase = 0;
  let baseTheta = 0;
  let lastInteract = 0;

  function applyAuto(dt, now) {
    if (fly) return;
    if (now - lastInteract < 2200) return;
    if (autoMode === 'off') return;
    const off = camera.position.clone().sub(controls.target);
    const sp = new THREE.Spherical().setFromVector3(off);
    if (autoMode === 'spin') {
      sp.theta -= dt * 0.16;
    } else {
      swayPhase += dt * 0.26;
      sp.theta = baseTheta + Math.sin(swayPhase) * 0.30;
    }
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sp));
    camera.lookAt(controls.target);
  }

  /* ---------------------- 悬停 & 拾取 ---------------------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(-10, -10);
  let hoverSpot = null;
  let hoverDistrict = null;
  let downPos = null;
  let dragging = false;

  function setHoverDistrict(name) {
    if (hoverDistrict === name) return;
    if (hoverDistrict && districtMap[hoverDistrict]) {
      const r = districtMap[hoverDistrict];
      r.hovered = false;
      applyDistrictLook(r);
    }
    hoverDistrict = name;
    if (name && districtMap[name]) {
      districtMap[name].hovered = true;
      applyDistrictLook(districtMap[name]);
    }
    canvas.style.cursor = name ? 'pointer' : 'grab';
  }

  function applyDistrictLook(r) {
    const on = r.selected, hv = r.hovered;
    if (on) {
      r.capMat.emissive.setHex(0xA63B2A);
      r.capMat.emissiveIntensity = 0.13;
      r.lineGroup.children.forEach(l => {
        l.material.color.setHex(0xA63B2A);
        l.material.opacity = 0.85;
      });
    } else if (hv) {
      r.capMat.emissive.setHex(0x6B655B);
      r.capMat.emissiveIntensity = 0.16;
      r.lineGroup.children.forEach(l => {
        l.material.color.setHex(0x1B1A17);
        l.material.opacity = 0.50;
      });
    } else {
      r.capMat.emissive.setHex(0x000000);
      r.capMat.emissiveIntensity = 1;
      r.lineGroup.children.forEach(l => {
        l.material.color.setHex(0x6B655B);
        l.material.opacity = 0.45;
      });
    }
    r.targetY = on ? 2.4 : 0;
  }

  function pickDistrict(e) {
    raycaster.setFromCamera(ndc, camera);
    const meshes = districtMeshes.map(r => r.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.district : null;
  }

  function pinAtScreen(x, y) {
    let best = null, bd = 26 * 26;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (p.el.classList.contains('hidden')) continue;
      const dx = p.sx - x, dy = p.sy - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  canvas.addEventListener('pointermove', function (e) {
    const w = window.innerWidth, h = window.innerHeight;
    ndc.x = (e.clientX / w) * 2 - 1;
    ndc.y = -(e.clientY / h) * 2 + 1;

    if (downPos) {
      const d = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (d > 6) dragging = true;
    }

    const p = pinAtScreen(e.clientX, e.clientY);
    if (p !== hoverSpot) {
      if (hoverSpot) hoverSpot.el.classList.remove('hover');
      hoverSpot = p;
      if (hoverSpot) hoverSpot.el.classList.add('hover');
    }
    if (hoverSpot) {
      setHoverDistrict(null);
      canvas.style.cursor = 'pointer';
      return;
    }
    setHoverDistrict(pickDistrict(e));
    lastInteract = performance.now();
  });

  canvas.addEventListener('pointerdown', function (e) {
    downPos = { x: e.clientX, y: e.clientY };
    dragging = false;
    hideHint();
  });

  canvas.addEventListener('pointerup', function (e) {
    const wasDrag = dragging;
    downPos = null; dragging = false;
    if (wasDrag) return;

    const p = pinAtScreen(e.clientX, e.clientY);
    if (p) { openSpot(p.id, true); return; }

    const name = pickDistrict(e);
    if (name) selectDistrict(name);
    else selectDistrict(null);
  });

  window.addEventListener('pointerup', function () { downPos = null; });

  /* ---------------------- UI：区县条 ---------------------- */
  const bar = $('#districtBar');
  bar.innerHTML = '<span class="db-cap">徐州 · 10 区县</span>';
  DISTRICTS.forEach(function (d) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.name = d.name;
    b.innerHTML = d.name + '<small>' + countSpots(d.name) + '</small>';
    b.addEventListener('click', function () {
      selectDistrict(d.name);
      focusDistrict(d.name);
    });
    bar.appendChild(b);
  });

  function countSpots(n) {
    return SPOTS.filter(s => s.district === n).length;
  }

  /* ---------------------- UI：图例 ---------------------- */
  (function legend() {
    const wrap = $('#legendList');
    Object.keys(CAT_COLOR).forEach(function (k) {
      const el = document.createElement('div');
      el.className = 'lg-item';
      el.innerHTML = '<i class="lg-swatch" style="background:' + CAT_COLOR[k] + '"></i>' + k;
      wrap.appendChild(el);
    });
  })();

  /* ---------------------- 选择 ---------------------- */
  let selected = null;
  let currentSpot = null;

  function selectDistrict(name) {
    selected = name;
    districtMeshes.forEach(function (r) {
      r.selected = (r.name === name);
      applyDistrictLook(r);
    });
    $$('.chip').forEach(function (c) {
      c.classList.toggle('on', c.dataset.name === name);
    });
    dlabels.forEach(function (d) {
      d.el.classList.toggle('act', d.name === name);
    });
    pins.forEach(function (p) {
      p.el.classList.toggle('dim', name ? p.spot.district !== name : false);
    });
    refreshPins();
    if (name) renderDistrictPanel(name);
    else closePanel();
  }

  /* ---------------------- 面板 ---------------------- */
  const panel = $('#panel');
  const panelBody = $('#panelBody');

  function openPanel() { panel.classList.add('on'); }
  function closePanel() {
    panel.classList.remove('on');
    currentSpot = null;
    pins.forEach(p => p.el.classList.remove('act'));
  }
  $('#panelClose').addEventListener('click', function () {
    closePanel();
    selectDistrict(null);
  });

  /**
   * 「拉呱」入口。
   *
   * 为什么必须有：`data/atlas.js` 的 3 场对话树（早点摊儿 / 街上问路 / 姥姥家吃饭）
   * 带着全部台词、拼音、分数与 `unlock` 字段，但运行时此前既没有场景播放器、
   * 也没有任何指向 `#/scene/*` 的入口 —— 6 个「拉呱专属」词条因此永远拿不到，
   * 而 `tools/audit-reachability.cjs` 只检测通路是否存在，检测不出"用户走不到"。
   * 所以入口和守卫要一起装。
   */
  function sceneSection(did) {
    const list = SCENES.filter(function (sc) { return sc.districtId === did; });
    if (!list.length) return '';
    return '<div class="p-sec"><h3>拉呱</h3>' + list.map(function (sc) {
      const done = SEL.isSceneDone(sc.id);
      return '<button class="quiz-entry" data-scene="' + esc(sc.id) + '">' +
        '<span class="qe-ic">' + (done ? '✓' : '▶') + '</span>' +
        '<span class="qe-txt"><b>' + esc(sc.name) + '</b>' +
        '<i>' + esc(sc.place) + ' · ' + Object.keys(sc.nodes).length + ' 轮对话 · ' +
        (done ? '聊过了' : '跟着话头往下接') + '</i></span>' +
        '<span class="qe-go">' + (done ? '再聊' : '开聊') + ' ›</span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function wireSceneEntries() {
    $$('[data-scene]', panelBody).forEach(function (b) {
      b.addEventListener('click', function () { ROUTER.go('scene', b.dataset.scene); });
    });
  }

  function renderDistrictPanel(name) {
    const d = districtByName[name];
    const rec = districtMap[name];
    if (!d) return;
    const spots = SPOTS.filter(s => s.district === name);
    const cover = spots[0] ? spots[0].thumb : 'assets/thumbs/qinshu.svg';

    let rows = '';
    spots.forEach(function (s) {
      const done = explored.has(s.id);
      rows +=
        '<div class="spot-row" data-spot="' + esc(s.id) + '">' +
        '<img src="' + esc(s.thumb) + '" alt="">' +
        '<div style="min-width:0">' +
        '<div class="sr-t">' + esc(s.name) + (done ? ' ✓' : '') + '</div>' +
        '<div class="sr-s">' + esc(s.tag) + '</div></div>' +
        '<span class="sr-c" style="color:' + (CAT_COLOR[s.category] || '#e8b54b') + '">' + esc(s.category) + '</span>' +
        '</div>';
    });

    panelBody.innerHTML =
      '<div class="p-hero">' +
      '<img src="' + esc(cover) + '" alt="">' +
      '<div class="p-hero-badge" style="--c:#e8b54b">' + esc(d.type) + '</div>' +
      '<div class="p-hero-title"><h2>' + esc(d.name) + '</h2>' +
      '<div class="meta" style="--c:#e8b54b">' + esc(d.note) + ' · ' + spots.length + ' 处方言点</div></div>' +
      '</div>' +
      '<div class="p-sec"><h3>区县速写</h3><p class="p-desc">' + esc(d.intro) + '</p></div>' +
      '<div class="p-sec"><h3>方言点</h3>' + rows + '</div>' +
      sceneSection(d.id);

    $$('.spot-row', panelBody).forEach(function (r) {
      r.addEventListener('click', function () { openSpot(r.dataset.spot, true); });
    });

    wireSceneEntries();
    openPanel();
  }

  function renderSpotPanel(id) {
    const s = spotById[id];
    if (!s) return;
    const d = districtByName[s.district] || { name: s.district };
    const color = CAT_COLOR[s.category] || '#e8b54b';
    const wordRec = WORDS.find(w => w.w === s.word);
    const pid = wordRec ? wordRec.p : '';

    const lv = SEL.levelOfDistrict(s.districtId);
    const st = SEL.spotState(id);
    const ST_LABEL = { locked: '未解锁', unlocked: '已解锁', playing: '进行中', done: '已完成' };
    const lvWords = lv ? SEL.levelWords(lv.id) : [];
    const lvDone = lv ? SEL.isLevelDone(lv.id) : false;

    const quizBlock = lv ? (
      '<div class="p-sec"><h3>方言小游戏</h3>' +
      '<button class="quiz-entry" data-quiz="' + lv.id + '" data-state="' + st + '">' +
      '<span class="qe-ic">' + (lvDone ? '✓' : '▶') + '</span>' +
      '<span class="qe-txt"><b>第 ' + lv.id + ' 关 · ' + esc(lv.name) + '</b>' +
      '<i>' + lvWords.length + ' 个词条 · 听音辨义 · ' + ST_LABEL[st] + '</i></span>' +
      '<span class="qe-go">' + (lvDone ? '重玩' : '开始') + ' ›</span>' +
      '</button></div>'
    ) : '';

    panelBody.innerHTML =
      '<div class="p-hero" style="--c:' + color + '">' +
      '<img src="' + esc(s.thumb) + '" alt="">' +
      '<div class="p-hero-badge" style="--c:' + color + '">' + esc(s.category) + '</div>' +
      '<div class="p-hero-title"><h2>' + esc(s.name) + '</h2>' +
      '<div class="meta" style="--c:' + color + '">' + esc(d.name) + ' · ' + esc(s.tag) + '</div></div>' +
      '</div>' +
      '<div class="p-sec"><h3>方言点介绍</h3>' +
      '<p class="p-desc">' + esc(s.desc) + '</p>' +
      '<div class="quote"><div class="q-w">' + esc(s.word) +
      (pid ? '<span class="q-p">' + esc(pid) + '</span>' : '') +
      '</div><div class="q-m">' + esc(s.meaning) + '</div></div>' +
      '</div>' +
      quizBlock +
      sceneSection(s.districtId) +
      '<div class="p-sec"><h3>延伸阅读</h3>' +
      '<a class="link-btn" href="' + esc(safeUrl(s.link)) + '" target="_blank" rel="noopener">' +
      '<span>' + esc(s.linkLabel) + '</span>' +
      '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>' +
      '</a>' +
      '<button class="btn-ghost" data-jump="' + esc(s.district) + '">查看 ' + esc(d.name) + ' 全部方言点</button>' +
      '</div>';

    $$('[data-jump]', panelBody).forEach(function (b) {
      b.addEventListener('click', function () {
        const n = b.dataset.jump;
        selectDistrict(n);
        focusDistrict(n);
      });
    });

    $$('[data-quiz]', panelBody).forEach(function (b) {
      b.addEventListener('click', function () {
        ROUTER.go('quiz', Number(b.dataset.quiz));
      });
    });

    wireSceneEntries();

    openPanel();
  }

  /* ---------------------- 你家的说法（采样台 → 地图） ----------------------
     采集的动机在"看"这一侧：录完的词如果在地图里听不到，这件事就白做了。
     这里只读索引（localStorage）并按 clipId 从 IDB 取音频，没有录音就不出播放按钮，
     绝不用合成音冒充"你家的说法"。 */
  const GEN_NAME = ['孩子', '我这一代', '父辈', '祖辈'];

  /* 三代对照：同一个词，祖辈/父辈/我 各一条，一行一个人，点 ▶ 就播那一条。
     这是"传承"最直观的样子——听得出差别，比任何统计都直接。 */
  function genTable(list) {
    if (!list || list.length < 2) return '';
    const rows = list.slice().sort(function (a, b) {
      const ga = (a.gen == null ? -1 : a.gen), gb = (b.gen == null ? -1 : b.gen);
      if (ga !== gb) return gb - ga;          // 祖辈在上
      return (b.at || 0) - (a.at || 0);
    });
    const body = rows.map(function (r) {
      const g = r.gen != null && GEN_NAME[r.gen] ? GEN_NAME[r.gen] : '未标注';
      return '<div class="gen-row">' +
        '<span class="gen-n">' + esc(g) + '</span>' +
        '<b class="gen-say">' + esc(r.saying || '（未填）') + '</b>' +
        '<span class="gen-who">' + esc(r.speaker || '—') + '</span>' +
        '<button class="say-play gen-play" data-clip="' + esc(r.clipId) + '" aria-label="播这一条">▶</button>' +
        '</div>';
    }).join('');
    return '<div class="gen-table">' +
      '<div class="gen-row gen-head"><span class="gen-n">辈分</span><span class="gen-say">说法</span>' +
      '<span class="gen-who">谁说</span><span></span></div>' + body + '</div>';
  }

  function saySection(w) {
    const S = window.XZ && window.XZ.sample;
    if (!S) return '';
    const meta = S.metaFor(w.id);
    if (meta && meta.clipId) {
      const list = S.clipsFor(w.id);
      const who = [meta.speaker, meta.gen != null ? GEN_NAME[meta.gen] : ''].filter(Boolean).join(' · ');
      const n = list.length || (meta.clips && meta.clips.length) || 1;
      const table = genTable(list);
      return '<div class="p-sec"><h3>' + (table ? '三代对照' : '你家的说法') + '</h3>' +
        (table
          ? '<p class="gen-tip">同一个词，听一听家里几代人说的差别。</p>' + table
          : '<div class="say-row"><b class="say-w">' + esc(meta.saying || '（未填）') + '</b>' +
            (who ? '<span class="say-who">' + esc(who) + '</span>' : '') +
            '<span class="say-n">共 ' + n + ' 条</span></div>') +
        '<div class="say-acts">' +
        '<button class="say-play" data-say="' + esc(w.id) + '">▶ ' + (table ? '播最新一条' : '播真人录音') + '</button>' +
        (S.served() ? '' : '<span class="say-note">需用 node serve.cjs 打开才能播放</span>') +
        '<a class="say-go" href="recorder/#p=' + encodeURIComponent(w.id) + '">去采录看全部</a>' +
        '</div></div>';
    }
    return '<div class="p-sec"><h3>你家的说法</h3>' +
      '<p class="say-empty">这个词你家还没录。</p>' +
      '<a class="say-go" href="recorder/#p=' + encodeURIComponent(w.id) + '">去录一条</a></div>';
  }

  function renderWordPanel(w) {
    const color = '#e8b54b';
    const spots = SPOTS.filter(s => s.word === w.w);
    let link = '';
    spots.forEach(function (s) {
      link += '<div class="spot-row" data-spot="' + esc(s.id) + '">' +
        '<img src="' + esc(s.thumb) + '" alt="">' +
        '<div style="min-width:0"><div class="sr-t">' + esc(s.name) + '</div>' +
        '<div class="sr-s">' + esc(s.district) + ' · ' + esc(s.tag) + '</div></div></div>';
    });

    panelBody.innerHTML =
      '<div class="p-sec" style="padding-top:26px">' +
      '<h3>方言词</h3>' +
      '<div class="q-word">' + esc(w.w) + '</div>' +
      '<div class="q-py">' + esc(w.p || '') + '</div>' +
      '<p class="p-desc" style="text-align:center">' + esc(w.m) + '</p>' +
      '</div>' +
      '<div class="p-sec"><h3>例句</h3><div class="quote"><div class="q-m" style="margin-top:0;font-size:14px">' +
      /* 此前例句只替换了 `<`，`>` 与 `&` 与引号照样进 HTML —— 数据里一个 `<` 组合就能改写结构 */
      esc(w.e) + '</div></div>' +
      '</div>' +
      saySection(w) +
      (link ? '<div class="p-sec"><h3>相关方言点</h3>' + link + '</div>' : '');

    $$('.spot-row', panelBody).forEach(function (r) {
      r.addEventListener('click', function () { openSpot(r.dataset.spot, true); });
    });
    openPanel();
  }

  /* 对外入口：只改路由，渲染由 router 回调 showSpot 完成 */
  function openSpot(id, doFly) {
    ROUTER.go('spot', id, { fly: !!doFly });
  }

  /* 真正的渲染入口，由 core/router 调用 */
  function showSpot(id, opts) {
    const s = spotById[id];
    if (!s) return;
    currentSpot = id;
    pins.forEach(function (p) { p.el.classList.toggle('act', p.id === id); });

    if (!selected || selected !== s.district) {
      selected = s.district;
      districtMeshes.forEach(function (r) {
        r.selected = (r.name === s.district);
        applyDistrictLook(r);
      });
      $$('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.name === s.district); });
      dlabels.forEach(function (d) { d.el.classList.toggle('act', d.name === s.district); });
      pins.forEach(function (p) {
        p.el.classList.toggle('dim', p.spot.district !== s.district);
      });
    }

    const wasNew = !SEL.isSpotExplored(id);
    ACT.exploreSpot(id);            // locked → unlocked（分值由 store 重算，这里不加分）
    if (wasNew) toast('方言点已点亮 · ' + s.name);

    renderSpotPanel(id);
    if (opts && opts.fly) focusSpot(id);
    updateProgress();
    refreshPins();
    hideHint();
  }

  /* ---------------------- 方言值（全部取自 store） ---------------------- */
  function levelOf(v) {
    let lv = LEVELS[0];
    LEVELS.forEach(function (l) { if (v >= l.min) lv = l; });
    return lv;
  }
  function updateValueUI() {
    const s = STORE.get();
    $('#vValue').textContent = s.value;
    $('#vLevel').textContent = SEL.tier().short;
  }
  function updateProgress() {
    const total = SEL.totalSpots();
    const n = SEL.exploredCount();
    $('#progText').textContent = n + ' / ' + total;
    $('#progBar').style.width = (n / total * 100).toFixed(1) + '%';
    refreshPins();
  }

  /* pin 四态：locked / unlocked / playing / done */
  function refreshPins() {
    pins.forEach(function (p) {
      const st = SEL.spotState(p.id);
      p.el.setAttribute('data-state', st);
      p.el.classList.toggle('done', st === 'done');
      p.el.classList.toggle('playing', st === 'playing');
    });
    $$('.chip').forEach(function (c) {
      const d = SEL.districtByName(c.dataset.name);
      if (!d) return;
      const st = SEL.districtState(d.id);
      c.setAttribute('data-state', st);
    });
  }

  /* ---------------------- Toast ---------------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  let hintDone = false;
  function hideHint() {
    if (hintDone) return;
    hintDone = true;
    const h = $('#hint');
    h.style.opacity = '0';
  }

  /* ---------------------- 搜索（索引由 selectors 派生） ---------------------- */
  const INDEX = SEL.searchIndex();

  const input = $('#searchInput');
  const sug = $('#sug');
  const clearBtn = $('#searchClear');
  let matches = [];
  let activeIdx = -1;

  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  /**
   * href 只放行 http/https。
   * 面板里的链接来自 `data/atlas.js` 的 `links[].url`，今天是我们自己写的，
   * 但一旦开放词条贡献（哪怕只是本地覆盖文件），`javascript:` / `data:` 就会变成直接的执行通道。
   */
  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
  }
  function mark(text, q) {
    if (!q) return esc(text);
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<i class="sug-key">' + esc(text.slice(i, i + q.length)) + '</i>' + esc(text.slice(i + q.length));
  }

  function search(q) {
    q = q.trim();
    if (!q) return [];
    const low = q.toLowerCase();
    const scored = [];
    INDEX.forEach(function (it) {
      const L = it.label.toLowerCase(), S = it.sub.toLowerCase();
      let sc = 0;
      if (L === low) sc = 120;
      else if (L.indexOf(low) === 0) sc = 90;
      else if (L.indexOf(low) > 0) sc = 70;
      else if (S.indexOf(low) >= 0) sc = 45;
      if (!sc) return;
      if (it.kind === 'district') sc += 8;
      if (it.kind === 'spot') sc += 4;
      scored.push({ it: it, sc: sc });
    });
    scored.sort((a, b) => b.sc - a.sc);
    return scored.slice(0, 16).map(v => v.it);
  }

  function renderSug(q) {
    if (!q) { sug.classList.remove('on'); return; }
    matches = search(q);
    activeIdx = -1;
    if (!matches.length) {
      sug.innerHTML = '<div class="sug-empty">没找到「' + esc(q) + '」<br><span style="opacity:.6;font-size:11px">试试：管、恣儿、拉呱、琴书、沛县</span></div>';
      sug.classList.add('on');
      return;
    }
    let html = '', lastG = '';
    matches.forEach(function (m, i) {
      if (m.group !== lastG) { html += '<div class="sug-group">' + m.group + '</div>'; lastG = m.group; }
      html += '<div class="sug-item" data-i="' + i + '">' +
        '<span class="sug-glyph">' + esc(m.glyph) + '</span>' +
        '<span class="sug-main"><span class="sug-t">' + mark(m.label, q) + '</span>' +
        '<span class="sug-s">' + mark(m.sub, q) + '</span></span></div>';
    });
    sug.innerHTML = html;
    sug.classList.add('on');

    $$('.sug-item', sug).forEach(function (el) {
      el.addEventListener('click', function () {
        go(matches[+el.dataset.i]);
      });
    });
  }

  function go(m) {
    if (!m) return;
    sug.classList.remove('on');
    input.blur();
    if (m.kind === 'district') ROUTER.go('district', m.id, { fly: true });
    else if (m.kind === 'spot') ROUTER.go('spot', m.id, { fly: true, highlight: true });
    else if (m.kind === 'level') ROUTER.go('quiz', m.id);
    else ROUTER.go('word', m.id, { highlight: true });
  }

  input.addEventListener('input', function () {
    const v = input.value;
    clearBtn.hidden = !v;
    renderSug(v.trim());
  });
  input.addEventListener('focus', function () {
    if (input.value.trim()) renderSug(input.value.trim());
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.blur(); sug.classList.remove('on'); return; }
    if (!matches.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx += (e.key === 'ArrowDown' ? 1 : -1);
      if (activeIdx < 0) activeIdx = matches.length - 1;
      if (activeIdx >= matches.length) activeIdx = 0;
      $$('.sug-item', sug).forEach(function (el, i) {
        el.classList.toggle('act', i === activeIdx);
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(matches[activeIdx >= 0 ? activeIdx : 0]);
    }
  });
  clearBtn.addEventListener('click', function () {
    input.value = ''; clearBtn.hidden = true; sug.classList.remove('on'); input.focus();
  });
  document.addEventListener('click', function (e) {
    if (!$('#searchBox').contains(e.target)) sug.classList.remove('on');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault(); input.focus();
    }
    if (e.key === 'Escape') { closePanel(); selectDistrict(null); closeModal(); }
  });

  /* ---------------------- 工具按钮 ---------------------- */
  const btnRotate = $('#btnRotate');
  if (autoMode !== 'off') btnRotate.classList.add('on');
  else btnRotate.dataset.tip = '自动旋转';
  btnRotate.addEventListener('click', function () {
    if (autoMode === 'sway') { autoMode = 'spin'; btnRotate.dataset.tip = '环绕旋转'; }
    else if (autoMode === 'spin') { autoMode = 'off'; btnRotate.classList.remove('on'); btnRotate.dataset.tip = '关闭旋转'; return; }
    else { autoMode = 'sway'; btnRotate.classList.add('on'); btnRotate.dataset.tip = '自动旋转'; }
    btnRotate.classList.add('on');
    lastInteract = 0;
  });
  $('#btnReset').addEventListener('click', homeView);

  /* ---------------------- 模态 ---------------------- */
  const modal = $('#modal');
  const modalCard = $('#modalCard');

  function closeModal() {
    modal.classList.remove('on');
    // 图鉴是从 #/book 打开的，关掉就要把地址栏还回去，否则刷新会重新弹出一个"已关闭"的图鉴
    if (ROUTER.parse(location.hash).name === 'book') ROUTER.replace('home');
  }
  modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

  /* ---------- 小游戏入口（玩法由 features/quiz.js 独立承担） ---------- */
  $('#btnChallenge').addEventListener('click', function () {
    const d = selected ? districtByName[selected] : null;
    const lv = d ? SEL.levelOfDistrict(d.id) : null;
    ROUTER.go('quiz', lv ? lv.id : 1);
  });

  /* ---------- 图鉴 ---------- */
  function openBook() {
    const S = window.XZ && window.XZ.sample;
    /* 录过就算收进来了：录音本身也是一种"收集"，不该因为没有闯关就不给看。
       这条也顺手解决"先录后学"的顺序——用户可以先在采样台录自家说法。 */
    let items = WORDS.map(function (w) {
      const has = !!(S && S.has(w.id));
      return { w: w, unlocked: SEL.isWordUnlocked(w.id) || has, has: has };
    });
    const n = items.filter(i => i.unlocked).length;
    const rec = items.filter(i => i.has).length;
    // 收进来的排前面：一屏 54 张卡，先给用户看他自己的东西
    items.sort(function (a, b) { return (b.unlocked - a.unlocked) || (b.has - a.has); });

    let html = '';
    items.forEach(function (i) {
      /* 每张词卡右下角一枚小按钮：已录 → 播真人录音；未录 → 进采样台录这个词。
         一个角标把"学"和"录"接起来，不用先回地图找入口。 */
      const badge = i.unlocked
        ? '<button class="bk-say' + (i.has ? ' has' : '') + '" data-say="' + esc(i.w.id) + '" ' +
          'aria-label="' + (i.has ? '播真人录音' : '录这个词') + '">' + (i.has ? '▶' : '＋') + '</button>'
        : '';
      html += '<div class="bk' + (i.unlocked ? '' : ' lock') + '" data-word="' + esc(i.w.id) + '">' +
        badge +
        '<div class="bk-w">' + (i.unlocked ? esc(i.w.w) : '？？') + '</div>' +
        '<div class="bk-p">' + (i.unlocked ? esc(i.w.p || '') : '未解锁') + '</div>' +
        '<div class="bk-m">' + (i.unlocked ? esc(i.w.m) : '闯关答对即可解锁') + '</div>' +
        '</div>';
    });

    modalCard.innerHTML =
      '<div class="mc-head"><div><div class="mc-eyebrow">词条册</div>' +
      '<h2 class="mc-title" style="white-space:nowrap;font-size:19px">已收录 ' + n + ' / ' + items.length + ' 个词' +
      (rec ? '<span style="font-size:13px;color:var(--ink-2);margin-left:10px">已录 ' + rec + ' 条</span>' : '') +
      '</h2></div>' +
      '<button class="mc-close" data-close>×</button></div>' +
      '<div class="book-grid">' + html + '</div>' +
      '<button class="btn-ghost" data-close style="margin-top:18px">关闭</button>';

    $$('[data-close]', modalCard).forEach(b => b.addEventListener('click', closeModal));

    // 词卡：点角标=听/录，点卡片本身=看这个词条
    $$('.bk', modalCard).forEach(function (el) {
      el.addEventListener('click', function (e) {
        const b = e.target.closest ? e.target.closest('.bk-say') : null;
        if (b) {
          const id = b.getAttribute('data-say');
          if (b.classList.contains('has')) {
            window.XZ.sample.play(id).then(function (ok) { if (!ok) toast('这条录音没能播出来。'); });
          } else {
            location.href = 'recorder/#p=' + encodeURIComponent(id);
          }
          return;
        }
        const id = el.getAttribute('data-word');
        if (!id || el.classList.contains('lock')) return;
        closeModal();
        ROUTER.go('word', id);
      });
    });
    modal.classList.add('on');
  }
  // 走路由而不是直接开弹窗：这样地址栏反映"正在看图鉴"，浏览器返回键也有意义
  $('#btnBook').addEventListener('click', function () { ROUTER.go('book'); });

  /* ---------------------- 每帧 ---------------------- */
  const _v = new THREE.Vector3();
  let lastT = performance.now();
  let rafId = 0;
  let introDone = false;

  function updateScreenPositions() {
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      _v.copy(p.anchor).project(camera);
      p.sx = (_v.x * 0.5 + 0.5) * W;
      p.sy = (-_v.y * 0.5 + 0.5) * H;
      if (_v.z > 1 || p.sx < -80 || p.sx > W + 80 || p.sy < -80 || p.sy > H + 80) {
        p.el.classList.add('hidden');
      } else {
        p.el.classList.remove('hidden');
        p.el.style.transform = 'translate3d(' + p.sx.toFixed(1) + 'px,' + p.sy.toFixed(1) + 'px,0)';
      }
    }
    for (let i = 0; i < dlabels.length; i++) {
      const d = dlabels[i];
      _v.copy(d.anchor).project(camera);
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      d.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) translate(-50%,-50%)';
      d.el.style.opacity = _v.z > 1 ? 0 : 0.9;
    }
  }

  function animate(now) {
    rafId = requestAnimationFrame(animate);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (fly) {
      const p = Math.min(1, (now - fly.t0) / fly.dur);
      const e = 1 - Math.pow(1 - p, 3);
      camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
      controls.target.lerpVectors(fly.fromTgt, fly.toTgt, e);
      if (p >= 1) fly = null;
    } else {
      applyAuto(dt, now);
    }

    // 区县浮起缓动
    for (let i = 0; i < districtMeshes.length; i++) {
      const r = districtMeshes[i];
      const diff = r.targetY - r.mesh.position.y;
      if (Math.abs(diff) > 0.002) r.mesh.position.y += diff * 0.16;
      else r.mesh.position.y = r.targetY;
      // 线框同步
      r.lineGroup.position.y = r.mesh.position.y;
    }

    // 光点脉动
    const t = now * 0.001;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      const k = 0.5 + 0.5 * Math.sin(t * 1.8 + i);
      p.ring.scale.setScalar(0.86 + k * 0.26);
      p.ring.material.opacity = 0.30 + k * 0.34;
      p.beam.material.opacity = 0.10 + k * 0.10;
    }


    controls.update();
    updateScreenPositions();
    renderer.render(scene, camera);
  }

  /* ---------------------- 尺寸 ---------------------- */
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (w < 860) {
      camera.fov = 52;
    } else {
      camera.fov = 42;
    }
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  /* ---------------------- 路由注册（地图侧） ---------------------- */
  let booted = false;

  ROUTER.on('home', function () {
    selectDistrict(null);
    if (!booted) { booted = true; lastInteract = performance.now() + 700; homeView(); }
  });

  ROUTER.on('district', function (id, opts) {
    const d = SEL.district(id);
    if (!d) { ROUTER.replace('home'); return; }
    selectDistrict(d.name);
    if (opts && opts.fly) focusDistrict(d.name);
    hideHint();
  });

  ROUTER.on('spot', function (id, opts) {
    showSpot(id, opts);
    if (opts && opts.highlight) flashPin(id);
  });

  ROUTER.on('word', function (id, opts) {
    const w = WORDS.find(x => x.id === id);
    if (!w) { ROUTER.replace('home'); return; }
    const d = districtByName[w.d];
    if (d) {
      selectDistrict(w.d);
      if (opts && opts.fly !== false) focusDistrict(w.d);
    }
    renderWordPanel(w);
    hideHint();
  });

  /* 「播真人录音」用事件委托：词条面板每次渲染都会换掉 innerHTML，
     把 listener 绑在按钮本身上，会绑到随后被替换掉的实例（实测点不动）。 */
  document.addEventListener('click', function (e) {
    const b = e.target && e.target.closest ? e.target.closest('.say-play') : null;
    if (!b) return;
    const clip = b.getAttribute('data-clip');
    if (clip) {
      b.textContent = '…';
      window.XZ.sample.playClip(clip).then(function (ok) {
        b.textContent = ok ? '✓' : '▶';
        setTimeout(function () { b.textContent = '▶'; }, 1200);
      });
      return;
    }
    const id = b.getAttribute('data-say');
    if (!id) return;
    b.textContent = '播放中…';
    window.XZ.sample.play(id).then(function (ok) {
      b.textContent = ok ? '▶ 再播一次' : '▶ 播真人录音';
      if (!ok) toast('这条录音没能播出来：文件可能已被删除，或浏览器拦截了这次播放。');
    });
  });

  ROUTER.on('book', function () {
    openBook();
  });

  /* 搜索命中后在地图上闪一下，指明落在哪 */
  function flashPin(id) {
    const p = pins.find(v => v.id === id);
    if (!p) return;
    p.el.classList.add('flash');
    setTimeout(function () { p.el.classList.remove('flash'); }, 1700);
  }

  /* store 变更 → 顶栏 / 进度 / pin 四态统一刷新 */
  STORE.subscribe(function (reason) {
    updateValueUI();
    updateProgress();
    if (reason === 'level:done' && selected) {
      const d = districtByName[selected];
      const lv = d ? SEL.levelOfDistrict(d.id) : null;
      if (lv && SEL.isLevelDone(lv.id)) toast('第 ' + lv.id + ' 关完成 · ' + d.name + ' 已点亮');
    }
  });

  /* ---------------------- 启动 ---------------------- */
  updateValueUI();
  updateProgress();
  onResize();
  mapGroup.position.y = -14;
  mapGroup.scale.setScalar(0.94);

  rafId = requestAnimationFrame(animate);

  /* 后台标签页不该继续每帧重绘 WebGL：切走就停，切回来续。
     lastT 必须重置，否则回来第一帧的 dt 会是「离开多久」那么长，缓动会跳一帧。 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } else if (!rafId) {
      lastT = performance.now();
      rafId = requestAnimationFrame(animate);
    }
  });

  // 入场：先落图，再按当前 hash 派发路由。
  // 但派发**不能只挂在 rAF 上**：页面被后台化或被节流时 rAF 不触发，
  // ROUTER.init() 就永远不跑，整个应用停在空白状态（实测 document.hidden 时
  // 所有路由都不渲染、面板全空）。所以 init 做成幂等 + 一条时间兜底。
  let routerStarted = false;
  function startRouter() {
    if (routerStarted) return;
    routerStarted = true;
    try { ROUTER.init(); } catch (err) { console.error(err); homeView(); }
  }

  // 入场动画只是视觉（地图落下 + 微缩放），**路由初始化不能挂在它后面**：
  // rAF 在后台标签页里根本不触发，实测那样整个应用停在空白状态、所有 hash 都不生效。
  const t0 = performance.now();
  (function intro() {
    const p = Math.min(1, (performance.now() - t0) / 1500);
    const e = 1 - Math.pow(1 - p, 3);
    mapGroup.position.y = -14 * (1 - e);
    mapGroup.scale.setScalar(0.94 + 0.06 * e);
    if (p < 1) requestAnimationFrame(intro);
    else lastInteract = performance.now() + 800;
  })();

  startRouter();

  setTimeout(function () { hideHint(); }, 9000);

  // 预加载缩略图
  SPOTS.forEach(function (s) { const im = new Image(); im.src = s.thumb; });
})();
