const CONFIG = {
  jorge: { name: "PLAYLIST JORGE", desc: "Tu música personal", manifest: "playlist_jorge/library.json" },
  djgeeorge: { name: "DJGEEORGE", desc: "Mashups, edits y producciones de DJGEEORGE", manifest: "playlist_djgeeorge/library.json" },
  pedidas: { name: "PEDIDAS", desc: "Canciones pedidas por la gente", manifest: "playlist_pedidas/library.json" }
};

const REQUEST_CONFIG = {
  // Static GitHub Pages cannot safely send email by itself. FormSubmit acts as
  // the tiny mail gateway: each request is delivered to this inbox.
  // NOTE: the very first submission after (re)configuring this address will
  // make FormSubmit send a one-time "confirm your email" message to it; that
  // confirmation link must be clicked once before requests start arriving.
  endpoint: "https://formsubmit.co/jorgebolearomero@gmail.com",
};

// This is a client-side access gate (GitHub Pages is static). It keeps the
// playlist out of the normal UI, but it is NOT cryptographic protection of the
// audio files themselves. The password is checked as a SHA-256 digest.
const JORGE_PASSWORD_HASH = "fd8be61e0218181b7ac698c13f789dd8a1c89598e49eaffde20fb0f4bfda8ee4";

const state = {
  playlist: "jorge",
  data: { jorge: [], djgeeorge: [], pedidas: [] },
  current: -1,
  currentTrack: null,
  shuffle: false,
  repeat: false,
  queue: [],
  queueIndex: 0
};

const $ = id => document.getElementById(id);
const audio = $("audio");
const el = {
  title: $("playlistTitle"), desc: $("playlistDescription"), songs: $("songs"), empty: $("empty"),
  count: $("count"), side: $("sideCount"), search: $("search"), cover: $("cover"), fallback: $("coverFallback"),
  nowTitle: $("nowTitle"), nowArtist: $("nowArtist"), play: $("play"), progress: $("progress"),
  elapsed: $("elapsed"), total: $("total"), volume: $("volume"), shuffle: $("shuffle"), repeat: $("repeat"),
  shuffleAll: $("shuffleAll"), toast: $("toast"), queueButton: $("queueButton"), queueCount: $("queueCount"),
  queuePanel: $("queuePanel"), queueList: $("queueList"), queueEmpty: $("queueEmpty"),
  requestPanel: $("requestPanel"), requestSearch: $("requestSearch"), requestResults: $("requestResults"),
  manualRequest: $("manualRequest"), sendRequest: $("sendRequest"), requestStatus: $("requestStatus"),
  passwordModal: $("passwordModal"), passwordForm: $("passwordForm"), passwordInput: $("playlistPassword"),
  passwordError: $("passwordError"), passwordCancel: $("passwordCancel"),
  playerError: $("playerError"), playerErrorMsg: $("playerErrorMsg"),
  retryTrack: $("retryTrack"), skipError: $("skipError"),
  welcomeScreen: $("welcomeScreen")
};

function hideWelcome() { el.welcomeScreen.hidden = true; }

const ICON = { play: "\u25B6", pause: "\u2161", note: "\u266A" };

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

async function switchPlaylist(key) {
  // IMPORTANT: changing the library must not touch the shared audio element.
  // The current song keeps playing while the user browses another playlist.
  state.playlist = key;
  state.current = -1;
  el.title.textContent = CONFIG[key].name;
  el.desc.textContent = CONFIG[key].desc;
  el.search.value = "";
  await loadManifest(key);
  render();
}

