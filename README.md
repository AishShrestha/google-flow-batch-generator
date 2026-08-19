# Google Flow Batch Generator

Automates the full YouTube short-form video pipeline: script → image prompts (Gemini) → images (Google Flow) → narration (Kokoro TTS). Playwright drives real browsers; persistent profiles keep you logged in.

## Pipeline

```
scripts/video.txt ──gen-prompts──▶ prompts/video.md ──generate──▶ output/NNN/*.png
                                                                       │
 scripts/video.txt ──────────────────tts─────────────────────▶ output/audio/*.wav
```

Three independent stages, each resumable:

| Stage | Command | Output |
|---|---|---|
| 1. Script → image prompts | `pnpm gen-prompts` | `prompts/*.md` |
| 2. Prompts → images | `pnpm generate` | `output/NNN/*.png` |
| 3. Script → narration | `pnpm tts` | `output/audio/*.wav` |

## Quick Start

```bash
# Install dependencies
pnpm install

# Install Playwright Chromium browser
pnpm exec playwright install chromium

# Copy and edit config
cp .env.example .env

# ─── Stage 1: Generate image prompts via Gemini ────────────────
# First time: log into Gemini
pnpm gen-prompts:inspect
# → browser opens gemini.google.com, log in, Ctrl+C when done

# Dry run — verify script batching
pnpm gen-prompts scripts/myvideo.txt --dry-run

# Generate all prompts (batches of 20 lines)
pnpm gen-prompts scripts/myvideo.txt
# → writes prompts/myvideo.md

# Override model or batch size
pnpm gen-prompts scripts/myvideo.txt --model "3.7 Flash" --batch 30

# Custom output path
pnpm gen-prompts scripts/myvideo.txt --output prompts/episode-01.md

# ─── Stage 2: Generate images via Google Flow ───────────────────
# First time: log into Google Flow
pnpm generate:inspect

# Dry run — verify prompt parsing
pnpm generate prompts/myvideo.md --dry-run

# Generate all images
pnpm generate prompts/myvideo.md

# Start from prompt 5
pnpm generate prompts/myvideo.md --start 5

# Only process 10 prompts
pnpm generate prompts/myvideo.md --limit 10

# Force regenerate all (ignore completed)
pnpm generate prompts/myvideo.md --force

# Manual intervention mode
pnpm generate prompts/myvideo.md --manual

# ─── Stage 3: Generate narration via Kokoro TTS ─────────────────
# One-time TTS setup (Python venv + model download)
pnpm setup-tts

# Generate narration audio
pnpm tts scripts/myvideo.txt
pnpm tts scripts/myvideo.txt --voice af_heart --speed 1.1
```

## First Run

### Gemini (Stage 1)

1. Run `pnpm gen-prompts:inspect` to launch the browser and log into Gemini.
2. The persistent browser profile (`.gemini-profile/`) stores your session.
3. Close with Ctrl+C when done.
4. Run `pnpm gen-prompts scripts/myvideo.txt --dry-run` to verify batching.
5. Run the full generation with `pnpm gen-prompts scripts/myvideo.txt`.

### Google Flow (Stage 2)

1. Run `pnpm generate:inspect` to launch the browser and log into Google Flow.
2. The persistent browser profile (`.playwright-profile/`) stores your session.
3. Navigate to the image generation interface and verify the UI.
4. Close with Ctrl+C when done.
5. Run `pnpm generate prompts/myvideo.md --dry-run` to verify prompt parsing.
6. Run the full batch with `pnpm generate prompts/myvideo.md`.

### TTS (Stage 3)

1. Run `pnpm setup-tts` to create the Python venv and download the Kokoro model (~109MB).
2. Run `pnpm tts scripts/myvideo.txt` to generate narration.

## Input Format

### Stage 1 input: narration script

Plain text, one sentence per line:

```
There is a strange moment.
Someone stops texting you.
The silence becomes loud.
```

The script is split into batches of 20 lines (configurable via `GEMINI_BATCH_SIZE`). Each batch is sent to Gemini with the master prompt (`prompts/master-prompt.md`), which enforces the doodle-animation visual style.

### Stage 2 input: image prompts markdown

Output of Stage 1, or hand-written:

```markdown
[L1] LINE 1:
Original Script Line:
"There's a strange moment."

Image Prompt:
"Minimalist psychology animation style, clean white background."
```

The parser detects `Image Prompt:` headers and extracts the prompt text. It handles:
- Curly and straight quotes
- Multiline prompts
- `[Lxx]` markers (ignored for parsing)
- Markdown separators (`---`)
- 500+ prompts

