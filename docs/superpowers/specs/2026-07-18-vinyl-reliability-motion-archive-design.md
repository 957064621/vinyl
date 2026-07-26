# Vinyl Reliability, Motion, and Light Archive Design

Date: 2026-07-18

Status: Approved in conversation, pending written-spec review

## Purpose

This design updates the vinyl lyric player in four connected areas:

1. Improve access reliability for users in mainland China while preserving the already distributed `https://957064621.github.io/vinyl/` URL.
2. Remove the main causes of mobile animation jank and discontinuous transitions.
3. Reframe the existing experience as a "light and shadow archive" without introducing any new third-party imagery.
4. Correct and extend the song library, then document the complete project and its iteration rules in `agent.md`.

The page remains the actual lyric-drawing experience. It does not become a marketing landing page.

## Constraints

- The public `github.io` URL cannot change because it is already printed or distributed in existing materials.
- The project has no ICP filing.
- The current Hangzhou OSS bucket may store images and audio, but it will not become the primary HTML website.
- Alibaba Cloud documents that HTML accessed through an OSS Bucket default domain is forced to download, and a custom domain bound to a mainland China Bucket requires ICP filing.
- The implementation must not use any of the reference images found during visual research. Those images were visual references only.
- Only images already used by the project may appear in the redesigned experience. Optimized derivatives of those same images are allowed.
- The loading screen must remain until every required OSS image has produced a usable decoded bitmap.
- Lyrics are selected highlight or chorus excerpts. Author-provided semantic line breaks are authoritative.

## Current Findings

### Delivery

- GitHub Pages currently uses legacy publishing from `main` at the repository root.
- `index.html`, `src/main.js`, `src/style.css`, and `src/data.js` require multiple critical requests to `github.io`.
- A complete DNS failure for `github.io` cannot be repaired by page code because no page code executes before DNS and TLS succeed.
- The practical mitigation is to reduce the GitHub critical path to one navigation response and move media traffic to OSS.

### Loading

- The loading sequence starts from `window.load`, so eager cross-origin images can delay the start of the exit sequence.
- The five current loading images total about 10.35 MiB.
- The OSS responses currently include `Content-Disposition: attachment` and `x-oss-force-download: true`.
- The playlist is rendered during bootstrap and can expose remote album-cover URLs before the user opens it.

### Motion

- The stylesheet contains 19 keyframe definitions, 9 infinite animation declarations, 28 backdrop-filter declarations, and 31 will-change declarations.
- Mobile CSS currently animates a large blurred playlist backdrop indefinitely.
- The animation flow mixes CSS animations, Web Animations, requestAnimationFrame loops, and fixed delays.
- Fixed delays and independent animation systems allow visible gaps when the main thread drops frames.

### Content

- The library currently contains 142 track references across 24 releases.
- The audio object for `媚人.mp3` already exists in OSS and supports byte ranges.
- The current lyric formatter may split and trim content after authors have supplied line breaks. This can silently remove a semantic line.

## Decisions

### 1. Keep GitHub Pages as the HTML Origin

The existing public URL remains unchanged. The project will switch from legacy branch publishing to a GitHub Pages Actions deployment that publishes a built `dist` directory.

The navigation-critical build output will be a single HTML document containing the minified application CSS, JavaScript, and library data. Non-critical files such as the web manifest and service worker may remain separate, but they must not block first render or the loading sequence.

This does not solve a total `github.io` DNS outage. It does reduce intermittent failure exposure from several GitHub requests to one GitHub navigation request.

### 2. Use OSS Only as the Media Origin

The existing Hangzhou OSS buckets remain the source for images and audio. They do not host the primary HTML document.

All current cover images used at runtime will be mirrored or retained in OSS. Runtime code must not request Flickr, Openverse, or newly introduced image providers. Existing Apple-hosted cover artwork will be mirrored to OSS so the production page no longer depends on Apple image delivery.

Each retained source image will receive optimized derivatives:

- mobile WebP or AVIF, approximately 480 pixels on the long edge;
- desktop WebP or AVIF, approximately 960 pixels on the long edge;
- the existing source image as a final format fallback.

