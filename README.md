# bass-tab-sync

Player local que mostra uma tab de baixo do Songsterr sincronizada com o áudio da música.

## Requisitos

- Python 3.10+ (só biblioteca padrão)
- `curl`
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) (para baixar o áudio)

## Uso

```bash
./run.sh
```

Abra http://127.0.0.1:8137/ e cole a URL de uma tab do Songsterr para adicionar uma música.

Também dá para adicionar pela linha de comando:

```bash
python3 fetch_song.py <url-do-songsterr> [--video-id YT_ID] [--slug NOME] [--no-audio]
```

Cada música vai para `songs/<slug>/` (`tab-data.js`, `sync-preset.js`, `audio.mp3`). Essa pasta não é versionada.

## Arquivos

- `server.py`: servidor local (só em 127.0.0.1) que serve o player e a API de músicas
- `fetch_song.py`: baixa a tab, os pontos de sincronização e o áudio
- `make_data.py`: converte o JSON do Songsterr para o formato do player
- `index.html`: o player
- `source/tab2html.py`: converte uma parte do Songsterr em uma tab HTML estática