### Stage 3 input: narration script

Same plain text as Stage 1. Kokoro chunks it into ~500-char segments and concatenates into one WAV.

## Output Structure

### Images

```
output/
├── 001/
│   ├── 001-prompt.txt
│   └── 001.png
├── 002/
│   ├── 002-prompt.txt
│   └── 002.png
└── ...
```

If multiple images are generated per prompt:
```
output/
├── 001/
│   ├── 001-prompt.txt
│   ├── 001-01.png
│   ├── 001-02.png
│   └── 001-03.png
```

### Audio

```
output/audio/
└── narration.wav
```

## Resumability

`state.json` tracks completed and failed prompts for Stage 2. If the app crashes, restart it and it picks up where it left off.

Use `--force` to regenerate already-completed prompts.

## Error Handling

On failure, diagnostic info is saved to `errors/`:
- `NNN-error.png` — screenshot of browser state
- `NNN-error.html` — HTML snapshot
- `NNN-error.txt` — error details

## Configuration

See `.env.example` for all options:

### Google Flow

| Variable | Default | Description |
|---|---|---|
| `FLOW_URL` | `https://labs.google/fx/tools/flow` | Google Flow URL |
| `BROWSER_PROFILE_DIR` | `.playwright-profile` | Persistent browser profile |
| `OUTPUT_DIR` | `output` | Image output directory |
| `GENERATION_TIMEOUT_MS` | `180000` | Generation timeout (3 min) |
| `MAX_RETRIES` | `3` | Retry attempts per prompt |
| `DELAY_BETWEEN_PROMPTS_MS` | `3000` | Delay between prompts |
| `HEADLESS` | `false` | Run browser headless |
| `MAX_IMAGES_PER_PROMPT` | `4` | Max images to download per prompt |

### Gemini

| Variable | Default | Description |
|---|---|---|
| `GEMINI_URL` | `https://gemini.google.com/app` | Gemini chat URL |
| `GEMINI_PROFILE_DIR` | `.gemini-profile` | Separate profile for Gemini |
| `GEMINI_MODEL` | `3.1 Pro` | Primary model |
| `GEMINI_FALLBACK_MODEL` | `3.7 Flash` | Fallback on rate limit |
| `GEMINI_BATCH_SIZE` | `20` | Lines per batch |
| `GEMINI_TIMEOUT_MS` | `120000` | Response timeout (2 min) |
| `GEMINI_HEADLESS` | `false` | Run Gemini browser headless |

## Selectors

All Google Flow UI selectors are in `src/selectors.ts`. Gemini selectors are in `src/prompt-gen.ts`. If either UI changes, update the selectors in those files only.

Use `pnpm generate:inspect` / `pnpm gen-prompts:inspect` to identify current selectors via DevTools.

## Architecture

```
Stage 1: Script → GeminiPromptGenerator → prompts/*.md
Stage 2: prompts/*.md → Parser → StateManager → GoogleFlowAutomation → Downloader → output/
Stage 3: Script → Kokoro TTS → output/audio/*.wav
```

The `ImageGenerator` interface in `src/types.ts` allows future providers to be plugged in.

## Testing

```bash
pnpm test           # Run all tests
pnpm test:watch     # Watch mode
```

## Safety

- No Google password automation
- No CAPTCHA bypass
- No cookie/token extraction
- Separate persistent browser profiles for Flow and Gemini (parallel sessions)
- Manual login required first time for each
- Behaves like a normal user controlling the browser

## Project Structure

```
google-flow-batch-generator/
├── src/
│   ├── index.ts        # CLI entry point (generate + gen-prompts)
│   ├── parser.ts       # Markdown prompt parser
│   ├── flow.ts         # Google Flow automation
│   ├── prompt-gen.ts   # Gemini prompt generation
│   ├── selectors.ts    # Flow UI selectors
│   ├── state.ts        # Progress tracking
│   ├── downloader.ts   # Image download/save
│   ├── logger.ts       # Terminal output
│   ├── types.ts        # Shared types
│   └── tts/
│       └── kokoro_tts.py  # Kokoro TTS engine
├── tests/
│   ├── parser.test.ts
│   └── state.test.ts
├── prompts/
│   ├── master-prompt.md    # Stage 1 master prompt
│   └── sample-prompts.md   # Example Stage 2 input
├── scripts/
│   ├── run-tts.sh
│   └── setup-tts.sh
├── output/
├── errors/
├── .playwright-profile/
├── .gemini-profile/
├── state.json
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```