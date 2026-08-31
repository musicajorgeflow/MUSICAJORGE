const CONFIG = {
  jorge: { name: "PLAYLIST JORGE", desc: "Tu música personal", manifest: "playlist_jorge/library.json" },
  djgeeorge: { name: "DJGEEORGE", desc: "Mashups, edits y producciones de DJGEEORGE", manifest: "playlist_djgeeorge/library.json" },
  online: { name: "ONLINE", desc: "Busca música y escucha un preview al instante", manifest: null }
};

const state = { playlist: "jorge", data: { jorge: [], djgeeorge: [], online: [] }, current: -1, shuffle: false, repeat: false, onlineStatus: "idle" };

const $ = id => document.getElementById(id);
const audio = $("audio");

const el = {
  title: $("playlistTitle"), desc: $("playlistDescription"), songs: $("songs"), empty: $("empty"),
  count: $("count"), side: $("sideCount"), search: $("search"), cover: $("cover"), fallback: $("coverFallback"),
  nowTitle: $("nowTitle"), nowArtist: $("nowArtist"), play: $("play"), progress: $("progress"),
  elapsed: $("elapsed"), total: $("total"), volume: $("volume"), shuffle: $("shuffle"), repeat: $("repeat"),
  shuffleAll: $("shuffleAll"), toast: $("toast")
};

