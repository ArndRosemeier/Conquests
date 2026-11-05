# Generated assets

Every painting, crest, piece of music, sound effect and newspaper
headline in Conquests was generated once with models on
[OpenRouter](https://openrouter.ai) and ships as a static file. The game makes no
network calls and needs no API key at run time.

| What | Where | Model | Script |
| --- | --- | --- | --- |
| Title paintings, event paintings, nation crests | `public/art/*.webp` | `meta/muse-image` | `scripts/assets/gen_images.sh` |
| Music (title, two campaign themes, war, victory, defeat) | `public/audio/music/` | `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview` for the 30 s stings | `scripts/assets/gen_audio.sh` |
| Sound effects | `public/audio/sfx/` | `bytedance-seed/seed-audio-1-0` | `scripts/assets/gen_audio.sh` |
| World Herald headlines, ticker and tips | `src/ui/content/herald.json` | `~z-ai/glm-latest` (reasoning off) | `scripts/assets/herald-prompt.txt` |

The exact prompts are in the scripts. They call `or.py`, a small OpenRouter CLI
that reads the key from `OPEN_ROUTER_KEY`; any client that can call
`/images`, `/audio/speech` and streamed `/chat/completions` works the same way.

## Post-processing

- Images: converted to WebP (`cwebp -q 82`); paintings 1920 or 1280 px wide, crests 384 px.
- Music: loudness-normalised (`ffmpeg -af loudnorm=I=-18`), MP3 112 kbit/s stereo.
- Sound effects: leading silence trimmed, normalised, MP3 96 kbit/s mono.
- Headlines: reviewed by hand; a few invented words and off-tone lines were removed.

## Run-time use

- `src/ui/audio/sound.ts` streams music through one `<audio>` element per mood
  with cross-fades, and plays effects from small pools. Nothing plays before the
  first click or key press, as browsers require.
- `src/ui/content/herald.ts` picks headlines by a stable hash, so the same event
  always gets the same headline.
