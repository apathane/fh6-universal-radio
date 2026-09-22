# YouTube Music takeover mode: design

Status: approved for spec, pending user review of this document.
Fork focus: this fork of fh6-universal-radio specializes on YouTube Music. Other sources (local files, Spotify, Jellyfin, online radio, external audio) are unaffected by this work.

## Goal

Replace the current generic dashboard card for YouTube Music with a dedicated, full-takeover app experience: better search/discovery, real queue management, faster/more reliable playback, and a UI that looks and feels like its own application rather than one card among six.

## Scope decisions (locked during brainstorming)

1. **Takeover, not a new page.** When `state.sources.active === "youtube_music"`, the dashboard UI fully switches to an immersive YouTube Music specific layout (own nav, own now-playing, generic dashboard chrome hidden). Same URL, same `index.html` shell, not a separate route.
2. **Feature scope:** search and discovery, playback and queue, performance, visual polish. All four in scope for this fork.
3. **Auth model: account-backed.** Uses the existing `cookies_path` config field to authenticate as the user's real YouTube account, unlocking liked songs, their playlists, subscriptions, and personalized search/radio. Anonymous/public-only use still works (cookies optional), but account-backed is the primary experience.
4. **Data client: direct Innertube calls**, the private JSON API that `music.youtube.com`'s own web client uses (what `ytmusicapi` wraps), not `yt-dlp ytsearch:` (too slow, wrong result shape, no library/lyrics/radio access) and not the official YouTube Data API v3 (quota-limited, returns plain YouTube results instead of YT Music ones).
5. **yt-dlp stays for audio extraction**, unchanged. Reimplementing YouTube's stream cipher/signature extraction is out of scope; yt-dlp already solves it and is actively maintained upstream. Innertube is purely for search, library, radio, and lyrics metadata, never for resolving a playable stream URL.
6. **Manual stations (paste-URL) are kept**, not replaced. The account library (Home, Search, Library, Radio) is additive. Manual stations remain the path for playing content outside the user's own account: a friend's public playlist, a one-off video URL.
7. **Layout: sidebar nav, collapsing to bottom tabs on phone.** Home, Search, Library, Radio as a left rail on wide viewports, bottom tab bar under the existing mobile breakpoint, persistent now-playing bar docked at the bottom either way.

## Architecture overview

Two new backend pieces sit alongside the existing `YouTubeMusicSource`, which is otherwise preserved.

**`fh6::ytmusic::InnertubeClient`** (new `include/fh6/sources/ytmusic_client.hpp` plus `src/sources/ytmusic_client.cpp`): a POST+JSON HTTP client against `music.youtube.com/youtubei/v1/*`, carrying the account's cookies plus the fixed Innertube context blob the real web client sends in every request. Covers:
- `search(query)`: songs, albums, artists, playlists, grouped the way YT Music's own UI groups them.
- `browse(browse_id)`: liked songs, a specific playlist, subscriptions, artist pages.
- `next(video_id)`: radio/autoplay continuation, used both to seed a "Start radio" queue and to extend it as playback approaches the end.
- `lyrics(video_id)`: synced or plain lyrics when available.
- Needs `net::http_post` added next to the existing `net::http_get` in `include/fh6/net/http_get.hpp` (same WinHTTP plumbing as the existing GET helper, new verb, JSON body, cookie header).

**Extended `YouTubeMusicSource`** (`src/sources/youtube_music_source.cpp`): queue resolution for account-backed playlists moves off yt-dlp's `--flat-playlist` (a blocking, full-playlist yt-dlp process spawn) onto `InnertubeClient::browse`, with a disk-backed cache (see Performance below). Manual stations keep using yt-dlp `--flat-playlist` exactly as today, since Innertube cannot reliably resolve arbitrary non-YT-Music playlists. The actual audio pipeline (`yt-dlp | ffmpeg` piped PCM, prefetch, EQ) is untouched.

New HTTP API surface in `src/http/http_server.cpp`:
- `GET /api/source/youtube_music/search?q=<query>`
- `GET /api/source/youtube_music/library` (liked songs, playlists, subscriptions; requires cookies)
- `POST /api/source/youtube_music/play_track` body `{"video_id": "..."}`
- `POST /api/source/youtube_music/radio` body `{"video_id": "..."}`
- `GET /api/source/youtube_music/lyrics`

Existing station/queue/cast endpoints for YouTube Music are unchanged; manual stations keep working exactly as today.

## Frontend components

New directory `ui/dist/js/ytmusic/`, parallel to the existing `render/` directory. Mounted and unmounted by `main.js` when the active source changes, using the same `create*(main, ctx) -> { render, invalidate }` factory pattern already used for `externalAudio`, `localFiles`, and the other sources, except this one fully replaces the dashboard chrome instead of adding a card, per the takeover decision.

- **`shell.js`**: the takeover frame. Sidebar rail (Home, Search, Library, Radio) on wide viewports, bottom tab bar under the existing mobile breakpoint (`ui/dist/css/base/responsive.css`), persistent now-playing bar docked bottom, reusing `render/nowPlaying.js` logic rather than forking it.
- **`views/home.js`**: landing view. Recent activity, current queue preview.
- **`views/search.js`**: debounced input against `/search`. Results grouped by songs, albums, artists, playlists. Click plays or queues.
- **`views/library.js`**: tabs for Liked Songs, Your Playlists, Subscriptions (from `/library`), plus a "Custom" section for the existing manual station list (paste-URL), per the "keep both" decision.
- **`views/radio.js`**: "Start radio" action on any track. Seeds via `/radio`, shows and extends the continuation queue.
- **`lyrics.js`**: panel/overlay pulling `/lyrics` for the current track, lazy-fetched only when opened (not prefetched per track).
- **`queue.js`**: single shared source of truth for the current play queue on the frontend, replacing the per-view queue-fetching the old `stationManager` pattern did separately for each source. Search results, library items, radio, and manual stations all feed this one queue.

