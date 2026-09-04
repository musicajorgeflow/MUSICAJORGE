#!/usr/bin/env python3
"""
ACTUALIZAR_TODO — SOLO GENERACION DE JSON

Este script hace UNA sola cosa: leer los archivos de audio que ya
tienes en music/ dentro de cada playlist y (re)generar el
library.json correspondiente con la informacion que tu web
necesita (titulo, artista, album, duracion, caratula y ruta al
archivo de audio).

NO copia, mueve, borra ni convierte audio.
NO toca Cloudflare / R2.
NO toca Git / GitHub.
NO modifica HTML/CSS/JS.

Uso: doble clic en ACTUALIZAR_TODO.command (este script no se
ejecuta directamente).
"""
from pathlib import Path
from urllib.parse import quote
import base64
import json
import re
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
AUDIO_EXT = {".mp3", ".m4a", ".flac", ".wav", ".aac", ".ogg", ".opus"}
COVER_EXT = {".jpg", ".jpeg", ".png", ".webp"}
PLAYLISTS = ["playlist_jorge", "playlist_djgeeorge", "playlist_pedidas"]

# De donde se leen los audios de cada playlist, relativo a su carpeta.
# "" significa: directamente dentro de playlist_xxx/ (sin subcarpeta music/).
AUDIO_SOURCE = {
    "playlist_jorge": "music",
    "playlist_djgeeorge": "",
    "playlist_pedidas": "music",
}

# Playlists que usan UNA sola caratula fija para todas sus canciones,
# en vez de sacar la caratula de cada archivo de audio.
FIXED_COVER_PLAYLISTS = {"playlist_djgeeorge"}

# Nombres de archivo que se buscan (en ese orden) dentro de
# playlist_xxx/covers/ para las playlists de caratula fija.
FIXED_COVER_CANDIDATES = [
    "portada.jpg", "portada.jpeg", "portada.png",
    "cover.jpg", "cover.jpeg", "cover.png",
]

# Archivos basura que nunca deben contarse ni generar caratulas/ruido
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}


def ensure(package, import_name=None):
    import_name = import_name or package
    try:
        __import__(import_name)
    except ImportError:
        print(f"Instalando '{package}' (solo la primera vez)...")
        subprocess.run([sys.executable, "-m", "pip", "install", "--user", package], check=True)


ensure("mutagen")
from mutagen import File
from mutagen.id3 import ID3
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4
from mutagen.wave import WAVE


# ---------- utilidades ----------

def is_junk(path: Path) -> bool:
    return path.name.lower() in JUNK_NAMES or path.name.startswith("._")


def first(tags, key, default=""):
    if tags is None:
        return default
    try:
        v = tags.get(key)
    except Exception:
        return default
    if not v:
        return default
    if isinstance(v, list):
        v = v[0]
    return str(v)


def safe_stem(stem):
    return re.sub(r'[\\/:*?"<>|]', "_", stem)


def save_bytes(data, mime, out_dir, stem):
    ext = ".png" if "png" in (mime or "").lower() else ".jpg"
    out = out_dir / (safe_stem(stem) + ext)
    out.write_bytes(data)
    return out


# ---------- caratulas ----------

def cover_from_id3_frames(id3_tags, out_dir, stem):
    if id3_tags is None:
        return None
    try:
        pics = id3_tags.getall("APIC")
        if pics:
            pic = pics[0]
            return save_bytes(pic.data, pic.mime, out_dir, stem)
    except Exception:
        pass
    return None


def extract_cover(path, out_dir):
    ext = path.suffix.lower()
    stem = path.stem

    if ext == ".mp3":
        try:
            return cover_from_id3_frames(ID3(path), out_dir, stem)
        except Exception:
            return None
    if ext == ".wav":
        try:
            return cover_from_id3_frames(WAVE(path).tags, out_dir, stem)
        except Exception:
            return None
    if ext == ".flac":
        try:
            f = FLAC(path)
            if f.pictures:
                pic = f.pictures[0]
                return save_bytes(pic.data, pic.mime, out_dir, stem)
        except Exception:
            pass
        return None
    if ext in (".m4a", ".aac"):
        try:
            f = MP4(path)
            covr = f.tags.get("covr") if f.tags else None
            if covr:
                data = covr[0]
                mime = "image/png" if bytes(data[:8]).startswith(b"\x89PNG") else "image/jpeg"
                return save_bytes(bytes(data), mime, out_dir, stem)
        except Exception:
            pass
        return None
    if ext in (".ogg", ".opus"):
        try:
            f = File(path)
            tags = getattr(f, "tags", None) or {}
            raw = tags.get("metadata_block_picture") or tags.get("METADATA_BLOCK_PICTURE")
            if raw:
                pic = Picture(base64.b64decode(raw[0]))
                return save_bytes(pic.data, pic.mime, out_dir, stem)
        except Exception:
            pass
        return None
    return None


def find_manual_cover(covers_dir, stem):
    """Si el audio no trae caratula embebida, reutiliza una puesta a mano
    en covers/ con el mismo nombre (sin distinguir mayusculas/acentos)."""
    stem_key = unicodedata.normalize("NFC", stem).casefold()
    for candidate in covers_dir.iterdir():
        if not candidate.is_file() or is_junk(candidate):
            continue
        if candidate.suffix.lower() not in COVER_EXT:
            continue
        if unicodedata.normalize("NFC", candidate.stem).casefold() == stem_key:
            return candidate
    return None