function render() {
  const list = base();
  const q = el.search.value.trim().toLowerCase();
  const filtered = list.filter(s => !q || [s.title, s.artist, s.album].join(" ").toLowerCase().includes(q));

  el.count.textContent = `${filtered.length} canciones`;
  el.side.textContent = `${state.data.jorge.length + state.data.djgeeorge.length + state.data.pedidas.length} canciones`;
  el.empty.style.display = list.length ? "none" : "block";

  el.songs.innerHTML = filtered.map((s, i) => {
    const realIndex = list.indexOf(s);
    const active = state.currentTrack === s && !audio.paused;
    return `<div class="song ${active ? "active" : ""}" data-i="${realIndex}">
      <div class="num">${active ? ICON.play : i + 1}</div>
      <div class="song-main">
        ${s.cover ? `<img class="thumb" src="${esc(s.cover)}" alt="" onerror="this.outerHTML='<div class=&quot;thumb cover-missing&quot;>♫</div>'">` : `<div class="thumb cover-missing">♫</div>`}
        <div>
          <div class="song-title">${esc(s.title)}</div>
          <div class="song-artist">${esc(s.artist || "Artista desconocido")}</div>
        </div>
      </div>
      <div class="album">${esc(s.album || "")}</div>
      <div class="song-time">${s.duration ? fmt(Number(s.duration)) : "—"}</div>
      <button class="song-next" data-next="${realIndex}" title="Reproducir siguiente">+ SIGUIENTE</button>
    </div>`;
  }).join("");

  el.songs.querySelectorAll(".song").forEach(x => x.onclick = e => {
    if (e.target.closest(".song-next")) return;
    load(Number(x.dataset.i), true);
  });
  el.songs.querySelectorAll(".song-next").forEach(b => b.onclick = e => {
    e.stopPropagation();
    addNext(Number(b.dataset.next));
  });
  renderQueue();
}

function setNow(track) {
  el.nowTitle.textContent = track.title;
  el.nowArtist.textContent = track.artist || "Artista desconocido";
  el.progress.value = 0;
  el.elapsed.textContent = "0:00";
  el.total.textContent = track.duration ? fmt(Number(track.duration)) : "0:00";
  if (track.cover) {
    el.cover.onerror = () => {
      el.cover.style.display = "none";
      el.fallback.style.display = "flex";
    };
    el.cover.src = track.cover;
    el.cover.style.display = "block";
    el.fallback.style.display = "none";
  } else {
    el.cover.style.display = "none";
    el.fallback.style.display = "flex";
  }
}

function load(i, auto = false) {
  const s = base()[i];
  if (!s) return;
  state.current = i;
  state.currentTrack = s;
  hidePlaybackError();
  audio.src = s.audio;
  setNow(s);
  render();
  if (auto) play();
}

function play() {
  if (!audio.src && state.currentTrack) audio.src = state.currentTrack.audio;
  if (!audio.src && base().length) load(0);
  audio.play().catch(() => show(`Pulsa ${ICON.play} para iniciar la reproducción.`));
}

function addNext(i) {
  const s = base()[i];
  if (!s) return;
  state.queue.push(s);
  renderQueue();
  show(`"${s.title}" añadida a la cola`);
}

function removeQueue(i) {
  state.queue.splice(i, 1);
  renderQueue();
}
function renderQueue() {
  el.queueCount.textContent = state.queue.length;
  el.queueList.innerHTML = state.queue.map((s, i) => `
    <div class="queue-item">
      <img src="${esc(s.cover || "")}" onerror="this.style.display='none'" alt="">
      <div class="queue-meta"><strong>${esc(s.title)}</strong><span>${esc(s.artist || "")}</span></div>
      <button data-playqueue="${i}" title="Reproducir ahora">&#9654;</button>
      <button data-removequeue="${i}" title="Quitar">×</button>
    </div>`).join("");
  el.queueEmpty.style.display = state.queue.length ? "none" : "block";
  el.queueList.querySelectorAll("[data-playqueue]").forEach(b => b.onclick = () => playQueue(Number(b.dataset.playqueue)));
  el.queueList.querySelectorAll("[data-removequeue]").forEach(b => b.onclick = () => removeQueue(Number(b.dataset.removequeue)));
}

function playQueue(i) {
  const s = state.queue[i];
  if (!s) return;
  state.queue.splice(i, 1);
  state.currentTrack = s;
  state.current = base().indexOf(s);
  audio.src = s.audio;
  setNow(s);
  renderQueue();
  render();
  play();
}

