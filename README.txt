DJGEEORGE PLAYER — reproductor local (sin Spotify)
=====================================================

QUÉ ES
------
Una web con dos playlists independientes:
  - PLAYLIST JORGE   -> playlist_jorge/music/
  - DJGEEORGE        -> playlist_djgeeorge/music/

Lee título, artista, álbum, duración y la CARÁTULA incrustada de cada
archivo de audio (MP3, WAV, FLAC, M4A/AAC, OGG/OPUS). No hace falta
preparar imágenes a mano.

Hay UN SOLO script que se encarga de todo: leer tus canciones, subir
el audio a Cloudflare (para poder usarlo también fuera de casa) y
subir los cambios de la web a GitHub. Cada vez que tengas música
nueva: arrastras los archivos y haces doble clic. Ya está.


CONFIGURACIÓN INICIAL (una sola vez)
----------------------------------------
Esto sí hay que hacerlo una vez, porque son cuentas externas y no hay
forma de crearlas por ti. Después no lo vuelves a tocar.

A) Cloudflare R2 (aloja el audio, gratis hasta 10 GB)
   1. Crea una cuenta en cloudflare.com y entra en la sección R2.
   2. Crea un bucket, por ejemplo "djgeeorge-musica".
   3. En el bucket, activa "Public access" (r2.dev). Copia la URL
      pública que te da, algo como https://pub-XXXX.r2.dev
   4. Ve a "Manage R2 API Tokens" y crea un token con permiso de
      lectura y escritura sobre ese bucket. Apunta:
        - Access Key ID
        - Secret Access Key
        - tu Account ID (aparece en la misma pantalla)
   5. Abre tools/config.json con TextEdit y rellena:
        {
          "r2": {
            "account_id": "TU_ACCOUNT_ID",
            "access_key_id": "TU_ACCESS_KEY",
            "secret_access_key": "TU_SECRET_KEY",
            "bucket": "djgeeorge-musica",
            "public_base_url": "https://pub-XXXX.r2.dev"
          },
          "jorge": { "r2_folder": "jorge" },
          "djgeeorge": { "r2_folder": "djgeeorge" }
        }

B) GitHub (aloja la web)
   1. Crea un repositorio privado en github.com (p. ej. djgeeorge-player).
   2. Instala GitHub Desktop (desktop.github.com) e inicia sesión.
   3. File > Add Local Repository > selecciona esta carpeta
      DJGEEORGE_PLAYER > "create a repository" > "Publish repository"
      (elige el repo privado que creaste).
   4. En GitHub: Settings > Pages > Branch "main" > carpeta "/ (root)".
      Te dará la URL de tu web, tipo
      https://tu-usuario.github.io/djgeeorge-player/


USO DEL DÍA A DÍA (esto es lo único que repites)
-----------------------------------------------------
  1. Arrastra tus MP3/WAV/FLAC nuevos a
       playlist_jorge/music/       o
       playlist_djgeeorge/music/
  2. Doble clic en ACTUALIZAR_TODO.command

Ese script, sin que tengas que hacer nada más:
  - Lee título, artista, álbum, duración y carátula de cada canción.
  - Genera playlist_jorge/library.json y playlist_djgeeorge/library.json
  - Sube el audio nuevo a tu bucket de Cloudflare (el que ya estaba
    subido no se vuelve a subir, solo lo nuevo/cambiado).
  - Hace commit y push automático a GitHub de los cambios de la web
    (library.json, carátulas) — nunca del audio, que va a Cloudflare.

En un par de minutos, tu web publicada ya tiene las canciones nuevas,
disponibles también fuera de casa desde el iPad.

La primera vez que lo ejecutes instalará automáticamente lo que le
falte (Mutagen para leer metadatos, boto3 para subir a Cloudflare).


PROBAR EN LOCAL ANTES DE PUBLICAR
--------------------------------------
Doble clic en ABRIR_WEB_LOCAL.command para ver la web en tu Mac antes
de subir nada. No abras index.html directamente haciendo doble clic:
los navegadores bloquean la carga de library.json si el HTML se abre
como archivo suelto, y aparecerían 0 canciones.


ESTRUCTURA DEL PROYECTO
---------------------------
DJGEEORGE_PLAYER/
├── index.html / style.css / script.js      <- la web
├── ACTUALIZAR_TODO.command                 <- el único script que usarás
├── ABRIR_WEB_LOCAL.command                 <- para probar en el Mac
├── tools/
│   ├── actualizar_todo.py
│   └── config.json                         <- tus credenciales de R2
├── playlist_jorge/
│   ├── music/     <- tus MP3 aquí (nunca se sube a GitHub)
│   ├── covers/    <- se genera solo
│   └── library.json
└── playlist_djgeeorge/
    ├── music/     <- tus MP3 aquí (nunca se sube a GitHub)
    ├── covers/    <- se genera solo
    └── library.json

El .gitignore ya excluye music/ de git, así que el audio nunca viaja
a GitHub aunque se te olvide: siempre va a Cloudflare.


CONTROLES DE LA WEB
-----------------------
Barra espaciadora = play/pausa. Aleatorio y repetir tienen botón
propio. El buscador filtra por título, artista o álbum dentro de la
playlist activa.


PRIVACIDAD
-------------
No se usa Spotify ni ninguna API externa de música. La web solo
reproduce lo que tú mismo subas. Ten en cuenta que, aunque el
repositorio de GitHub sea privado, la web publicada con GitHub Pages
es accesible por cualquiera que tenga el enlace (no aparece en
buscadores, pero no hay contraseña). Lo mismo aplica a las URLs
públicas de Cloudflare R2.