def find_fixed_cover(covers_dir):
    """Para playlists de caratula fija (p.ej. DJGEEORGE): busca una imagen
    con nombre conocido (portada.jpg, cover.jpg, etc.) en covers/. Si no
    hay ninguna con esos nombres pero hay EXACTAMENTE una imagen suelta
    en la carpeta, se usa esa."""
    if not covers_dir.exists():
        return None
    for name in FIXED_COVER_CANDIDATES:
        p = covers_dir / name
        if p.exists() and p.is_file():
            return p
    imgs = [
        p for p in covers_dir.iterdir()
        if p.is_file() and not is_junk(p) and p.suffix.lower() in COVER_EXT
    ]
    if len(imgs) == 1:
        return imgs[0]
    return None


def fetch_itunes_cover(title, artist, out_dir, stem):
    """Ultimo recurso: busca una caratula publica en iTunes si no hay
    ninguna embebida ni puesta a mano. No sube nada a ningun sitio,
    solo descarga una imagen para guardarla en covers/."""
    import urllib.parse
    import urllib.request
    try:
        term = urllib.parse.quote(f"{artist} {title}")
        url = f"https://itunes.apple.com/search?term={term}&entity=song&limit=1"
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        results = data.get("results") or []
        if not results or not results[0].get("artworkUrl100"):
            return None
        art_url = results[0]["artworkUrl100"].replace("100x100bb", "600x600bb")
        with urllib.request.urlopen(art_url, timeout=10) as resp:
            data = resp.read()
        return save_bytes(data, "image/jpeg", out_dir, stem)
    except Exception as e:
        print(f"    (sin caratula automatica para '{title}': {e})")
        return None


# ---------- generacion de un library.json ----------

def generate_library(folder):
    playlist_dir = ROOT / folder
    source_sub = AUDIO_SOURCE.get(folder, "music")
    music = playlist_dir / source_sub if source_sub else playlist_dir
    covers = playlist_dir / "covers"

    if not music.exists():
        print(f"  [!] {folder}: no existe la carpeta '{music.relative_to(ROOT)}', se omite.")
        return 0

    covers.mkdir(parents=True, exist_ok=True)

    fixed_cover = None
    if folder in FIXED_COVER_PLAYLISTS:
        fixed_cover = find_fixed_cover(covers)
        if fixed_cover:
            print(f"   Caratula fija para todas las canciones: {fixed_cover.name}")
        else:
            candidatos = ", ".join(FIXED_COVER_CANDIDATES[:3])
            print(f"   [!] No hay caratula fija en {covers.relative_to(ROOT)}/.")
            print(f"       Pon ahi una imagen llamada '{candidatos.split(', ')[0]}' (o similar: {candidatos}).")

    def path_is_inside_covers(p):
        # Nunca leer audio dentro de la carpeta covers/, aunque este anidada.
        rel_parts = p.relative_to(playlist_dir).parts
        return any(part.lower() == "covers" for part in rel_parts[:-1])

    audio_files = sorted(
        (
            p for p in music.rglob("*")
            if p.is_file() and not is_junk(p) and p.suffix.lower() in AUDIO_EXT
            and not path_is_inside_covers(p)
        ),
        key=lambda x: x.name.lower(),
    )

    tracks = []
    for path in audio_files:
        try:
            f_easy = File(path, easy=True)
            title = (first(f_easy, "title") or path.stem).strip()
            artist = (first(f_easy, "artist") or "Artista desconocido").strip()
            album = first(f_easy, "album").strip()
            duration = float(getattr(getattr(f_easy, "info", None), "length", 0) or 0)
        except Exception:
            title, artist, album, duration = path.stem, "Artista desconocido", "", 0.0

        if folder in FIXED_COVER_PLAYLISTS:
            # Nunca se saca caratula individual de cada mp3 en esta playlist:
            # todas comparten la misma imagen (o ninguna, si aun no la has puesto).
            cover = fixed_cover
        else:
            cover = extract_cover(path, covers)
            if cover is None:
                cover = find_manual_cover(covers, path.stem)
            if cover is None:
                cover = fetch_itunes_cover(title, artist, covers, path.stem)

        rel = lambda p: str(p.relative_to(ROOT)).replace("\\", "/")
        # Igual que la ruta remota, la ruta local tambien se escapa con
        # percent-encoding para que nombres con "#", "&", "?", "%", etc.
        # no rompan la URL dentro de la web.
        audio_field = quote(rel(path), safe="/")

        tracks.append({
            "title": title,
            "artist": artist,
            "album": album,
            "audio": audio_field,
            "cover": quote(rel(cover), safe="/") if cover else "",
            "duration": round(duration, 2),
        })

    (ROOT / folder / "library.json").write_text(
        json.dumps(tracks, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return len(tracks)


if __name__ == "__main__":
    print("Generando/actualizando los archivos library.json...\n")

    resumen = []
    for folder in PLAYLISTS:
        origen = AUDIO_SOURCE.get(folder, "music") or "(carpeta raiz de la playlist)"
        print(f"-> {folder}/library.json   (leyendo audio de: {origen})")
        n = generate_library(folder)
        print(f"   {n} cancion(es) encontrada(s).\n")
        resumen.append((folder, n))

    print("=" * 40)
    print("RESUMEN")
    print("=" * 40)
    total = 0
    for folder, n in resumen:
        print(f"  {folder}: {n} cancion(es) -> {folder}/library.json")
        total += n
    print(f"\nTotal: {total} cancion(es) en {len(resumen)} playlist(s).")
    print("\nListo. Solo se han generado/actualizado los JSON.")
    print("Nada de audio, imagenes, Git ni Cloudflare ha sido tocado.")