State stays plain JS closures and the existing SSE `/api/events` poll. No frontend framework, matching the rest of this codebase (a vanilla JS single-page app already; React or Vue is not justified by this scope).

## Performance fixes

**Root cause of the observed re-resolve cost.** `resolve_queue_locked()` (`youtube_music_source.cpp`, around line 248) only skips the refetch when `queue_built_for_ == effective_url` in the current process's memory. Every DLL/game restart, and every `set_active_station()` call unless the station name is already active, discards that and re-runs `yt-dlp --flat-playlist` over the entire playlist, blocking. Confirmed against the live deployment's `bridge.log`: repeated same-day `[yt] resolved 704 track(s)` entries for the same unchanged playlist URL, several minutes apart, each one a full blocking re-fetch.

**Fix.** Persist the resolved queue to disk: `fh6-radio/ytmusic_cache/<playlist_id>.json`, same pattern as `local_files`' existing `local_index.json` tag cache. Keyed by playlist or browse id, with a TTL (default 1h). On activation: serve the cached queue immediately for an instant "on air", kick a background `InnertubeClient::browse` refresh if the cache is stale, swap the in-memory queue in when it lands, and never block the UI on the network call. Innertube's browse continuation also pages results instead of yt-dlp's one all-N-tracks-at-once call, so even a cold cache returns the first page fast instead of waiting on the whole playlist.

**Data flow, the three "start playing" paths:**
1. **Search result.** Click calls `POST /play_track {video_id}`, sets a single-item queue via the existing `set_target()`, switches source. A separate "queue next" action appends without interrupting current playback.
2. **Library playlist.** Same activation path as today's manual stations, but resolved through the cached `InnertubeClient::browse` instead of yt-dlp `--flat-playlist`.
3. **Radio seed.** `POST /radio {video_id}` calls `InnertubeClient::next`, builds an ephemeral queue with no station backing at all. Each continuation call appends more tracks as playback approaches the end, effectively infinite.
4. **Manual station** (unchanged). Still yt-dlp `--flat-playlist`, since it may point at non-account, non-YT-Music content Innertube cannot cleanly resolve.

## Error handling

- **Cookie expiry.** Innertube returns a distinct unauthenticated response when cookies are stale. `InnertubeClient` detects it and surfaces through the existing `AuthState::needs_auth` pattern (already used by Spotify and Jellyfin), with instructions pointing at re-exporting `cookies.txt`. Search and basic playback keep working logged out; only the Library tab (liked songs, playlists, subscriptions, which requires an account) goes into a needs-auth state.
- **Innertube drift.** It is a reverse-engineered, unofficial API; Google can reshape responses without notice. Every parse is exception-guarded; a shape mismatch degrades only the affected feature (empty state plus a toast, "search unavailable, try again later") rather than crashing the source. Manual stations and the yt-dlp pipeline never touch Innertube, so core playback survives Innertube breaking entirely. Only search, library, radio, and lyrics go dark until fixed.
- **Network failures.** `http_post` mirrors `http_get`'s existing 5s timeout, soft-failing to `nullopt`. Frontend reuses the retry-button pattern already in `onlineRadio.js`'s discover search instead of inventing a new one.
- **Rate limiting and bot detection.** HTTP 429 or a captcha-challenge response backs off and shows a "slow down, try again shortly" toast instead of retry-storming the endpoint.
- **Missing lyrics.** Expected, not an error: empty state ("no lyrics for this track").
- **Stale cache during background refresh.** A failed background refresh keeps serving the last-good cached queue and retries on the next activation; never blocks or errors the UI.

## Testing

- **Backend (C++).** The codebase has no unit test framework today; C++ code is validated by logging (`bridge.log`) and manual in-game play-testing. Following that convention rather than introducing a new framework for this alone. `InnertubeClient` gets a `demo()`-style self-check: one runnable smoke test hitting search and browse against a known playlist id and asserting the JSON parses as expected, catching shape drift early.
- **Frontend (JS).** Reuses the existing vitest setup; new tests under `ui/test/ytmusic/` mirror the `render/*.test.js` pattern already in the repo.
  - **Prerequisite, found during codebase review:** the entire existing `ui/test/` suite is currently broken. Every test imports from stale paths (`../dist/js/api.js`, `../dist/js/store.js`, `../dist/js/format.js`, and similar) that predate the `data/`, `lib/`, `render/` reorganization, and `api.test.js` calls flat methods (`api.castYoutube`, `api.getLocalStations`, and others) that no longer exist post-refactor (now nested under `api.youtubeMusic.*`, `api.localFiles.*` via the `sourceApi()` factory). `npm run test` fails on module resolution today. Fixing these import paths and method calls is folded into this work as a prerequisite, since new ytmusic tests need a working test runner.
- **Integration.** No CI can boot Forza Horizon 6 itself, so end-to-end validation stays manual: build, install into the game, exercise search, then library, then radio, then lyrics, then manual-station fallback, live.

## Out of scope

- Changes to any other source (local files, Spotify, Jellyfin, online radio, external audio) or the generic multi-source dashboard chrome used when those are active.
- Reimplementing YouTube's stream-extraction/signature-cipher logic; yt-dlp remains the sole audio-extraction path.
- A CI pipeline that actually boots FH6 for integration testing.
