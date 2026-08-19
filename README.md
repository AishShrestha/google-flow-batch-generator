# Google Flow Batch Generator

Automates batch image generation in Google Flow using Playwright. Takes a Markdown file with image prompts, submits them one by one to Google Flow, downloads the generated images, and tracks progress for resumability.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and edit config
cp .env.example .env

# Dry run — parse and verify prompts
npm run generate -- prompts/sample-prompts.md --dry-run

# Inspect Google Flow UI (first time setup)
npm run inspect

# Generate all images
npm run generate -- prompts/sample-prompts.md

# Start from prompt 5
npm run generate -- prompts/sample-prompts.md --start 5

# Only process 10 prompts
npm run generate -- prompts/sample-prompts.md --limit 10

# Force regenerate all (ignore completed)
npm run generate -- prompts/sample-prompts.md --force

# Manual intervention mode
npm run generate -- prompts/sample-prompts.md --manual
```

## First Run

1. Run `npm run inspect` to launch the browser and log into Google Flow.
2. The persistent browser profile (`.playwright-profile/`) stores your session.
3. Navigate to the image generation interface and verify the UI.
4. Close with Ctrl+C when done.
5. Run `npm run generate -- prompts/sample-prompts.md --dry-run` to verify prompt parsing.
6. Run the full batch with `npm run generate -- prompts/sample-prompts.md`.

## Input Format

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

## Output Structure

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

## Resumability

`state.json` tracks completed and failed prompts. If the app crashes, restart it and it picks up where it left off.

Use `--force` to regenerate already-completed prompts.

## Error Handling

On failure, diagnostic info is saved to `errors/`:
- `NNN-error.png` — screenshot of browser state
- `NNN-error.html` — HTML snapshot
- `NNN-error.txt` — error details

## Configuration

See `.env.example` for all options:

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

## Selectors

All Google Flow UI selectors are in `src/selectors.ts`. If Google Flow's UI changes, update that file only.

Use `npm run inspect` to identify current selectors via DevTools.

## Architecture

```
Markdown Parser → Prompt Queue → State Manager → Google Flow Automation → Image Downloader → Output Manager
```

The `ImageGenerator` interface in `src/types.ts` allows future providers to be plugged in.

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Safety

- No Google password automation
- No CAPTCHA bypass
- No cookie/token extraction
- Persistent browser profile for session continuity
- Manual login required first time
- Behaves like a normal user controlling the browser

## Project Structure

```
google-flow-batch-generator/
├── src/
│   ├── index.ts        # CLI entry point
│   ├── parser.ts       # Markdown prompt parser
│   ├── flow.ts         # Google Flow automation
│   ├── selectors.ts    # UI selectors (single file)
│   ├── state.ts        # Progress tracking
│   ├── downloader.ts   # Image download/save
│   ├── logger.ts       # Terminal output
│   └── types.ts        # Shared types
├── tests/
│   ├── parser.test.ts
│   └── state.test.ts
├── prompts/
│   └── sample-prompts.md
├── output/
├── errors/
├── .playwright-profile/
├── state.json
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```