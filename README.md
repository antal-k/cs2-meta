# cs2-meta

A pipeline tool that downloads, extracts, and processes Counter-Strike 2 game files into structured JSON data. Connects to Steam anonymously, pulls VPK archives from depot `2347770`, extracts assets via [Source2Viewer-CLI](https://github.com/ValveResourceFormat/ValveResourceFormat), and transforms `items_game.json` into clean, localized API-ready output for every item type in the game.

## Architecture

```
                  ┌──────────────────────────────────────────────────┐
                  │                  CLI (Commander)                  │
                  │  pipeline | download | extract | postprocess     │
                  │           | upload | process                     │
                  └────────────────────┬─────────────────────────────┘
                                       │
     ┌────────────┬────────────────────┼────────────────┬──────────────┐
     ▼            ▼                    ▼                ▼              ▼
┌─────────┐ ┌─────────────┐ ┌──────────────────┐ ┌──────────┐ ┌──────────┐
│DOWNLOAD │ │   EXTRACT   │ │  POST-PROCESS    │ │  UPLOAD  │ │ PROCESS  │
│         │ │             │ │                  │ │          │ │          │
│ Steam   │ │ Source2     │ │ PNG → AVIF/WebP  │ │ Bunny    │ │items_game│
│ VPK     │─▶│ Viewer-CLI │─▶│ + resize (xs,   │─▶│ S3 / R2  │ │+ langs   │
│ Text    │ │ vtex → png  │ │   sm, md, lg)    │ │ MinIO    │ │→ JSON    │
└─────────┘ │ vmat, vcomp │ │ sharp            │ │ ...      │ └────┬─────┘
            └─────────────┘ └──────────────────┘ └──────────┘      │
                                                                    ▼
   output/{lang}/
   ├── skins.json          Weapon skins (grouped by weapon)
   ├── skins_not_grouped   Flat skin list
   ├── stickers.json       Sticker capsules & kits
   ├── crates.json         Cases & containers
   ├── collections.json    Item collections
   ├── agents.json         Agent models
   ├── patches.json        Patches
   ├── keychains.json      Keychains
   ├── graffiti.json       Graffiti sprays
   ├── music_kits.json     Music kits
   ├── collectibles.json   Pins & coins
   ├── keys.json           Case keys
   ├── highlights.json     Highlight reels
   ├── tools.json          Name tags, caskets, etc.
   ├── base_weapons.json   Stock weapons
   └── all.json            Everything merged
```

## Quick Start

```bash
npm install

# Run the full pipeline (download → extract → postprocess → upload → process)
npm run pipeline

# Or run stages individually
npm run download
npm run extract
npm run postprocess    # PNG → AVIF/WebP + resize
npm run upload         # sync to CDN (optional, disabled by default)
npm run process
```

## CLI

```bash
# Full pipeline with options
cs2-meta pipeline [options]
  --force              Force re-download even if up to date
  --skip-extract       Skip asset extraction
  --skip-postprocess   Skip image conversion & resize
  --skip-upload        Skip CDN upload
  --skip-process       Skip JSON processing
  --languages en,de    Only process specific languages

# Download VPK files from Steam
cs2-meta download [options]
  --force              Force re-download
  --base-only          Only text files (items_game, languages)
  --static-only        Only static VPK archives

# Extract assets from VPKs
cs2-meta extract [options]
  --only <type>        Extract one type: images, textures, models, sounds, thumbnails

# Convert PNGs to AVIF/WebP + generate resized variants
cs2-meta postprocess

# Upload converted images to CDN
cs2-meta upload

# Process game data into JSON
cs2-meta process [options]
  --languages en,fr    Comma-separated language codes

# Global options
  -c, --config <path>        Custom config file
  -s, --set <key=value...>   Override config values (e.g. -s extract.threads=16)
  -v, --verbose              Debug logging
  -q, --quiet                Errors only
```

## Configuration

Copy and customize the default config:

```bash
cp config.default.yaml config.yaml
cp .env.example .env     # add secrets here
```

Secrets and credentials are loaded from `.env` (gitignored) and override config values. See `.env.example` for all supported variables.

Key sections:

| Section | What it controls |
|---------|-----------------|
| `steam` | Auth mode (anonymous by default, or username/password) |
| `depot` | Steam depot/app IDs (`2347770` / `730`) |
| `paths` | Data and output directories |
| `download` | Parallelism, checksum verification |
| `extract` | Source2Viewer-CLI path, thread count, target types |
| `extract.targets[]` | What to extract: images, textures, materials, composites, sounds, models |
| `thumbnails` | Video thumbnail generation (WebP via FFmpeg) |
| `postprocess.images` | PNG → AVIF/WebP conversion, quality, resize presets, concurrency |
| `postprocess.upload` | CDN upload (provider, credentials, formats) |
| `languages` | Which localizations to process (`all` or specific codes) |
| `process.item_types` | Config-driven types with filter/field mappings |
| `process.transforms` | Code-driven transforms for complex types (skins, stickers, crates...) |
| `process.cdn_url` | CDN base URL for image paths |

Override any value from the CLI without editing the file:

```bash
cs2-meta pipeline -s extract.threads=16 -s download.parallel_archives=8
```

### Image Post-Processing

After extraction, PNGs are converted to AVIF and WebP with configurable quality. Resized variants are generated alongside the originals:

```yaml
postprocess:
  images:
    enabled: true
    formats: [avif, webp]
    quality:
      avif: 50
      webp: 80
    sizes:
      - suffix: xs    # 96px wide
        width: 96
      - suffix: sm    # 192px wide
        width: 192
      - suffix: md    # 384px wide
        width: 384
      - suffix: lg    # 768px wide
        width: 768
    concurrency: 8
    skip_existing: true
```

For a file like `ak47_asiimov_light_png.png`, this produces:

| File | Description |
|------|-------------|
| `ak47_asiimov_light_png.avif` | Full size AVIF |
| `ak47_asiimov_light_png.webp` | Full size WebP |
| `ak47_asiimov_light_png.xs.avif` | 96px AVIF |
| `ak47_asiimov_light_png.sm.webp` | 192px WebP |
| `...` | All size × format combinations |

Conversion is incremental — only files newer than their converted output are re-processed.

### CDN Upload

Optionally sync converted images to a CDN. Disabled by default. Uses a local manifest to track uploads and only pushes new or changed files.

```yaml
postprocess:
  upload:
    enabled: false
    provider: bunny          # bunny | s3
    base_path: ""            # path prefix in storage
    formats: [avif, webp]
    include_png: false
    concurrency: 10

    # Bunny CDN
    bunny:
      storage_zone: ""
      access_key: ""
      region: ""

    # S3 / S3-compatible (R2, MinIO, DigitalOcean Spaces, etc.)
    # s3:
    #   bucket: ""
    #   region: "us-east-1"
    #   access_key_id: ""
    #   secret_access_key: ""
    #   endpoint: ""
```

Credentials can also be set via environment variables:

| Variable | Provider |
|----------|----------|
| `BUNNY_ACCESS_KEY` | Bunny |
| `BUNNY_STORAGE_ZONE_NAME` | Bunny |
| `BUNNY_STORAGE_REGION` | Bunny |
| `AWS_ACCESS_KEY_ID` | S3 |
| `AWS_SECRET_ACCESS_KEY` | S3 |
| `AWS_REGION` | S3 |
| `S3_BUCKET` | S3 |
| `S3_ENDPOINT` | S3-compatible |

## Output

All output lands in `output/{lang}/` with one directory per language (en, ru, zh-CN, de, fr, ...).

### Sample: Skin

```json
{
  "id": "skin-e757fd7191f9",
  "type": "Skin",
  "name": "Hand Wraps | Spruce DDPAT",
  "weapon": { "id": "leather_handwraps", "name": "Hand Wraps" },
  "pattern": { "id": "handwrap_camo_grey", "name": "Spruce DDPAT" },
  "category": "Gloves",
  "min_float": 0.06,
  "max_float": 0.8,
  "rarity": { "id": "rarity_ancient", "name": "Extraordinary", "color": "#eb4b4b" },
  "stattrak": false,
  "souvenir": false,
  "wears": ["FT", "MW", "WW", "BS"],
  "collections": [],
  "crates": ["set_community_2024"],
  "image": "https://cs2-cdn.pricempire.com/panorama/images/econ/..."
}
```

### Sample: Agent

```json
{
  "id": "agent-582e6f2b",
  "type": "Agent",
  "name": "Bloody Darryl The Strapped | The Professionals",
  "rarity": "rarity_legendary",
  "team": "terrorists",
  "image": "https://cs2-cdn.pricempire.com/panorama/images/econ/characters/...",
  "model_player": "characters/models/tm_professional/tm_professional_varf5.vmdl"
}
```

## Extracted Assets

Beyond JSON, the extraction step pulls raw assets, and post-processing generates optimized variants:

| Type | Path | Format | Description |
|------|------|--------|-------------|
| Images | `panorama/images/econ/` | PNG | Item icons, backgrounds |
| Images (converted) | `panorama/images/econ/` | AVIF, WebP | Optimized + resized variants |
| Textures | `materials/models/weapons/` | PNG | Paint textures, glove textures |
| Materials | `materials/.../paints/` | VMAT | Source 2 material definitions |
| Composites | `weapons/paints/` | VCOMPMAT | Composite material configs |
| Sounds | `sounds/music/` | WAV | Music kit audio (disabled by default) |
| Models | `weapons/`, `characters/` | glTF | 3D models (disabled by default) |

## Project Structure

```
cs2-meta/
├── src/
│   ├── index.ts                CLI entry point
│   ├── config.ts               YAML config loading + CLI overrides
│   ├── pipeline.ts             Orchestrates download → extract → postprocess → upload → process
│   ├── logger.ts               Chalk + Ora colored output
│   ├── download/
│   │   ├── steam.ts            Steam client, anonymous login, manifest
│   │   ├── vpk.ts              VPK archive download + text extraction
│   │   └── cache.ts            Manifest & checksum caching
│   ├── extract/
│   │   ├── source2.ts          Source2Viewer-CLI invocation
│   │   ├── bin.ts              Auto-downloads Source2Viewer-CLI if missing
│   │   └── thumbnails.ts       FFmpeg video thumbnail extraction
│   ├── postprocess/
│   │   ├── index.ts            Orchestrates convert + upload
│   │   ├── images.ts           PNG → AVIF/WebP conversion + resize (sharp)
│   │   └── upload/
│   │       ├── provider.ts     UploadProvider interface
│   │       ├── index.ts        File scanning, manifest, batching, provider resolution
│   │       ├── bunny.ts        Bunny CDN provider
│   │       └── s3.ts           S3 / S3-compatible provider (R2, MinIO, DO Spaces)
│   └── process/
│       ├── parser.ts           Builds GameState from items_game.json
│       ├── processor.ts        Config-driven item type processing
│       ├── transforms.ts       Skins, stickers, crates, graffiti, etc.
│       ├── output.ts           JSON file writing + grouping
│       ├── languages.ts        Localization ($t, $tc helpers)
│       ├── helpers.ts          Weapon names, rarities, wear mappings
│       ├── texture-parser.ts   VMAT/VCOMPMAT texture parsing
│       └── data/               Static JSON (weapon defs, graffiti data)
├── config.default.yaml         Default configuration
├── package.json
└── tsconfig.json
```

## Requirements

- **Node.js** >= 18
- **Steam** access (anonymous login works for public depots)
- **FFmpeg** (bundled via `ffmpeg-static`, used for thumbnail generation)
- **sharp** (installed via npm, handles AVIF/WebP conversion and resizing)
- **Source2Viewer-CLI** (auto-downloaded on first run from [ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat))

## License

Private / Internal use.
