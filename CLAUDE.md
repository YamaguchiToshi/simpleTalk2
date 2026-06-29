# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a reimplementation of the gaze input stabilization engine for **simpleTalk** — a framework-free (plain HTML/CSS/JS) Japanese AAC (Augmentative and Alternative Communication) web application using a 50-character kana board. The upstream repo is at https://github.com/YamaguchiToshi/simpleTalk.

The sole document in this repo is the design spec: `simpleTalk_gaze_input_reimplementation_spec.md`. All implementation work should follow it.

The input path is: Tobii Eye Tracker → GazePoint → Windows mouse pointer → Browser Pointer Events → simpleTalk. The app only receives mouse pointer coordinates — no raw eye-tracker data.

## Architecture

The new input engine replaces the existing dwell-click logic entirely (no partial patching). It is structured as a pipeline:

```
pointermove → TimestampedSample → OutlierFilter → AdaptiveSmoothing
  → TargetResolver → TargetLock → DwellController → AAC action
```

### Modules (logical separation; may be single or multiple files)

| Module | Responsibility |
|---|---|
| `PointerSampler` | Capture pointer events, produce timestamped samples |
| `GazeFilter` | Adaptive EMA smoothing, velocity estimation, outlier rejection |
| `TargetResolver` | Map smoothed coordinates to button candidates; cache button rects |
| `TargetLock` | Candidate confirmation (200 ms), hysteresis region, target hold/switch |
| `DwellController` | Dwell progress, deviation grace period, selection, cooldown, re-select guard |
| `GazeFeedback` | Virtual cursor, target highlight, progress display, debug overlay |
| `GazeSettings` | Read/write settings and presets; `localStorage` persistence |

### State machine (DwellController)

`IDLE → CANDIDATE → LOCKED → DWELLING → ACTIVATED → COOLDOWN → RELEASE_REQUIRED → IDLE`

### Coordinate smoothing

Primary: **adaptive EMA** — low α (0.10–0.20) when displacement < 60 px, medium α (0.35–0.55) at 60–160 px, high α (0.75–0.90) above 160 px. One Euro Filter is a Phase 9 option only if adaptive EMA proves insufficient.

### Key timing defaults (initial trial values, all tunable)

| Parameter | Value |
|---|---:|
| Candidate confirmation | 200 ms |
| Dwell time | 1000 ms |
| Hysteresis region | 20% of button size |
| Deviation grace (continue) | 100 ms |
| Deviation grace (pause) | 100–300 ms |
| Deviation reset threshold | 300 ms |
| Post-selection cooldown | 700 ms |
| Re-select condition | Must exit target first |
| Virtual cursor diameter | 56 px |

## Development Phases

Follow the phased plan in the spec (§12):

- **Phase 0** — Measure baseline (log event intervals, dwell success rate, mis-selections)
- **Phase 1** — Add debug visualization only, no logic changes
- **Phase 2** — New engine skeleton with dummy output (not wired to AAC actions yet)
- **Phase 3** — Adaptive coordinate smoothing
- **Phase 4** — TargetLock + hysteresis
- **Phase 5** — Two-stage dwell (candidate confirmation → dwell)
- **Phase 6** — Deviation grace, cooldown, re-select guard
- **Phase 7** — Wire to existing AAC action functions
- **Phase 8** — Remove old pointer/dwell logic
- **Phase 9** — One Euro Filter comparison (only if needed)
- **Phase 10** — Settings UI and presets

Old and new engines must not fire simultaneously during transition; isolate them with a flag.

## Implementation Constraints

- **No framework** — keep plain HTML/CSS/JS matching the existing simpleTalk codebase.
- **Single activation path** — on selection, call the shared AAC action function once. Avoid `element.click()` or synthetic click events unless no common handler exists; if used, guard against double-fire.
- **Mark gaze targets explicitly** — use `data-dwell-target` or `data-gaze-target` attributes; do not infer targets from DOM structure.
- **Button rects are cached** — recompute only on resize, zoom, or modal open/close.
- **DOM updates on `requestAnimationFrame`** — decouple sample processing from rendering.
- **Virtual cursor**: `pointer-events: none`, semi-transparent, 40–70 px diameter, does not obscure characters.
- **`prefers-reduced-motion`** must be respected for all animations.
- Settings persist to `localStorage`; expose end-user settings as high-level presets (Stability / Tracking Speed), not raw parameters.
- Gaze stabilization must be toggle-able; disabling it restores near-original behavior.
