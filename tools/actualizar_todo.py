#!/usr/bin/env python3
"""
UN SOLO SCRIPT que hace todo el trabajo:

  1. Lee tus MP3/WAV/FLAC/M4A/OGG de music/, saca titulo, artista,
     album, duracion y caratula, y genera library.json.
  2. Si tools/config.json tiene las claves de Cloudflare R2 rellenas,
     sube automaticamente el audio nuevo o modificado al bucket
     (usando la API, sin necesidad de entrar a la web de Cloudflare).
  3. Si esta carpeta es un repositorio git ya conectado a GitHub,
     hace commit y push automaticamente de los cambios de la web
     (library.json, caratulas, codigo) — nunca del audio, que se
     queda excluido por .gitignore.

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

ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "tools" / ".upload_state.json"
AUDIO_EXT = {".mp3", ".m4a", ".flac", ".wav", ".aac", ".ogg", ".opus"}


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


# ---------- metadatos y caratulas ----------

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


def load_config():
    cfg_path = ROOT / "tools" / "config.json"
    default = {
        "r2": {"account_id": "", "access_key_id": "", "secret_access_key": "", "bucket": "", "public_base_url": ""},
        "jorge": {"r2_folder": "jorge"},
        "djgeeorge": {"r2_folder": "djgeeorge"},
        "pedidas": {"r2_folder": "pedidas"},
    }
    if not cfg_path.exists():
        return default
    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
        for k, v in default.items():
            data.setdefault(k, v)
        return data
    except Exception:
        return default


def r2_ready(cfg):
    r2 = cfg.get("r2", {})
    return all(r2.get(k) for k in ("account_id", "access_key_id", "secret_access_key", "bucket", "public_base_url"))


def generate_library(folder, r2_folder, cfg):
    music = ROOT / folder / "music"
    covers = ROOT / folder / "covers"
    covers.mkdir(parents=True, exist_ok=True)
    music.mkdir(parents=True, exist_ok=True)

    remote = r2_ready(cfg)
    base_url = ""
    if remote:
        base_url = cfg["r2"]["public_base_url"].rstrip("/") + "/" + r2_folder.strip("/") + "/"

    tracks = []
    for path in sorted(music.rglob("*"), key=lambda x: x.name.lower()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
            continue
        try:
            f_easy = File(path, easy=True)
            title = (first(f_easy, "title") or path.stem).strip()
            artist = (first(f_easy, "artist") or "Artista desconocido").strip()
            album = first(f_easy, "album").strip()
            duration = float(getattr(getattr(f_easy, "info", None), "length", 0) or 0)
        except Exception:
            title, artist, album, duration = path.stem, "Artista desconocido", "", 0.0

        cover = extract_cover(path, covers)
        rel = lambda p: str(p.relative_to(ROOT)).replace("\\", "/")
        # IMPORTANT: local (relative) paths must be percent-encoded too, exactly
        # like the remote R2 URL already is. Without this, filenames containing
        # characters such as "#", "?", "%" or "&" produce broken URLs (a "#"
        # gets treated as a fragment and cuts the URL short, etc.), which is
        # why some songs would load with no audio and/or no cover art.
        audio_field = (base_url + quote(path.name)) if remote else quote(rel(path), safe="/")

        tracks.append({
            "title": title, "artist": artist, "album": album,
            "audio": audio_field,
            "cover": quote(rel(cover), safe="/") if cover else "",
            "duration": round(duration, 2),
        })

    (ROOT / folder / "library.json").write_text(json.dumps(tracks, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {folder}: {len(tracks)} canciones")
    return remote


# ---------- subida a Cloudflare R2 ----------

def load_state():
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def upload_audio(cfg):
    if not r2_ready(cfg):
        print("\nCloudflare R2 no esta configurado todavia (tools/config.json).")
        print("El audio se ha dejado apuntando a rutas locales.")
        return

    ensure("boto3")
    import boto3

    r2 = cfg["r2"]
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{r2['account_id']}.r2.cloudflarestorage.com",
        aws_access_key_id=r2["access_key_id"],
        aws_secret_access_key=r2["secret_access_key"],
    )

    state = load_state()
    subido = 0
    for folder, key in (("playlist_jorge", "jorge"), ("playlist_djgeeorge", "djgeeorge"), ("playlist_pedidas", "pedidas")):
        r2_folder = cfg[key]["r2_folder"].strip("/")
        music = ROOT / folder / "music"
        for path in sorted(music.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
                continue
            rel = str(path.relative_to(ROOT))
            sig = f"{path.stat().st_size}-{int(path.stat().st_mtime)}"
            if state.get(rel) == sig:
                continue  # ya subido y sin cambios
            object_key = f"{r2_folder}/{path.name}" if r2_folder else path.name
            print(f"  Subiendo: {path.name}")
            client.upload_file(str(path), r2["bucket"], object_key)
            state[rel] = sig
            subido += 1

    save_state(state)
    print(f"\n{subido} archivo(s) de audio subido(s) a Cloudflare R2." if subido else "\nEl audio ya estaba subido, sin cambios.")


# ---------- git commit + push ----------

def git_publish():
    if not (ROOT / ".git").exists():
        print("\nEsta carpeta todavia no es un repositorio de GitHub.")
        print("Publicala una primera vez con GitHub Desktop y luego este")
        print("script ya podra subir los cambios automaticamente.")
        return
    try:
        subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
        diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
        if diff.returncode == 0:
            print("\nSin cambios que subir a GitHub.")
            return
        subprocess.run(["git", "commit", "-m", "Actualizar biblioteca"], cwd=ROOT, check=True)
        subprocess.run(["git", "push"], cwd=ROOT, check=True)
        print("\nCambios subidos a GitHub. La web publicada se actualizara en un par de minutos.")
    except FileNotFoundError:
        print("\nNo se encontro git en este Mac. Instala 'Herramientas de linea de comandos'")
        print("de Xcode (te lo pedira macOS) o usa GitHub Desktop manualmente.")
    except subprocess.CalledProcessError as e:
        print("\nNo se pudo subir a GitHub automaticamente:", e)
        print("Puedes hacerlo a mano abriendo GitHub Desktop.")


if __name__ == "__main__":
    cfg = load_config()

    print("1) Leyendo canciones y generando library.json...")
    generate_library("playlist_jorge", cfg["jorge"]["r2_folder"], cfg)
    generate_library("playlist_djgeeorge", cfg["djgeeorge"]["r2_folder"], cfg)
    generate_library("playlist_pedidas", cfg["pedidas"]["r2_folder"], cfg)

    print("\n2) Subiendo audio nuevo a Cloudflare R2...")
    upload_audio(cfg)

    print("\n3) Subiendo cambios a GitHub...")
    git_publish()

    print("\nListo. Todo actualizado.")
