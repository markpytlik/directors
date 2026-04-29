/* ============================================================
   Shared data layer for all design themes.
   Fetches director list from the Google Sheet, falls back to a
   tiny stub if unreachable, and exposes a renderInto() helper
   that each theme calls with its own card-builder function.
   ============================================================ */
window.MVD = (function () {
  const SHEET_ID = '14wmo6vI_y8Heyxf8h5agJZu1cIsXeA9u6ngBKxpjA44';
  const DIRECTORS_GID = '0';
  const COPY_GID = '1198261989';
  const sheetUrls = (gid) => [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  ];

  const FALLBACK = [
    { section: 'all-time', rank: 1, name: 'Hype Williams', nationality: 'United States',
      blurb: 'No single director shaped the look of late-90s and 2000s hip-hop more decisively.',
      videos: [
        { id: 'gUhRKVIjJtw', title: 'Notorious B.I.G. — Mo Money Mo Problems' },
        { id: 'PsO6ZnUZI0g', title: 'Kanye West — Stronger' }
      ]},
    { section: 'rising', rank: 1, name: 'Cole Bennett', nationality: 'United States',
      blurb: 'The defining visual voice of a generation of internet-native rappers.',
      videos: [
        { id: 'lyu7v7nWzfo', title: 'Lil Mosey — Blueberry Faygo' }
      ]}
  ];

  /* ---------- CSV parser ---------- */
  function parseCSV(text) {
    const rows = [];
    let cur = [], val = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i+1];
      if (q) {
        if (c === '"' && n === '"') { val += '"'; i++; }
        else if (c === '"') { q = false; }
        else { val += c; }
      } else {
        if (c === '"') { q = true; }
        else if (c === ',') { cur.push(val); val = ''; }
        else if (c === '\n' || c === '\r') {
          if (c === '\r' && n === '\n') i++;
          cur.push(val); rows.push(cur); cur = []; val = '';
        } else { val += c; }
      }
    }
    if (val.length || cur.length) { cur.push(val); rows.push(cur); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
  }
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
    return rows.slice(1).map(r => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
  }
  function normaliseFromSheet(objs) {
    return objs.filter(o => o.name).map(o => {
      const videos = [];
      for (let n = 1; n <= 6; n++) {
        const id = o[`video${n}_id`];
        const title = o[`video${n}_title`];
        if (id) videos.push({ id, title: title || '' });
      }
      const sec = (o.section || 'all-time').toLowerCase();
      return {
        section: sec.includes('rising') || sec.includes('up') ? 'rising' : 'all-time',
        rank: parseInt(o.rank, 10) || 99,
        name: o.name,
        nationality: o.nationality || '',
        blurb: o.blurb || '',
        image: o.image_url || '',
        videos
      };
    });
  }

  /* ---------- helpers ---------- */
  function ytThumb(id) {
    return `https://img.youtube.com/vi/${encodeURIComponent(id || '')}/hqdefault.jpg`;
  }
  function ytWatch(id) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id || '')}`;
  }
  function ytSearch(title) {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(title || '')}`;
  }
  function htmlEsc(s) {
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function splitArtistTrack(title) {
    const m = (title || '').match(/^(.*?)\s+[—–-]\s+(.*)$/);
    if (m) return { artist: m[1], track: m[2] };
    return { artist: '', track: title || '' };
  }

  /* ---------- silhouette + thumbnail fallback ---------- */
  const SILHOUETTES = [
    ['#2a2a2a','#cdbfa4'], ['#1f2933','#bcc3cc'], ['#28201b','#d6c5a8'],
    ['#1a2a2a','#a9bdbd'], ['#1f1c2c','#928dab'], ['#2c1f1f','#c2a99c'],
    ['#212121','#b8b1a3'], ['#1c2a1c','#a8b8a0']
  ];
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h<<5) - h) + str.charCodeAt(i) | 0;
    return Math.abs(h);
  }
  function silhouetteSVG(name, palette) {
    const [bg, fg] = palette || SILHOUETTES[hash(name||'') % SILHOUETTES.length];
    return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-label="${htmlEsc(name)} (placeholder)"><rect width="200" height="250" fill="${bg}"/><g fill="${fg}"><circle cx="100" cy="92" r="38"/><path d="M30 250 C30 178, 60 148, 100 148 C140 148, 170 178, 170 250 Z"/></g></svg>`;
  }

  /* YouTube returns a 200 OK with a 120×90 grey placeholder when an ID
     doesn't exist, instead of 404'ing — so onerror won't fire. After load,
     check the image dimensions and treat anything under 200px as failed. */
  function validateYouTubeImage(img) {
    if (!img || img.dataset.ytChecked) return;
    img.dataset.ytChecked = '1';
    const check = () => {
      if (img.naturalWidth > 0 && img.naturalWidth < 200) {
        window.__thumbFail(img);
      }
    };
    if (img.complete) check();
    else img.addEventListener('load', check, { once: true });
  }
  function validateAllYouTubeImages(root) {
    (root || document).querySelectorAll('img[src*="img.youtube.com/vi/"]').forEach(validateYouTubeImage);
  }

  /* When a YouTube thumbnail 404s, swap to a music-note placeholder and
     re-point the link to a YouTube search by title. */
  window.__thumbFail = function (img) {
    const tile = img.closest('[data-search-url]');
    if (!tile) return;
    if (tile.dataset.searchUrl) tile.href = tile.dataset.searchUrl;
    const seed = tile.dataset.title || tile.textContent.trim() || 'video';
    const palette = SILHOUETTES[hash(seed) % SILHOUETTES.length];
    const [bg, fg] = palette;
    const thumb = img.parentElement;
    if (!thumb) return;
    img.remove();
    const ph = document.createElement('div');
    ph.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    ph.innerHTML = `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%"><rect width="320" height="180" fill="${bg}"/><g fill="${fg}" opacity="0.55" transform="translate(140 60)"><rect x="0" y="0" width="6" height="60" rx="2"/><rect x="34" y="-10" width="6" height="70" rx="2"/><path d="M0 0 L40 -10 L40 -2 L0 8 Z"/><ellipse cx="-6" cy="62" rx="10" ry="7"/><ellipse cx="28" cy="62" rx="10" ry="7"/></g></svg>`;
    thumb.prepend(ph);
  };

  /* ---------- loader ---------- */
  async function tryFetch(url) {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.trim().startsWith('<')) throw new Error('Not CSV (sheet not public?)');
    return text;
  }
  async function loadDirectors() {
    for (const url of sheetUrls(DIRECTORS_GID)) {
      try {
        const text = await tryFetch(url);
        const data = normaliseFromSheet(rowsToObjects(parseCSV(text)));
        if (data.length) {
          console.info(`Loaded ${data.length} directors from Google Sheet.`);
          return data;
        }
      } catch (e) { console.warn('Directors fetch failed:', url, e.message); }
    }
    console.info('Using bundled fallback director data.');
    return FALLBACK;
  }
  async function loadCopy() {
    for (const url of sheetUrls(COPY_GID)) {
      try {
        const text = await tryFetch(url);
        const rows = parseCSV(text);
        // expect [key,value] rows; skip header and empty rows
        const out = {};
        for (const r of rows.slice(1)) {
          const k = (r[0] || '').trim();
          const v = (r[1] || '').trim();
          if (k) out[k] = v;
        }
        if (Object.keys(out).length) {
          console.info(`Loaded ${Object.keys(out).length} copy strings from Google Sheet.`);
          return out;
        }
      } catch (e) { console.warn('Copy fetch failed:', url, e.message); }
    }
    return {};
  }

  /* ---------- copy application ---------- */
  function applyCopy(copy) {
    if (!copy || !Object.keys(copy).length) return;
    // <title> + meta description
    if (copy.page_title) document.title = copy.page_title;
    if (copy.page_description) {
      let m = document.querySelector('meta[name="description"]');
      if (m) m.setAttribute('content', copy.page_description);
    }
    // walk every [data-copy] element
    document.querySelectorAll('[data-copy]').forEach(el => {
      const key = el.dataset.copy;
      const val = copy[key];
      if (val == null) return;
      const emphKey = el.dataset.copyEmph;
      const emphVal = emphKey ? copy[emphKey] : null;
      const emphTag = el.dataset.copyEmphTag || 'em';
      if (emphVal && val.indexOf(emphVal) !== -1) {
        const parts = val.split(emphVal);
        let html = '';
        parts.forEach((p, i) => {
          html += htmlEsc(p);
          if (i < parts.length - 1) html += `<${emphTag}>${htmlEsc(emphVal)}</${emphTag}>`;
        });
        el.innerHTML = html;
      } else {
        // preserve any inner structure for elements that have it (e.g. multi-span hero)
        // by checking if we should replace just text or whole innerHTML.
        if (el.dataset.copyMode === 'html') el.innerHTML = val;
        else el.textContent = val;
      }
    });
  }

  /* ---------- public API ---------- */
  function renderInto({ allTimeId, risingId, buildCard }) {
    Promise.all([loadDirectors(), loadCopy()]).then(([data, copy]) => {
      applyCopy(copy);
      const allTime = data.filter(d => d.section === 'all-time').sort((a,b)=>a.rank-b.rank);
      const rising  = data.filter(d => d.section === 'rising').sort((a,b)=>a.rank-b.rank);
      const at = document.getElementById(allTimeId);
      const ri = document.getElementById(risingId);
      if (at) at.innerHTML = allTime.map(buildCard).join('') || '<div class="status">No all-time entries.</div>';
      if (ri) ri.innerHTML = rising.map(buildCard).join('')  || '<div class="status">No rising entries.</div>';
      // Detect YouTube grey placeholders (200 OK with tiny 120×90 image)
      // and trigger the music-note fallback for those tiles too.
      validateAllYouTubeImages();
    });
  }

  return {
    renderInto, applyCopy,
    ytThumb, ytWatch, ytSearch, htmlEsc, splitArtistTrack,
    silhouetteSVG, hash, SILHOUETTES
  };
})();
