// assets.js: lazy loader + registry for the CC0 files in assets/ (see assets/LICENSES.md).
// three.js r128. Everything is cached, returns promises, and degrades gracefully: a missing file
// resolves to null (GLB/HDRI) or leaves the material untextured, never throws.
//
//   Assets.tex('plaster', { repeat: [4, 2], anisotropy: 4 })
//       -> { map, normalMap, roughnessMap, aoMap, alphaMap?, ready: Promise, setRepeat(x, y) }
//          map is sRGB; roughnessMap/aoMap share the packed ARM texture (R=AO, G=rough, B=metal).
//          Textures are created immediately (blank until loaded); prefer Assets.material() which only
//          attaches maps once they have loaded.
//   Assets.material('brick', { repeat: [3, 3], color: 0xffffff, ...MeshStandardMaterial params })
//       -> MeshStandardMaterial, maps added as they arrive. aoMap needs a uv2 attribute: call
//          Assets.addUv2(geometry) or leave opts.ao = false (default false).
//   Assets.leafMaterial('leaf09') -> double-sided alpha-tested MeshStandardMaterial for foliage cards.
//   Assets.gltf('models/barrel_03.glb') -> Promise<gltf | null>  (cached; clone gltf.scene yourself)
//   Assets.prop('barrel_03') -> Promise<Object3D | null> (a fresh clone, shadows on)
//   Assets.envMap(renderer) -> Promise<Texture | null>  (PMREM-filtered HDRI; scene.environment / material.envMap)
//   Assets.hdri() -> Promise<DataTexture | null>  (raw equirect, e.g. for scene.background)
//   Assets.TEXTURES, Assets.PROPS: available names.
const Assets = (function () {
  const BASE = 'assets/';
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/';
  const TEXTURES = ['plaster', 'concrete', 'brick', 'granite', 'ccroad', 'asphalt', 'dirt', 'drygrass', 'grass',
    'roof', 'corrugated', 'planks', 'fabric'];
  const LEAVES = ['leaf09', 'leaf10'];
  const PROPS = ['plastic_monobloc_chair_01', 'barrel_03', 'hand_truck', 'industrial_pastic_container'];
  const HDRI = 'hdri/kloofendal_overcast_puresky_1k.hdr';
  // Rigged + animated CC0 humanoid for people-models.js (clips named idle/walk/run/sit). None shipped yet:
  // set to e.g. 'models/villager.glb' once a CC0 character GLB is dropped into assets/models/.
  const CHARACTER = null;

  const files = {}, gltfs = {}, scripts = {}, texSets = {};
  const warned = {};
  const warn = (k, e) => { if (!warned[k]) { warned[k] = 1; console.warn('[Assets] missing ' + k, e && e.message || ''); } };

  function script(url) {
    if (scripts[url]) return scripts[url];
    return scripts[url] = new Promise(res => {
      const s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = () => res(true); s.onerror = () => { warn(url); res(false); };
      document.head.appendChild(s);
    });
  }
  // SkeletonUtils / RGBELoader are not on the page by default; pulled from the same r128 CDN on demand.
  const needSkeletonUtils = () => THREE.SkeletonUtils ? Promise.resolve(true) : script(CDN + 'utils/SkeletonUtils.js');
  const needRGBE = () => THREE.RGBELoader ? Promise.resolve(true) : script(CDN + 'loaders/RGBELoader.js');

  const texLoader = new THREE.TextureLoader();
  // one THREE.Texture per file; resolves the texture or null
  function file(path, srgb) {
    if (files[path]) return files[path];
    const t = new THREE.Texture();
    const p = new Promise(res => {
      texLoader.load(BASE + path, img => {
        t.image = img.image; t.needsUpdate = true; res(t);
      }, undefined, e => { warn(path, e); res(null); });
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return files[path] = { t, p };
  }

  function tex(name, opts) {
    opts = opts || {};
    const rep = opts.repeat || [1, 1], key = name + '|' + rep.join('x');
    if (texSets[key]) return texSets[key];
    const leaf = name.startsWith('leaf');
    const col = file('textures/' + name + '_col.jpg', true), nrm = file('textures/' + name + '_nrm.jpg');
    const arm = leaf ? null : file('textures/' + name + '_arm.jpg');
    const alpha = leaf ? file('textures/' + name + '_alpha.jpg') : null;
    // clone per repeat so different surfaces can tile differently; clones share the image
    const clones = [];
    const mk = f => { if (!f) return null; const c = f.t.clone(); c.repeat.set(rep[0], rep[1]); clones.push([c, f]); return c; };
    const set = { map: mk(col), normalMap: mk(nrm), roughnessMap: mk(arm), alphaMap: mk(alpha) };
    set.aoMap = set.roughnessMap;
    const an = opts.anisotropy || 4;
    set.ready = Promise.all(clones.map(([c, f]) => f.p.then(t => {
      if (t) { c.image = t.image; c.anisotropy = an; c.needsUpdate = true; }
      return t ? c : null;
    }))).then(() => set);
    set.setRepeat = (x, y) => { clones.forEach(([c]) => c.repeat.set(x, y === undefined ? x : y)); return set; };
    set.loaded = slot => { const c = set[slot]; const e = c && clones.find(q => q[0] === c); return e ? e[1].p : Promise.resolve(null); };
    return texSets[key] = set;
  }

  // Material whose maps are attached only after each loads (so a missing file just leaves it plain).
  function material(name, opts) {
    opts = Object.assign({}, opts);
    const rep = opts.repeat, ao = opts.ao; delete opts.repeat; delete opts.ao; delete opts.anisotropy;
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, roughness: 1, metalness: 0 }, opts));
    const s = tex(name, { repeat: rep });
    const slots = ['map', 'normalMap', 'roughnessMap'].concat(ao ? ['aoMap'] : []);
    if (name.startsWith('leaf')) slots.push('alphaMap');
    slots.forEach(k => s.loaded(k).then(t => { if (t && s[k]) { m[k] = s[k]; m.needsUpdate = true; } }));
    m.userData.texSet = s;
    return m;
  }
  function leafMaterial(name, opts) {
    return material(name || 'leaf09', Object.assign({ side: THREE.DoubleSide, alphaTest: 0.45, transparent: false }, opts));
  }
  // copy uv -> uv2 so aoMap works on a plain geometry
  function addUv2(g) { if (g.attributes.uv && !g.attributes.uv2) g.setAttribute('uv2', g.attributes.uv); return g; }

  function gltf(path) {
    if (gltfs[path]) return gltfs[path];
    return gltfs[path] = new Promise(res => {
      if (!THREE.GLTFLoader) { warn('GLTFLoader'); return res(null); }
      new THREE.GLTFLoader().load(BASE + path, g => res(g), undefined, e => { warn(path, e); res(null); });
    });
  }
  function prop(name) {
    return gltf('models/' + name + '.glb').then(g => {
      if (!g) return null;
      const o = g.scene.clone(true);
      o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      return o;
    });
  }

  let hdrP = null; const envs = new WeakMap();
  function hdri() {
    return hdrP || (hdrP = needRGBE().then(ok => !ok ? null : new Promise(res => {
      new THREE.RGBELoader().setDataType(THREE.UnsignedByteType).load(BASE + HDRI, t => {
        t.mapping = THREE.EquirectangularReflectionMapping; res(t);
      }, undefined, e => { warn(HDRI, e); res(null); });
    })));
  }
  function envMap(renderer) {
    if (!renderer) return Promise.resolve(null);
    if (envs.has(renderer)) return envs.get(renderer);
    const p = hdri().then(t => {
      if (!t) return null;
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromEquirectangular(t); pm.dispose();
      return rt.texture;
    });
    envs.set(renderer, p); return p;
  }

  return { tex, material, leafMaterial, addUv2, gltf, prop, hdri, envMap, needSkeletonUtils, script,
    TEXTURES, LEAVES, PROPS, BASE, CHARACTER };
})();
window.Assets = Assets;