OSS object metadata must use the correct media content type, `Content-Disposition: inline`, byte-range support for audio, and long-lived immutable caching for versioned objects.

### 3. Gate Loading on Decoded Critical Images

The loading sequence starts as soon as the module executes after the DOM is parsed. It does not wait for `window.load`.

The five existing loading covers form an explicit critical-image manifest. The loader:

1. selects the correct derivative for the viewport;
2. loads images with bounded concurrency;
3. waits for both `load` and `decode()`;
4. retries a failed derivative twice;
5. falls back to a smaller derivative of the same image;
6. records progress as completed slots out of five;
7. exits only when all five slots contain usable decoded images.

If a source and all same-image fallbacks fail, the page remains on a clear recoverable loading error state with a retry command. It must not remain on an unexplained spinner, and it must not enter the player with missing required imagery.

Image URLs are assigned by the asset loader rather than being eager `src` attributes in the initial HTML. This prevents the browser's global load event from becoming an implicit dependency.

### 4. Lazy-Initialize Non-Critical Content

The complete playlist is not rendered during bootstrap. It is rendered on first open and updated only when its data or active track changes.

Album covers inside the playlist use OSS derivatives and browser-native lazy loading where an image element is appropriate. Hidden playlist groups must not create compositor layers or fetch decorative images before the playlist is opened.

Audio continues to use `preload="metadata"`. A selected track loads on demand. Playback failures receive a visible retry state instead of console-only reporting.

## Light and Shadow Archive Visual System

### Visual Language

The theme is an archival listening room shaped by projected light, not a literal museum page.

- Base: carbon black, neutral graphite, cold silver, and projector white.
- Accents: cover-derived color plus one restrained archival red used for stamps, active indices, or error states.
- Typography: a restrained Chinese serif for lyric excerpts and a compact sans serif for catalog metadata.
- Graphic vocabulary: accession numbers, thin measuring rules, contact-sheet frames, registration marks, archive dates, and controlled rectangular light cuts.
- Imagery: only the project's current cover artwork and derived crops.
- Prohibited decoration: imported stock photography, bokeh blobs, gradient orbs, and continuously blurred full-screen decoration.

### Loading Screen

The loading screen behaves like an archive intake sequence:

- the five current covers appear as a contact sheet or sequence of accession frames;
- a narrow light aperture reveals each decoded image;
- the progress label uses an archive counter such as `03 / 05`;
- the final frame opens into the turntable using opacity, transform, and clip-path only;
- no large backdrop-filter or background-position animation is used on mobile.

### Player

The existing turntable remains the primary first-viewport object. It is treated as an archive playback instrument rather than placed in a decorative card.

Track metadata gains a compact archive identity: release, track number, recording source, and current playback state. The interface remains quiet enough for repeated music use.

### Lyrics and Playlist

Lyrics remain a full-screen overlay. The visual treatment resembles a light table with the excerpt floating in projected light, but it avoids nested cards and expensive live blur.

The playlist reads as an archive index. Album grouping stays intact, cover thumbnails are subordinate, and the current track is identified with typography and a small archival marker rather than a continuously glowing blur.

## Motion Architecture

### Motion Profiles

The app exposes three explicit profiles:

- `full`: desktop fine-pointer devices with no reduced-motion request;
- `compact`: the default for coarse pointers, iOS, Android, and constrained WebViews;
- `reduce`: users requesting reduced motion.

Mobile devices use `compact` by default. Motion selection is centralized rather than repeated across CSS and JavaScript heuristics.

### Motion Rules

- Transform and opacity are the default animated properties.
- Background-position, large blur radii, animated backdrop-filter, and animated box-shadow are disabled in `compact` and `reduce`.
- Infinite motion is limited to the active rotating vinyl and at most one subtle local highlight while playback is active.
- Hidden overlays have no active animations and no persistent `will-change` declarations.
- `will-change` is applied immediately before a transition and removed after completion.
- Playlist item entrance animation is limited to visible items. Compact mode may animate only the container.
- Page visibility changes pause decorative Web Animations and resume only animations required by the current playback state.

### Timeline Coordination

