# Vinyl Light Archive Player Redesign

Date: 2026-07-25

Status: Approved by the user's continued implementation instruction

## Design Read

This is a targeted redesign of an existing single-screen lyric player for immersive repeat listening. The visual language is a dark light-and-shadow archive: carbon black, cold graphite, projector white, cover-derived color, directional light, restrained material depth, and iOS-inspired non-linear continuity.

Design settings are `DESIGN_VARIANCE: 7`, `MOTION_INTENSITY: 7`, and `VISUAL_DENSITY: 4`. The current information architecture and media workflow stay intact.

## Approaches Considered

### Cosmetic restyle

Retain the current layout and JavaScript, then change only colors, type, and shadows. This has the smallest diff, but it cannot fix competing animation owners, abrupt interruption, or the weak archive identity.

### Targeted reconstruction (selected)

Preserve the turntable, draw action, lyrics, playlist, audio behavior, and existing covers. Recompose the visible hierarchy around an unframed archive instrument, add restrained metadata, remove decorative loading chrome, and centralize player transitions behind one cancellable motion owner. This produces the requested quality lift without replacing the product.

### Full rebuild

Replace the layout and player composition wholesale. This creates maximum visual freedom, but it risks the mature audio, loading, playlist, accessibility, and mobile behavior already covered by tests.

## Visual System

- Use one dark theme across loading, player, lyrics, and playlist.
- Use carbon black and neutral graphite for the base, cold silver and projector white for type and edges, one restrained archive red for true active or error state, and cover-derived color only as reflected light.
- Use the system sans stack for UI and metadata. Reserve the existing Chinese serif treatment for lyrics and the main title.
- Keep the turntable unframed. Do not place it inside a decorative card.
- Use a consistent geometry rule: small panels at no more than `8px` radius; compact commands may remain pill-shaped when their current interaction requires it.
- Replace ambient radial blobs with one or two directional, masked light fields whose origin and falloff read as projected beams.
- Do not add images, requests, decorative copy, badges, section numbers, or third-party assets. The five existing covers remain the only loading imagery.

## Loading Screen

- Keep the single decoded-poster sequence, bounded particles, directional sliced-light pass, retry state, and final continuity behavior.
- Remove the visible top-right progress text and the bottom progress rail.
- Keep decoded progress in the existing live region as visually hidden accessible text.
- Keep the short bottom loading or error message and retry command because they communicate real state.
- Let the poster and the moving light beam carry the composition. No replacement decorative line or caption is added.

## Main Player Composition

- Rename the visible product title to `光影档案馆` and retain a short functional subtitle tied to the lyric draw experience.
- Place the title and metadata on an asymmetric archive axis at desktop while keeping the turntable as the primary visual object. Collapse to a centered, single-column composition on mobile.
- Add one compact metadata rail for the selected track: archive number, release, source, and playback state. Before selection it shows quiet, factual idle values.
- Keep contact and transient error messaging subordinate to the listening controls.
- Preserve the current draw, play/pause, seek, lyrics, playlist, playback-mode, retry, and close commands.

## Player Interaction And Motion

- One motion controller owns draw, track switch, overlay open, overlay close, and playback recovery timelines.
- A newer command cancels the prior command, waits for cleanup, reads the rendered turntable state, and continues from that state. No cancelled tween may leave an unresolved Promise.
- The primary curve is `cubic-bezier(0.32, 0.72, 0, 1)`, with symmetric `cubic-bezier(0.42, 0, 0.58, 1)` only for true crossfades. This borrows iOS continuity principles without imitating native components.
- The record, tonearm, cover, control rail, lyrics, and playlist move as one ordered state change. Decorative light follows the primary surface rather than leading it.
- Animate transform and opacity by default. Do not animate layout dimensions, large blur, backdrop filter, full-screen background position, or box shadow.
- `full` supports the complete choreography, `compact` shortens distances and removes expensive compositing, and `reduce` uses direct state changes or short fades.
- Page visibility pauses decorative work. Hidden overlays run no animation.

## Draw Button Light Loop

- Adapt the supplied Glowing Shadow reference into one restrained perimeter-light pass around the existing draw button. Preserve the button's current dimensions, pill geometry, label viewport, and command hierarchy.
- Use projector white, cold silver, archive red, and the current cover accent. Do not reproduce the reference's rainbow hue cycle, large blurred halo, pulsing box shadow, or viewport-sized glow calculations.
- In the `full` profile, each loop has one non-linear travelling pass followed by a visible quiet interval. The loop runs only while the command is idle and interactive; `data-busy`, disabled, hidden, and overlay-transition states pause it.
- `compact` keeps a static low-opacity perimeter highlight, and `reduce` removes the loop entirely. The effect must animate only transform and opacity and must not create mobile long tasks over `50ms`.
- Hover, focus-visible, and active states remain legible without depending on the loop. Button text contrast and the existing tactile press response remain intact.

## Lyrics And Playlist

- Lyrics read as projected type in open space, not a card inside a card. Keep author-provided semantic line breaks unchanged.
- The playlist reads as an archive index: compact rows, clear current selection, restrained cover thumbnails, and a static active marker.
- Overlay open, close, and track refresh use the shared motion owner so rapid taps cannot stack animations or leave stale classes.
- All controls remain keyboard reachable, labelled, and at least 44px on coarse-pointer devices.

## Responsive And Performance Rules

- Desktop target: `1440x900`; mobile target: `390x844`; also verify the existing Pixel 5 profile.
- Use `dvh` and safe-area insets for viewport stability.
- Mobile uses one column, smaller bounded turntable geometry, no full-screen live blur, no persistent compositor hints, and no decorative infinite animation besides active record rotation.
- `prefers-reduced-motion` disables particles, directional travel, looping button light, parallax, and staged overlay motion while preserving state clarity.
- Maintain zero effect-attributable tasks over `50ms` in the existing mobile loading and draw-button probes.

## Error Handling

- Loading failure preserves the current poster, names failed slots only in the error state, clears particles, and focuses retry.
- Audio failure returns the turntable and controls to a stable paused state and exposes `重新加载`.
- Interrupted motion settles as cancelled and cannot apply stale final styles after a newer interaction.
- A failed visual transition is not reported as a media-network failure.

## Verification

- Unit tests cover profile selection, exclusive ownership, cancellation settlement, interrupted draw/switch behavior, metadata updates, visible-loading-chrome removal, and draw-button loop gating.
- Existing unit, audit, build, and browser suites remain passing.
- Browser QA covers initial player, draw-to-lyrics, play/pause, seek, lyrics close/open, playlist open, mode switch, track selection, retry state, rapid interruption, desktop, mobile, and reduced motion.
- Capture loading, idle player, active player, lyric overlay, and playlist screenshots. Compare layout, typography, palette, light direction, image treatment, control geometry, responsive behavior, and visible copy against this specification and the prior approved archive specifications.
- Browser plugin is not available in this session, so use the repository's Playwright workflow and record that fallback.

## Allowed Above-The-Fold Copy

- `光影档案馆`
- One existing or shorter functional subtitle about drawing a lyric
- `抽取`, `读取中`, and `再次抽取`
- Functional player status, time, retry, and accessibility labels already required by the workflow

No archive kicker, decorative accession sentence, floating top-right label, or loading progress copy is added above the fold.