function fmt(s) {
  if (!Number.isFinite(s)) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

function base() { return state.data[state.playlist]; }

async function loadManifest(key) {
  try {
    const r = await fetch(CONFIG[key].manifest + "?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    state.data[key] = Array.isArray(j) ? j : (j.tracks || []);
  } catch (e) {
    state.data[key] = [];
    console.warn("No se pudo cargar", CONFIG[key].manifest, e);
  }
}

/* ---------- ONLINE: búsqueda vía Deezer (JSONP, sin backend, sin API key) ---------- */

let jsonpCounter = 0;
function jsonpRequest(url) {
  return new Promise((resolve, reject) => {
    const cbName = "deezerCb" + (++jsonpCounter);
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => { delete window[cbName]; script.remove(); };
    window[cbName] = data => { done = true; cleanup(); resolve(data); };
    script.onerror = () => { if (!done) { cleanup(); reject(new Error("jsonp error")); } };
    script.src = url + (url.includes("?") ? "&" : "?") + "output=jsonp&callback=" + cbName;
    document.body.appendChild(script);
    setTimeout(() => { if (!done) { cleanup(); reject(new Error("timeout")); } }, 8000);
  });
}

let searchTimer = null;
let searchToken = 0;

async function onlineSearch(query) {
  const myToken = ++searchToken;
  if (!query) { state.data.online = []; state.onlineStatus = "idle"; render(); return; }

  state.onlineStatus = "loading";
  render();

  try {
    const url = "https://api.deezer.com/search?limit=25&q=" + encodeURIComponent(query);
    const data = await jsonpRequest(url);
    if (myToken !== searchToken) return;
    if (data.error) throw new Error(data.error.message || "Deezer error");

    const list = Array.isArray(data.data) ? data.data : [];
    state.data.online = list
      .map(t => ({
        title: t.title,
        artist: t.artist ? t.artist.name : "Artista desconocido",
        album: t.album ? t.album.title : "",
        cover: t.album ? (t.album.cover_medium || t.album.cover) : "",
        duration: t.duration,
        audio: t.preview
      }))
      .filter(t => t.audio);
    state.onlineStatus = state.data.online.length ? "ok" : "empty";
  } catch (e) {
    if (myToken !== searchToken) return;
    console.warn("Error búsqueda ONLINE", e);
    state.data.online = [];
    state.onlineStatus = "error";
  }
  render();
}

/* ---------- fin bloque ONLINE ---------- */

async function switchPlaylist(key) {
  if (audio.src) { audio.pause(); audio.removeAttribute("src"); }
  state.playlist = key;
  state.current = -1;
  el.title.textContent = CONFIG[key].name;
  el.desc.textContent = CONFIG[key].desc;
  el.search.value = "";

  if (key === "online") {
    el.search.placeholder = "Buscar canción, artista...";
    state.data.online = [];
    state.onlineStatus = "idle";
  } else {
    el.search.placeholder = "Buscar canción o artista...";
    await loadManifest(key);
  }
  render();
}

function render() {
  const list = base();
  const online = state.playlist === "online";
  const q = el.search.value.trim().toLowerCase();
  const filtered = online ? list : list.filter(s => !q || [s.title, s.artist, s.album].join(" ").toLowerCase().includes(q));

  el.count.textContent = `${filtered.length} canciones`;
  el.side.textContent = `${state.data.jorge.length + state.data.djgeeorge.length} canciones`;

  if (online) {
    const status = state.onlineStatus;
    const note = el.empty.querySelector(".empty-note");
    const desc = el.empty.querySelector("p");
    if (status === "loading") { el.empty.style.display = "block"; note.textContent = "Buscando..."; desc.textContent = ""; }
    else if (status === "error") { el.empty.style.display = "block"; note.textContent = "Error al buscar"; desc.textContent = "Inténtalo de nuevo en unos segundos."; }
    else if (status === "empty") { el.empty.style.display = "block"; note.textContent = "Sin resultados"; desc.textContent = "Prueba con otro título o artista."; }
    else if (status === "idle") { el.empty.style.display = filtered.length ? "none" : "block"; note.textContent = "Busca música online"; desc.textContent = "Escribe un título o artista arriba (previews de 30s)."; }
    else { el.empty.style.display = filtered.length ? "none" : "block"; }
  } else {
    el.empty.style.display = list.length ? "none" : "block";
    el.empty.querySelector(".empty-note").textContent = "No hay canciones en esta playlist";
    el.empty.querySelector("p").textContent = 'Mete MP3 en la carpeta "music" correspondiente y ejecuta ACTUALIZAR_BIBLIOTECA.command';
  }

  el.songs.innerHTML = filtered.map((s, i) => {
    const realIndex = list.indexOf(s);
    const active = realIndex === state.current;
    return `<div class="song ${active ? "active" : ""}" data-i="${realIndex}">
      <div class="num">${active && !audio.paused ? "▶" : i + 1}</div>
      <div class="song-main">
        ${s.cover ? `<img class="thumb" src="${esc(s.cover)}" alt="">` : `<div class="thumb"></div>`}
        <div>
          <div class="song-title">${esc(s.title)}</div>
          <div class="song-artist">${esc(s.artist || "Artista desconocido")}</div>
        </div>
      </div>
      <div class="album">${esc(s.album || "")}</div>
      <div class="song-time">${s.duration ? fmt(Number(s.duration)) : "—"}</div>
    </div>`;
  }).join("");

  el.songs.querySelectorAll(".song").forEach(x => x.onclick = () => load(Number(x.dataset.i), true));
}

function load(i, auto = false) {
  const s = base()[i];
  if (!s) return;
  state.current = i;
  audio.src = s.audio;
  el.nowTitle.textContent = s.title;
  el.nowArtist.textContent = s.artist || "Artista desconocido";
  el.progress.value = 0;
  el.elapsed.textContent = "0:00";
  el.total.textContent = s.duration ? fmt(Number(s.duration)) : "0:00";

  if (s.cover) {
    el.cover.src = s.cover;
    el.cover.style.display = "block";
    el.fallback.style.display = "none";
  } else {
    el.cover.style.display = "none";
    el.fallback.style.display = "flex";
  }

  render();
  if (auto) play();
}

async function play() {
  if (state.current < 0 && base().length) load(0);
  try { await audio.play(); }
  catch { show("Pulsa ▶ para iniciar la reproducción."); }
}

function next() {
  const l = base();
  if (!l.length) return;
  let i;
  if (state.shuffle && l.length > 1) {
    do { i = Math.floor(Math.random() * l.length); } while (i === state.current);
  } else {
    i = (state.current + 1) % l.length;
  }
  load(i, true);
}

function prev() {
  if (!base().length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  load((state.current - 1 + base().length) % base().length, true);
}

function show(m) {
  el.toast.textContent = m;
  el.toast.classList.add("show");
  clearTimeout(show.t);
  show.t = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

document.querySelectorAll(".nav-item").forEach(b => b.onclick = async () => {
  document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  await switchPlaylist(b.dataset.playlist);
});

el.search.oninput = () => {
  if (state.playlist === "online") {
    clearTimeout(searchTimer);
    const q = el.search.value.trim();
    searchTimer = setTimeout(() => onlineSearch(q), 450);
  } else {
    render();
  }
};

el.play.onclick = () => audio.paused ? play() : audio.pause();
$("next").onclick = next;
$("prev").onclick = prev;

el.shuffle.onclick = () => { state.shuffle = !state.shuffle; el.shuffle.classList.toggle("active", state.shuffle); };
el.repeat.onclick = () => { state.repeat = !state.repeat; el.repeat.classList.toggle("active", state.repeat); };
el.shuffleAll.onclick = () => {
  state.shuffle = true;
  el.shuffle.classList.add("active");
  if (base().length) load(Math.floor(Math.random() * base().length), true);
};

el.progress.oninput = () => { if (Number.isFinite(audio.duration)) audio.currentTime = (Number(el.progress.value) / 1000) * audio.duration; };
el.volume.oninput = () => audio.volume = Number(el.volume.value);
audio.volume = 0.85;

audio.onloadedmetadata = () => el.total.textContent = fmt(audio.duration);
audio.ontimeupdate =