A single motion coordinator owns the draw, track-switch, overlay-open, overlay-close, and playback transitions. State advances from animation completion promises rather than duplicated fixed delays.

Audio, vinyl rotation, tonearm movement, cover swap, and overlay visibility remain separate components, but the coordinator defines their ordered timeline. Each component exposes small commands and completion promises.

Interrupted interactions cancel the current timeline, read the actual rendered state once, and start the next timeline from that state. This preserves continuity without stacking animations.

## Proposed Source Boundaries

The implementation plan will preserve behavior while moving responsibilities out of the current monolithic files:

- `src/main.js`: composition root only.
- `src/app/bootstrap.js`: DOM lookup, application startup, and lifecycle.
- `src/config/assets.js`: OSS origins, derivative selection, and critical-image manifest.
- `src/media/asset-loader.js`: image loading, decode, retry, fallback, and progress.
- `src/player/audio-controller.js`: audio source, playback, Media Session, seek, and error state.
- `src/motion/motion-controller.js`: motion profile, timeline coordination, cancellation, and visibility handling.
- `src/ui/loading-screen.js`: archive loading presentation.
- `src/ui/playlist.js`: lazy rendering, selection, and scrolling.
- `src/ui/lyrics-overlay.js`: lyric and result overlay behavior.
- `src/lyrics/format.js`: semantic line validation and safe HTML rendering.
- `src/data/lyrics.js`: highlight excerpts.
- `src/data/releases.js`: release and track metadata.
- `src/style.css`: import-only stylesheet entry.
- `src/styles/base.css`: reset, tokens, typography, and page layout.
- `src/styles/archive.css`: light and shadow archive visual language.
- `src/styles/turntable.css`: record, tonearm, and playback controls.
- `src/styles/overlays.css`: lyrics and playlist surfaces.
- `src/styles/motion.css`: keyframes and profile-specific motion rules.

The Vite build bundles these source modules into the single navigation-critical HTML document. Source splitting must not create additional critical GitHub requests in production.

## Song and Lyric Changes

### 粉钻

The second source line becomes:

```text
你若不甘 用挚爱交换
```

No other `粉钻` line changes.

### 媚人

`媚人` belongs to its own `媚人 - Single` release, dated `2026-07-17`, with artist `薛之谦`, the existing OSS object `媚人.mp3`, and the official `4896016816485.jpg` artwork. It must not carry `recordingSource` metadata. `万兽之王演唱会录音` is dated `2026` and contains only `粉钻` and `造物`.

The approved six-line excerpt is:

```text
我们都疮痍满身
再捏造缘分
然后扮成 无辜的路人
要粉饰半生
残存体温
献祭给假圣人
```

### Lyric Authoring Contract

- Every stored excerpt is a highlight or chorus excerpt, not a full song transcript.
- A newline is a hard semantic boundary.
- Spaces may indicate a soft internal pause but must not force a new line.
- A displayed excerpt contains at most six semantic lines.
- The renderer may normalize punctuation and whitespace, but it may not merge, reorder, or discard author-provided lines.
- If a line does not fit, responsive typography or an editorial line revision is used. Silent trimming is prohibited.

## Project Documentation

A repository-root `agent.md` file will be created exactly with the lowercase filename requested by the project owner.

It will contain:

- product purpose and user flow;
- current architecture and module ownership;
- local development, build, audit, and deployment commands;
- GitHub Pages and OSS responsibilities;
- media naming, metadata, derivative, and caching rules;
- song and release data contracts;
- the highlight-excerpt and semantic-line-break rules;
- motion profiles and performance budgets;
- accessibility and reduced-motion expectations;
- testing and release checklists;
- a chronological explanation of meaningful project iterations based on repository history;
- instructions for adding a song without breaking the audits or loading experience.

Generated manifests remain generated artifacts. `agent.md` explains how to regenerate them rather than duplicating their full tables.

## Error Handling

- Total first-visit `github.io` DNS failure is documented as an external limitation, not reported as fixed.
- Critical image failures enter a named retry state with per-slot status.
- Optional playlist artwork failure uses the same image's fallback derivative or an existing project fallback cover.
- Audio failures expose retry and leave the interface in a consistent paused state.
- A service worker update never replaces the active version mid-session. The next navigation activates the new asset version.
- Stale cached HTML must not reference deleted OSS derivatives; derivative URLs are versioned and retained across at least one release window.

