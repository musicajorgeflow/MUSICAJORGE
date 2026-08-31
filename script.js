const CONFIG = {
  jorge: { name: "PLAYLIST JORGE", desc: "Tu mÃºsica personal", manifest: "playlist_jorge/library.json" },
  djgeeorge: { name: "DJGEEORGE", desc: "Mashups, edits y producciones de DJGEEORGE", manifest: "playlist_djgeeorge/library.json" }
};

const state = { playlist: "jorge", data: { jorge: [], djgeeorge: [] }, current: -1, shuffle: false, repeat: false };

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

async function switchPlaylist(key) {
  if (audio.src) { audio.pause(); audio.removeAttribute("src"); }
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
  el.side.textContent = `${state.data.jorge.length + state.data.djgeeorge.length} canciones`;
  el.empty.style.display = list.length ? "none" : "block";

  el.songs.innerHTML = filtered.map((s, i) => {
    const realIndex = list.indexOf(s);
    const active = realIndex === state.current;
    return `<div class="song ${active ? "active" : ""}" data-i="${realIndex}">
      <div class="num">${active && !audio.paused ? "â–¶" : i + 1}</div>
      <div class="song-main">
        ${s.cover ? `<img class="thumb" src="${esc(s.cover)}" alt="">` : `<div class="thumb"></div>`}
        <div>
          <div class="song-title">${esc(s.title)}</div>
          <div class="song-artist">${esc(s.artist || "Artista desconocido")}</div>
        </div>
      </div>
      <div class="album">${esc(s.album || "")}</div>
      <div class="song-time">${s.duration ? fmt(Number(s.duration)) : "â€”"}</div>
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
  catch { show("Pulsa â–¶ para iniciar la reproducciÃ³n."); }
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

el.search.oninput = render;
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
audio.ontimeupdate = () => {
  if (Number.isFinite(audio.duration)) {
    el.progress.value = Math.round((audio.currentTime / audio.duration) * 1000);
    el.elapsed.textContent = fmt(audio.currentTime);
  }
};
audio.onplay = () => { el.play.textContent = "â…¡"; render(); };
audio.onpause = () => { el.play.textContent = "â–¶"; render(); };
audio.onended = () => state.repeat ? (audio.currentTime = 0, play()) : next();

document.onkeydown = e => {
  if (e.target.matches("input")) return;
  if (e.code === "Space") { e.preventDefault(); audio.paused ? play() : audio.pause(); }
};

(async () => {
  await loadManifest("jorge");
  await loadManifest("djgeeorge");
  render();
})();