function next() {
  if (state.queue.length) return playQueue(0);
  const l = base();
  if (!l.length) return;
  let i;
  if (state.shuffle && l.length > 1) {
    do { i = Math.floor(Math.random() * l.length); } while (l[i] === state.currentTrack);
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

function openRequests() {
  el.requestPanel.hidden = false;
  el.requestSearch.focus();
  renderRequestResults();
}
function closeRequests() { el.requestPanel.hidden = true; }

async function searchRequests() {
  const q = el.requestSearch.value.trim();
  if (!q) return renderRequestResults([]);
  // iTunes Search API is used only as a public music catalogue/search source.
  try {
    const r = await fetch("https://itunes.apple.com/search?term=" + encodeURIComponent(q) + "&entity=song&limit=8");
    const j = await r.json();
    renderRequestResults(j.results || []);
  } catch {
    renderRequestResults([]);
    el.requestStatus.textContent = "No se pudo consultar el buscador. Puedes escribir la petición manualmente.";
  }
}
function renderRequestResults(results) {
  if (!el.requestResults) return;
  if (!results || !results.length) {
    el.requestResults.innerHTML = "";
    return;
  }
  el.requestResults.innerHTML = results.map(r => `
    <button class="request-result" data-request="${esc(r.trackName)} — ${esc(r.artistName)}">
      <img src="${esc(r.artworkUrl100 || "")}" alt="">
      <span><strong>${esc(r.trackName)}</strong><small>${esc(r.artistName)}${r.collectionName ? " · " + esc(r.collectionName) : ""}</small></span>
      <b>PEDIR</b>
    </button>`).join("");
  el.requestResults.querySelectorAll(".request-result").forEach(b => b.onclick = () => submitRequest(b.dataset.request));
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function backupRequestLocally(text) {
  // Backup ONLY: used solely so a failed send is never silently lost. The
  // real delivery is always the external FormSubmit request above.
  try {
    const key = "jorgeflow_pending_requests";
    const pending = JSON.parse(localStorage.getItem(key) || "[]");
    pending.push({ text, date: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(pending));
  } catch (e) {
    console.warn("No se pudo guardar la petición de respaldo en localStorage", e);
  }
}

async function submitRequest(text) {
  text = String(text || "").trim();
  if (!text) return show("Escribe o selecciona una canción.");
  el.requestStatus.textContent = "Enviando petición...";
  el.requestStatus.classList.remove("is-error", "is-ok");
  el.sendRequest.disabled = true;

  try {
    const r = await fetch(REQUEST_CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        _subject: "🎵 Nueva petición — JORGEFLOW PLAYER",
        request: text,
        date: new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }),
        source: window.location.href
      })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    el.requestStatus.textContent = "✓ Petición enviada correctamente.";
    el.requestStatus.classList.add("is-ok");
    el.manualRequest.value = "";
    show("Petición enviada ✓");
  } catch (err) {
    console.error("No se pudo enviar la petición", err);
    backupRequestLocally(text);
    el.requestStatus.textContent = "Error al enviar la petición. Se ha guardado localmente; vuelve a intentarlo cuando tengas conexión.";
    el.requestStatus.classList.add("is-error");
    show("Error al enviar la petición");
  } finally {
    el.sendRequest.disabled = false;
  }
}

// The previous version called unlockJorge() directly on nav click without
// ever opening the modal, so it silently read an empty/stale password field.
// That is why re-entering JORGE after visiting another playlist did nothing.
// This version actually opens the modal and waits for the result.
let passwordResolve = null;

function openJorgePassword() {
  el.passwordModal.hidden = false;
  el.passwordInput.value = "";
  el.passwordError.textContent = "";
  setTimeout(() => el.passwordInput.focus(), 30);
  return new Promise(resolve => { passwordResolve = resolve; });
}
function closeJorgePassword(result) {
  el.passwordModal.hidden = true;
  if (passwordResolve) { passwordResolve(result); passwordResolve = null; }
}
async function tryUnlock() {
  const hash = await sha256(el.passwordInput.value);
  if (hash !== JORGE_PASSWORD_HASH) {
    el.passwordError.textContent = "Contraseña incorrecta.";
    el.passwordInput.select();
    return;
  }
  closeJorgePassword(true);
}

async function enterPlaylist(key) {
  if (key === "jorge") {
    const ok = await openJorgePassword();
    if (!ok) return;
  }
  document.querySelectorAll(".nav-item[data-playlist]").forEach(x => x.classList.toggle("active", x.dataset.playlist === key));
  closeRequests();
  hideWelcome();
  await switchPlaylist(key);
}

document.querySelectorAll(".nav-item[data-playlist]").forEach(b => b.onclick = () => enterPlaylist(b.dataset.playlist));
$("requestNav").onclick = () => {
  document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
  $("requestNav").classList.add("active");
  openRequests();
};
$("closeRequest").onclick = closeRequests;
el.search.oninput = render;
el.play.onclick = () => audio.paused ? play() : audio.pause();
$("next").onclick = next;
$("prev").onclick = prev;
el.shuffle.onclick = () => { state.shuffle = !state.shuffle; el.shuffle.classList.toggle("active", state.shuffle); };
el.repeat.onclick = () => { state.repeat = !state.repeat; el.repeat.classList.toggle("active", state.repeat); };
el.shuffleAll.onclick = () => {
  state.shuffle = true; el.shuffle.classList.add("active");
  if (base().length) load(Math.floor(Math.random() * base().length), true);
};
el.queueButton.onclick = () => { el.queuePanel.hidden = !el.queuePanel.hidden; renderQueue(); };
$("closeQueue").onclick = () => el.queuePanel.hidden = true;
el.requestSearch.oninput = searchRequests;
el.sendRequest.onclick = () => submitRequest(el.manualRequest.value);
el.passwordForm.onsubmit = async e => { e.preventDefault(); await tryUnlock(); };
el.passwordCancel.onclick = () => closeJorgePassword(false);
el.passwordModal.onclick = e => { if (e.target === el.passwordModal) closeJorgePassword(false); };
el.passwordInput.onkeydown = e => { if (e.key === "Escape") closeJorgePassword(false); };

el.progress.oninput = () => { if (Number.isFinite(audio.duration)) audio.currentTime = (Number(el.progress.value) / 1000) * audio.duration; };
el.volume.oninput = () => audio.volume = Number(el.volume.value);
audio.volume = 0.85;
audio.onloadedmetadata = () => el.total.textContent = fmt(audio.duration);
audio.ontimeupdate = () => {
  if (Number.isFinite(audio.duration)) {
    el.progress.value = Math.round((audio.currentTime / audio.duration) * 1000);
    el.elapsed.textContent = fmt(audio.currentTime);
  }
};
audio.onplay = () => { el.play.textContent = ICON.pause; hidePlaybackError(); render(); };
audio.onpause = () => { el.play.textContent = ICON.play; render(); };
audio.onended = () => state.repeat ? (audio.currentTime = 0, play()) : next();

function hidePlaybackError() {
  el.playerError.hidden = true;
}
function showPlaybackError() {
  const title = state.currentTrack ? state.currentTrack.title : "esta canción";
  el.playerErrorMsg.textContent = `No se pudo reproducir "${title}". El archivo puede no estar disponible o ha fallado la conexión.`;
  el.playerError.hidden = false;
  el.play.textContent = ICON.play;
}

// A failed track NEVER changes the song by itself: it stays on screen with a
// clear error and explicit "Reintentar" / "Siguiente canción" actions, so a
// broken file never looks like it silently skipped to something else.
audio.onerror = () => {
  if (!state.currentTrack) return;
  showPlaybackError();
};
el.retryTrack.onclick = () => {
  if (!state.currentTrack) return;
  hidePlaybackError();
  audio.src = state.currentTrack.audio;
  play();
};
el.skipError.onclick = () => {
  hidePlaybackError();
  next();
};

document.onkeydown = e => {
  if (e.target.matches("input")) return;
  if (e.code === "Space") { e.preventDefault(); audio.paused ? play() : audio.pause(); }
};

document.querySelectorAll("#welcomeScreen [data-playlist]").forEach(b => b.onclick = () => enterPlaylist(b.dataset.playlist));

(async () => {
  await Promise.all(Object.keys(CONFIG).map(loadManifest));
  // Do NOT render/reveal any playlist until the user chooses one on the
  // welcome screen — this is what used to let JORGE's songs show up on
  // load with no password prompt at all.
})();