## Testing Strategy

### Unit and Data Tests

- Verify `粉钻` contains `用挚爱交换` and no longer contains `用爱交换`.
- Verify `媚人` has exactly six approved semantic lines and a playable OSS URL.
- Verify explicit lines survive formatting unchanged.
- Verify no formatter path silently drops a line.
- Verify track titles, release keys, audio URLs, and archive indices remain unique and valid.
- Verify the critical-image manifest contains five entries and every entry has mobile, desktop, and fallback candidates.

### Build Tests

- Run the Vite production build.
- Assert that navigation-critical CSS, JavaScript, and data are inlined in `dist/index.html`.
- Assert that no production runtime URL points to Flickr or Openverse.
- Assert that production album artwork no longer depends on Apple-hosted URLs.
- Run the existing audit generator and verify both generated manifests are current.

### Browser Tests

- Desktop Chromium and Safari smoke tests.
- Mobile Chromium, iOS Safari, and WeChat WebView workflow tests.
- Network throttling with successful image decode.
- One derivative failure followed by fallback success.
- Complete critical-image failure followed by user retry.
- Playlist first-open lazy initialization.
- Reduced-motion behavior.
- Background and foreground visibility transitions.
- Audio range loading, playback, pause, seek, track end, and retry.

### Performance Tests

- Record frame timing during draw, lyric open, playlist open, and track switch.
- Test a mid-range mobile viewport with CPU and network throttling.
- Inspect compositor layers while overlays are closed and open.
- Confirm hidden overlays do not continue decorative animations.
- Perform real-device checks because desktop emulation does not reproduce iOS and WeChat compositor behavior.

## Performance Budgets

- Navigation-critical HTML: no more than 120 KiB compressed.
- Mobile critical loading images: target no more than 1.2 MiB total.
- No third-party image-domain requests during production startup.
- Loading screen exits only after five decoded image slots are ready.
- No unexplained indefinite spinner; failures become a retry state.
- Interaction long tasks: none above 50 ms during the principal animation timelines on the reference mobile device.
- Principal mobile motion: target 60 fps, with a minimum acceptable sustained rate of 50 fps on the reference mid-range device.
- Layout shift after the application becomes ready: zero for the turntable, controls, lyric overlay, and playlist shell.

## Rollout Order

1. Add content corrections, lyric contracts, and data tests.
2. Add `agent.md` and update generated library manifests.
3. Replace the bootstrap loading dependency with the explicit image loader.
4. Add optimized derivatives and correct OSS object metadata.
5. Lazy-initialize the playlist and remove startup third-party cover requests.
6. Introduce motion profiles and the centralized coordinator.
7. Apply the light and shadow archive visual system using only existing imagery.
8. Switch GitHub Pages to the single-document production build.
9. Run browser, real-device, and mainland-network checks before treating the release as complete.

## Acceptance Criteria

- The distributed GitHub Pages URL is unchanged.
- Production needs only one critical GitHub navigation response before it can execute the application.
- The loading screen remains visible until all five required OSS images are decoded or their same-image fallbacks are decoded.
- Loading errors are actionable rather than indefinite.
- No searched reference image is included in source, build output, or OSS upload instructions.
- Mobile playlist and lyric transitions no longer animate full-screen blur or background position.
- Hidden UI does not retain unnecessary compositor layers or infinite animations.
- `粉钻`, `媚人`, the song audits, and the semantic line rules match this document.
- `agent.md` explains the complete project and the meaningful iteration history.
- The project builds successfully and passes unit, browser, content, and performance checks defined above.

## Explicit Non-Goals

- Claiming to fix a total mainland DNS block of `github.io`.
- Moving the primary HTML site to an unfiled mainland OSS custom domain.
- Adding reference photography, stock imagery, or AI-generated imagery.
- Rewriting the player into a new framework.
- Caching the full audio library for offline playback.
- Redesigning the application into a marketing site.
