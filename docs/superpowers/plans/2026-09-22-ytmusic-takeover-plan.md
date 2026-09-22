# YouTube Music Takeover Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the fork's YouTube Music source real search, an account-backed library, autoplay radio, and lyrics, wired into a dedicated full-takeover UI, plus fix the yt-dlp full-playlist re-resolve cost the live deployment's log shows.

**Architecture:** A new `fh6::ytmusic::InnertubeClient` (POST+JSON against `music.youtube.com`'s private web-client API) supplies search, library, radio continuation, and lyrics metadata. `yt-dlp` keeps owning audio extraction, untouched. `YouTubeMusicSource` gains a disk-backed queue cache and three new ephemeral-play entry points. New HTTP endpoints expose all of it. The frontend gets a new `ui/dist/js/ytmusic/` module tree that fully replaces the dashboard chrome (sidebar nav, collapsing to bottom tabs on phone) when YouTube Music is the active source.

**Tech Stack:** C++20 (existing codebase), nlohmann::json (already vendored), WinHTTP (existing `net::http_get` pattern), vanilla JS ES modules, vitest.

**Spec:** `docs/superpowers/specs/2026-09-22-ytmusic-takeover-design.md`

## Global Constraints

- Other sources (local files, Spotify, Jellyfin, online radio, external audio) and the generic multi-source dashboard chrome they use are untouched.
- `yt-dlp` remains the sole audio-extraction path. Innertube is metadata only (search, library, radio continuation, lyrics), never stream URLs.
- Manual paste-URL stations keep working exactly as today, unchanged, alongside the new account library.
- C++ code in this repo has no unit test framework. Validation is a successful build plus manual in-game/log verification, per the spec's Testing section. Do not invent a pytest-style red/green cycle for C++ tasks; follow the codebase's actual convention (see Task 3 onward).
- Frontend code uses vitest. Real TDD (failing test, then passing) applies to every JS task.
- Never use em dashes or spaced en dashes in code comments, commit messages, or docs. Use commas, periods, colons, parentheses, or a plain ASCII `--` (the existing codebase's own style, e.g. `safe_mem.hpp`, `subprocess.hpp`).
- Innertube is an unofficial, reverse-engineered API. Every JSON parse in `InnertubeClient` must be exception-guarded and degrade to a typed error result, never throw out of a public method.

---

### Task 1: Fix the broken frontend test suite (prerequisite)

The existing `ui/test/` suite fails on module resolution today: several tests import from pre-refactor paths, and `api.test.js` calls flat API methods that were nested under `sourceApi()` namespaces during a refactor. This must work before any new ytmusic tests are added.

**Files:**
- Modify: `ui/test/api.test.js`
- Modify: `ui/test/store.test.js`
- Modify: `ui/test/format.test.js`
- Modify: `ui/test/routing.test.js`

**Interfaces:**
- Consumes: the real `ui/dist/js/data/api.js`, `ui/dist/js/lib/store.js`, `ui/dist/js/lib/format.js` module shapes (already read from the live source, see the method list below).
- Produces: a working `npm run test` entry point later tasks' new tests depend on.

- [ ] **Step 1: Fix the four stale import paths**

In `ui/test/store.test.js`, change:
```js
import { changed, resetMemo } from "../dist/js/store.js";
```
to:
```js
import { changed, resetMemo } from "../dist/js/lib/store.js";
```

In `ui/test/format.test.js`, change:
```js
import { fmt, clamp, percent, progressRatio, db } from "../dist/js/format.js";
```
to:
```js
import { fmt, clamp, percent, progressRatio, db } from "../dist/js/lib/format.js";
```

In `ui/test/api.test.js` and `ui/test/routing.test.js`, change:
```js
import { api } from "../dist/js/api.js";
```
to:
```js
import { api } from "../dist/js/data/api.js";
```

- [ ] **Step 2: Fix `api.test.js`'s stale flat method calls**

The real `api.js` nests youtube_music, jellyfin, and local_files calls under `sourceApi()`-built namespaces. Replace every call in `ui/test/api.test.js` accordingly:

```js
// was: await api.castYoutube("https://yt");
await api.youtubeMusic.cast("https://yt");

// was: await api.shuffleYoutube(true);
await api.youtubeMusic.shuffle(true);

// was: await api.castJellyfin("pl-1");
await api.jellyfin.cast("pl-1", false);

// was: await api.getLocalStations();
await api.localFiles.getStations();

// was: await api.putLocalStations(stations, "Rock");
await api.localFiles.putStations(stations, "Rock");

// was: await api.activateLocalStation("Rock");
await api.localFiles.activateStation("Rock");

// was: await api.getLocalQueue();
await api.localFiles.getQueue();

// was: await api.playLocalIndex(7);
await api.localFiles.playIndex(7);

// was: await api.castJellyfin("x") in the error-path test
await api.jellyfin.cast("x", false);
```

Note `jellyfin.cast` takes `(playlistId, useFavorites)`, two args, not one, per the real `api.js`. Update the assertion for that call too:
```js
it("casts and shuffle carry the right body", async () => {
  await api.youtubeMusic.cast("https://yt");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/cast",
    body: { url: "https://yt" },
  });

  await api.youtubeMusic.shuffle(true);
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/shuffle",
    body: { shuffle: true },
  });

  await api.jellyfin.cast("pl-1", false);
  expect(lastCall()).toMatchObject({
    path: "/api/source/jellyfin/cast",
    body: { playlist_id: "pl-1", use_favorites: false },
  });
});
```

- [ ] **Step 3: Run the suite and record the result**

Run: `npm install && npm run test`

Expected: `api.test.js`, `store.test.js`, `format.test.js`, `routing.test.js` pass. Some `render/*.test.js` files may still fail for reasons unrelated to import paths (for example, i18n strings not being loaded in that test's environment). That is a pre-existing, separate defect, out of scope for this task. Record the exact pass/fail counts in the commit message so it is visible for later cleanup, do not silently mask or delete failing tests.

- [ ] **Step 4: Commit**

```bash
git add ui/test/api.test.js ui/test/store.test.js ui/test/format.test.js ui/test/routing.test.js
git commit -m "test: fix stale import paths and api call shapes in ui/test

api.js, store.js, and format.js moved under data/ and lib/ during an
earlier refactor; these tests still imported the old paths and called
flat api.castYoutube-style methods that are now namespaced under
sourceApi(). Fixes npm run test module resolution."
```

---

### Task 2: Add `net::http_post`

`InnertubeClient` needs a POST-with-JSON-body HTTP call. `net::http_get` (GET only) already has the WinHTTP plumbing to mirror.

**Files:**
- Modify: `include/fh6/net/http_get.hpp`
- Modify: `src/net/http_get.cpp`

**Interfaces:**
- Consumes: nothing new (same WinHTTP APIs `http_get` already uses).
- Produces: `std::optional<std::string> fh6::net::http_post(std::string_view url, std::string_view json_body, const std::vector<std::string>& extra_headers = {})`, used by Task 3.

- [ ] **Step 1: Declare `http_post`**

In `include/fh6/net/http_get.hpp`, add alongside the existing declaration:

```cpp
#pragma once

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace fh6::net {

// Blocking in-memory HTTP(S) GET. Body on HTTP 200, else nullopt. 5 s timeouts.
// extra_header is an optional raw header line (e.g. "Authorization: ...").
std::optional<std::string> http_get(std::string_view url, std::string_view extra_header = {});

// Blocking in-memory HTTP(S) POST with a JSON body. Body on 2xx, else
// nullopt. 5 s timeouts. extra_headers are raw header lines (e.g.
// "Cookie: name=value; name2=value2"), sent in addition to
// "Content-Type: application/json", which this always sets itself.
std::optional<std::string> http_post(std::string_view url, std::string_view json_body,
                                     const std::vector<std::string>& extra_headers = {});

} // namespace fh6::net
```

- [ ] **Step 2: Implement `http_post`**

In `src/net/http_get.cpp`, add the implementation after `http_get`, reusing the same URL-cracking and read-loop structure:

```cpp
std::optional<std::string> http_post(std::string_view url, std::string_view json_body,
                                     const std::vector<std::string>& extra_headers) {
    std::wstring wurl = subprocess::widen(std::string(url));

    URL_COMPONENTS urlComp = {0};
    urlComp.dwStructSize = sizeof(urlComp);
    urlComp.dwHostNameLength = static_cast<DWORD>(-1);
    urlComp.dwUrlPathLength = static_cast<DWORD>(-1);
    urlComp.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &urlComp)) {
        log::error("[http] WinHttpCrackUrl failed for POST {}", std::string(url));
        return std::nullopt;
    }

    std::wstring hostName{urlComp.lpszHostName, urlComp.dwHostNameLength};
    std::wstring requestTarget{urlComp.lpszUrlPath, urlComp.dwUrlPathLength};
    if (urlComp.dwExtraInfoLength > 0 && urlComp.lpszExtraInfo)
        requestTarget.append(urlComp.lpszExtraInfo, urlComp.dwExtraInfoLength);
    if (requestTarget.empty()) requestTarget = L"/";

    HINTERNET hSession = WinHttpOpen(L"FH6 Universal Radio/1.0",
                                     WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                     WINHTTP_NO_PROXY_NAME,
                                     WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) {
        log::error("[http] WinHttpOpen failed (POST)");
        return std::nullopt;
    }
    WinHttpSetTimeouts(hSession, 5000, 10000, 10000, 15000);

    struct SessionGuard {
        HINTERNET h;
        ~SessionGuard() { if (h) WinHttpCloseHandle(h); }
    } sg{hSession};

    HINTERNET hConnect = WinHttpConnect(hSession, hostName.c_str(), urlComp.nPort, 0);
    if (!hConnect) {
        log::error("[http] WinHttpConnect failed (POST)");
        return std::nullopt;
    }
    SessionGuard cg{hConnect};

    DWORD flags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"POST", requestTarget.c_str(),
                                            nullptr, WINHTTP_NO_REFERER,
                                            WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
    if (!hRequest) {
        log::error("[http] WinHttpOpenRequest failed (POST)");
        return std::nullopt;
    }
    SessionGuard rg{hRequest};

    std::wstring headers = L"Content-Type: application/json\r\n";
    for (const auto& h : extra_headers) {
        headers += subprocess::widen(h);
        headers += L"\r\n";
    }

    std::string body{json_body};
    if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(-1),
                            body.empty() ? WINHTTP_NO_REQUEST_DATA : body.data(),
                            static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size(), 0))) {
        log::error("[http] WinHttpSendRequest failed (POST)");
        return std::nullopt;
    }

    if (!WinHttpReceiveResponse(hRequest, nullptr)) {
        log::error("[http] WinHttpReceiveResponse failed (POST)");
        return std::nullopt;
    }

    DWORD statusCode = 0, dwSize = sizeof(statusCode);
    WinHttpQueryHeaders(hRequest, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &dwSize, WINHTTP_NO_HEADER_INDEX);
    if (statusCode < 200 || statusCode >= 300) {
        log::error("[http] Non-2xx HTTP Response ({}) for POST {}", statusCode, std::string(url));
        return std::nullopt;
    }

    constexpr std::size_t kMaxHttpBodyBytes = 10 * 1024 * 1024;
    std::string responseBody;
    DWORD dwDownloaded = 0;
    do {
        DWORD dwAvailable = 0;
        if (!WinHttpQueryDataAvailable(hRequest, &dwAvailable)) {
            log::error("[http] WinHttpQueryDataAvailable failed (POST)");
            return std::nullopt;
        }
        if (dwAvailable == 0) break;
        if (dwAvailable > kMaxHttpBodyBytes - responseBody.size()) {
            log::error("[http] POST response exceeded maximum download size");
            return std::nullopt;
        }
        std::vector<char> buffer(dwAvailable);
        if (!WinHttpReadData(hRequest, buffer.data(), dwAvailable, &dwDownloaded)) {
            log::error("[http] WinHttpReadData failed (POST)");
            return std::nullopt;
        }
        responseBody.append(buffer.data(), dwDownloaded);
    } while (dwDownloaded > 0);

    return responseBody;
}
```

There is a typo above deliberately called out for the implementer to fix while typing it in: `static_cast<DWORD>(body.size(), 0)` is invalid C++ (two-arg `static_cast`). The last argument to `WinHttpSendRequest` is `dwOptionalLength`, which equals the body size again:
```cpp
if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(-1),
                        body.empty() ? WINHTTP_NO_REQUEST_DATA : body.data(),
                        static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0)) {
```

- [ ] **Step 3: Build to verify it compiles**

Run: `powershell -File scripts/build.ps1` (Windows) or `scripts/build.sh` (Linux cross-compile), from the repo root.

Expected: build succeeds, no new warnings from `http_get.cpp`.

- [ ] **Step 4: Commit**

```bash
git add include/fh6/net/http_get.hpp src/net/http_get.cpp
git commit -m "feat(net): add http_post alongside the existing http_get

InnertubeClient (next task) needs a POST-with-JSON-body call; this
mirrors http_get's WinHTTP plumbing (5 s timeouts, 10 MB body cap,
2xx-only) with a request body and extra headers instead."
```

---

### Task 3: `InnertubeClient` core plus `search()`

**Files:**
- Create: `include/fh6/sources/ytmusic_client.hpp`
- Create: `src/sources/ytmusic_client.cpp`

**Interfaces:**
- Consumes: `fh6::net::http_post` (Task 2), `fh6::log`, `nlohmann::json`.
- Produces: `fh6::ytmusic::InnertubeClient`, `fh6::ytmusic::SearchResultItem`, `fh6::ytmusic::InnertubeStatus`, `fh6::ytmusic::Result<T>`, used by every later backend task.

- [ ] **Step 1: Write the header**

```cpp
// include/fh6/sources/ytmusic_client.hpp
#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace fh6::ytmusic {

struct SearchResultItem {
    std::string video_id;   // empty for non-song results (albums, artists, playlists)
    std::string browse_id;  // empty for songs; the id to pass to InnertubeClient::browse_playlist
    std::string title;
    std::string subtitle;   // artist / album / channel line, joined loosely
    std::string thumbnail_url;
};

struct QueueTrack {
    std::string video_id;
    std::string title;
    std::string artist;
    std::string thumbnail_url;
    std::uint64_t duration_ms = 0;
};

struct LibraryPlaylist {
    std::string browse_id;
    std::string title;
    std::string thumbnail_url;
};

struct LibrarySnapshot {
    std::vector<QueueTrack> liked_songs;
    std::vector<LibraryPlaylist> playlists;
    std::vector<LibraryPlaylist> subscriptions;
};

enum class InnertubeStatus { ok, needs_auth, network_error, parse_error };

template <class T> struct Result {
    InnertubeStatus status = InnertubeStatus::network_error;
    T value{};
    bool ok() const noexcept { return status == InnertubeStatus::ok; }
};

// Talks to music.youtube.com's private web-client API ("Innertube"). Search,
// library, radio continuation, lyrics. Never resolves a playable stream URL,
// yt-dlp still owns audio extraction; see
// docs/superpowers/specs/2026-09-22-ytmusic-takeover-design.md for why.
//
// This is a reverse-engineered, unofficial API. Every public method is
// exception-guarded and degrades to InnertubeStatus::parse_error on a shape
// mismatch instead of throwing, since Google can reshape responses without
// notice.
class InnertubeClient {
public:
    // cookies_path: the same Netscape-format cookies.txt YouTubeMusicConfig
    // already points yt-dlp at. Empty path = unauthenticated requests only
    // (search still works; library requires an authenticated account).
    explicit InnertubeClient(std::filesystem::path cookies_path);

    Result<std::vector<SearchResultItem>> search(const std::string& query) const;
    Result<std::vector<QueueTrack>> browse_playlist(const std::string& browse_id) const;
    Result<LibrarySnapshot> browse_library() const;
    Result<std::vector<QueueTrack>> next(const std::string& video_id) const;
    Result<std::string> lyrics(const std::string& video_id) const;

    bool authenticated() const noexcept { return !cookie_header_.empty(); }

private:
    std::string post(std::string_view endpoint, const std::string& body_json) const;

    std::filesystem::path cookies_path_;
    std::string cookie_header_;
};

} // namespace fh6::ytmusic
```

- [ ] **Step 2: Write `ytmusic_client.cpp`, part one: cookies, context, transport, generic JSON walkers**

```cpp
// src/sources/ytmusic_client.cpp
#include "fh6/sources/ytmusic_client.hpp"
#include "fh6/log.hpp"
#include "fh6/net/http_get.hpp"

#include <nlohmann/json.hpp>

#include <fstream>
#include <format>

namespace fh6::ytmusic {

namespace {

using json = nlohmann::json;

// Netscape cookies.txt: tab-separated domain, includeSubdomains, path,
// secure, expiry, name, value; "#"-prefixed lines are comments. Only
// youtube.com-scoped cookies are relevant here.
std::string load_cookie_header(const std::filesystem::path& path) {
    if (path.empty()) return {};
    std::ifstream in{path};
    if (!in) return {};

    std::string out;
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty() || line.front() == '#') continue;
        std::vector<std::string> cols;
        std::size_t start = 0;
        for (std::size_t i = 0; i <= line.size(); ++i) {
            if (i == line.size() || line[i] == '\t') {
                cols.push_back(line.substr(start, i - start));
                start = i + 1;
            }
        }
        if (cols.size() < 7) continue;
        if (cols[0].find("youtube.com") == std::string::npos) continue;
        const std::string& name = cols[5];
        const std::string& value = cols[6];
        if (name.empty()) continue;
        if (!out.empty()) out += "; ";
        out += name;
        out += '=';
        out += value;
    }
    return out;
}

// The fixed context blob the real WEB_REMIX web client sends with every
// request. clientVersion drifts over time; Innertube tolerates a
// stale-but-recent value. Bump this if requests start failing outright.
constexpr const char* kContext = R"({
    "client": {
        "clientName": "WEB_REMIX",
        "clientVersion": "1.20241201.01.00",
        "hl": "en",
        "gl": "US"
    }
})";

// Public key embedded in every music.youtube.com page's HTML. Not a secret:
// every unofficial YT Music client (ytmusicapi included) uses this same
// constant, it is the browser web app's own client-side API key.
constexpr std::string_view kApiKey = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

bool looks_unauthenticated(const json& root) noexcept {
    if (!root.contains("error") || !root["error"].is_object()) return false;
    const auto& err = root["error"];
    if (err.contains("status") && err["status"].is_string() &&
        err["status"].get<std::string>() == "UNAUTHENTICATED")
        return true;
    if (err.contains("code") && err["code"].is_number()) {
        const int code = err["code"].get<int>();
        if (code == 401 || code == 403) return true;
    }
    return false;
}

// Innertube's response tree nests arbitrarily deep and reshapes between UI
// experiments. Walking for known leaf keys anywhere in the tree survives
// that far better than a hardcoded path of array indices, which is the
// single most fragile thing about an unofficial API integration.
void collect_strings(const json& node, std::string_view key, std::vector<std::string>& out) {
    if (node.is_object()) {
        for (auto& [k, v] : node.items()) {
            if (k == key && v.is_string()) out.push_back(v.get<std::string>());
            collect_strings(v, key, out);
        }
    } else if (node.is_array()) {
        for (auto& v : node) collect_strings(v, key, out);
    }
}

void collect_objects(const json& node, std::string_view key, std::vector<json>& out) {
    if (node.is_object()) {
        for (auto& [k, v] : node.items()) {
            if (k == key) out.push_back(v);
            collect_objects(v, key, out);
        }
    } else if (node.is_array()) {
        for (auto& v : node) collect_objects(v, key, out);
    }
}

std::string first_string(const json& node, std::string_view key) {
    std::vector<std::string> hits;
    collect_strings(node, key, hits);
    return hits.empty() ? std::string{} : hits.front();
}

// "thumbnails" leaves are themselves arrays of {url,width,height}, smallest
// to largest; take the last (largest) of the first array found.
std::string best_thumbnail(const json& node) {
    std::vector<json> arrays;
    collect_objects(node, "thumbnails", arrays);
    for (auto& arr : arrays) {
        if (arr.is_array() && !arr.empty() && arr.back().contains("url") &&
            arr.back()["url"].is_string())
            return arr.back()["url"].get<std::string>();
    }
    return {};
}

// "3:45" or "1:02:03" -> milliseconds. Anything else (a non-duration text
// run the generic walker also picked up) parses to 0, treated as unknown,
// matching how the rest of the codebase treats duration_ms == 0.
std::uint64_t parse_duration_to_ms(std::string_view text) noexcept {
    int parts[3] = {0, 0, 0};
    int n = 0;
    int cur = 0;
    bool any_digit = false;
    for (char c : text) {
        if (c >= '0' && c <= '9') {
            cur = cur * 10 + (c - '0');
            any_digit = true;
        } else if (c == ':' && n < 2) {
            parts[n++] = cur;
            cur = 0;
        } else {
            return 0;
        }
    }
    if (!any_digit) return 0;
    parts[n] = cur;
    std::uint64_t h = 0, m = 0, s = 0;
    if (n == 2) {
        h = static_cast<std::uint64_t>(parts[0]);
        m = static_cast<std::uint64_t>(parts[1]);
        s = static_cast<std::uint64_t>(parts[2]);
    } else if (n == 1) {
        m = static_cast<std::uint64_t>(parts[0]);
        s = static_cast<std::uint64_t>(parts[1]);
    } else {
        return 0;
    }
    return (h * 3600 + m * 60 + s) * 1000ull;
}

} // namespace

InnertubeClient::InnertubeClient(std::filesystem::path cookies_path)
    : cookies_path_{std::move(cookies_path)}, cookie_header_{load_cookie_header(cookies_path_)} {}

std::string InnertubeClient::post(std::string_view endpoint, const std::string& body_json) const {
    std::string url = std::format("https://music.youtube.com{}?key={}", endpoint, kApiKey);
    std::vector<std::string> headers = {"Origin: https://music.youtube.com"};
    if (!cookie_header_.empty()) headers.push_back("Cookie: " + cookie_header_);
    auto resp = net::http_post(url, body_json, headers);
    return resp.value_or(std::string{});
}

Result<std::vector<SearchResultItem>> InnertubeClient::search(const std::string& query) const {
    json body = {{"context", json::parse(kContext)}, {"query", query}};
    const std::string resp = post("/youtubei/v1/search", body.dump());
    if (resp.empty()) return {InnertubeStatus::network_error, {}};

    try {
        auto root = json::parse(resp);
        if (looks_unauthenticated(root)) return {InnertubeStatus::needs_auth, {}};

        std::vector<json> items;
        collect_objects(root, "musicResponsiveListItemRenderer", items);

        std::vector<SearchResultItem> out;
        out.reserve(items.size());
        for (auto& item : items) {
            SearchResultItem it;
            it.video_id = first_string(item, "videoId");
            it.browse_id = first_string(item, "browseId");
            it.thumbnail_url = best_thumbnail(item);

            std::vector<std::string> texts;
            collect_strings(item, "text", texts);
            if (!texts.empty()) it.title = texts.front();
            for (std::size_t i = 1; i < texts.size(); ++i) {
                if (!it.subtitle.empty()) it.subtitle += ' ';
                it.subtitle += texts[i];
            }

            if (!it.video_id.empty() || !it.browse_id.empty()) out.push_back(std::move(it));
        }
        return {InnertubeStatus::ok, std::move(out)};
    } catch (const std::exception& e) {
        log::warn("[ytmusic] search parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }
}

} // namespace fh6::ytmusic
```

- [ ] **Step 3: Build to verify it compiles**

`browse_playlist`, `browse_library`, `next`, and `lyrics` are declared but not yet defined; this task only implements `search`. Temporarily stub the rest so the target links, for example:

```cpp
Result<std::vector<QueueTrack>> InnertubeClient::browse_playlist(const std::string&) const {
    return {InnertubeStatus::parse_error, {}};
}
Result<LibrarySnapshot> InnertubeClient::browse_library() const {
    return {InnertubeStatus::parse_error, {}};
}
Result<std::vector<QueueTrack>> InnertubeClient::next(const std::string&) const {
    return {InnertubeStatus::parse_error, {}};
}
Result<std::string> InnertubeClient::lyrics(const std::string&) const {
    return {InnertubeStatus::parse_error, {}};
}
```

Add `src/sources/ytmusic_client.cpp` to the `version` target in `CMakeLists.txt` now (Task 7 also touches this file for the final wiring; adding the source list entry here is required just to build this task).

Run: `powershell -File scripts/build.ps1`

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add include/fh6/sources/ytmusic_client.hpp src/sources/ytmusic_client.cpp CMakeLists.txt
git commit -m "feat(ytmusic): add InnertubeClient with search()

New POST+JSON client against music.youtube.com's private web API,
used for search/library/radio/lyrics metadata only, yt-dlp keeps
owning audio extraction. Parses defensively via a generic key-walker
instead of hardcoded JSON paths, since this is an unofficial API that
can reshape without notice. browse_playlist/browse_library/next/
lyrics are stubbed here, implemented in the next two tasks."
```

---

### Task 4: `InnertubeClient::browse_playlist` and `browse_library`

**Files:**
- Modify: `src/sources/ytmusic_client.cpp`

**Interfaces:**
- Consumes: `collect_objects`, `first_string`, `best_thumbnail`, `parse_duration_to_ms`, `looks_unauthenticated`, `post` (all from Task 3, same translation unit).
- Produces: working `browse_playlist(browse_id)` and `browse_library()`, used by Task 6.

- [ ] **Step 1: Implement `browse_playlist`, replacing its Task 3 stub**

```cpp
Result<std::vector<QueueTrack>> InnertubeClient::browse_playlist(const std::string& browse_id) const {
    json body = {{"context", json::parse(kContext)}, {"browseId", browse_id}};
    const std::string resp = post("/youtubei/v1/browse", body.dump());
    if (resp.empty()) return {InnertubeStatus::network_error, {}};

    try {
        auto root = json::parse(resp);
        if (looks_unauthenticated(root)) return {InnertubeStatus::needs_auth, {}};

        std::vector<json> items;
        collect_objects(root, "musicResponsiveListItemRenderer", items);

        std::vector<QueueTrack> out;
        out.reserve(items.size());
        for (auto& item : items) {
            QueueTrack t;
            t.video_id = first_string(item, "videoId");
            if (t.video_id.empty()) continue; // a header/non-playable row, not a track
            t.thumbnail_url = best_thumbnail(item);

            std::vector<std::string> texts;
            collect_strings(item, "text", texts);
            if (!texts.empty()) t.title = texts.front();
            if (texts.size() > 1) t.artist = texts[1];
            for (auto& s : texts) {
                if (auto ms = parse_duration_to_ms(s); ms > 0) {
                    t.duration_ms = ms;
                    break;
                }
            }
            out.push_back(std::move(t));
        }
        return {InnertubeStatus::ok, std::move(out)};
    } catch (const std::exception& e) {
        log::warn("[ytmusic] browse_playlist parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }
}
```

- [ ] **Step 2: Implement `browse_library`, replacing its Task 3 stub**

```cpp
Result<LibrarySnapshot> InnertubeClient::browse_library() const {
    if (!authenticated()) return {InnertubeStatus::needs_auth, {}};

    LibrarySnapshot snap;

    // "LM" is Innertube's well-known fixed playlist id for the account's
    // Liked Music auto-playlist (same constant ytmusicapi uses). Verify
    // against a real logged-in account during manual testing per the design
    // doc's Innertube-drift handling; adjust here if Google has since
    // changed it.
    if (auto liked = browse_playlist("VLLM"); liked.ok()) {
        snap.liked_songs = std::move(liked.value);
    } else if (liked.status == InnertubeStatus::needs_auth) {
        return {InnertubeStatus::needs_auth, {}};
    }

    // "FEmusic_liked_playlists" is Innertube's fixed browse id for the
    // account's playlist library grid. Same verify-and-adjust note as above.
    json body = {{"context", json::parse(kContext)}, {"browseId", "FEmusic_liked_playlists"}};
    const std::string resp = post("/youtubei/v1/browse", body.dump());
    if (resp.empty()) return {InnertubeStatus::network_error, {}};

    try {
        auto root = json::parse(resp);
        if (looks_unauthenticated(root)) return {InnertubeStatus::needs_auth, {}};

        // Playlist library tiles use musicTwoRowItemRenderer (a grid card),
        // not musicResponsiveListItemRenderer (a list row).
        std::vector<json> tiles;
        collect_objects(root, "musicTwoRowItemRenderer", tiles);
        for (auto& tile : tiles) {
            LibraryPlaylist p;
            p.browse_id = first_string(tile, "browseId");
            if (p.browse_id.empty()) continue;
            p.thumbnail_url = best_thumbnail(tile);
            std::vector<std::string> texts;
            collect_strings(tile, "text", texts);
            if (!texts.empty()) p.title = texts.front();
            snap.playlists.push_back(std::move(p));
        }
        return {InnertubeStatus::ok, std::move(snap)};
    } catch (const std::exception& e) {
        log::warn("[ytmusic] browse_library parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }
}
```

Subscriptions are deliberately left empty in `snap.subscriptions` for this task; the design doc treats subscriptions as reusing the `LibraryPlaylist` shape but its browse id needs verification against a real account, do that as a follow-up once account-backed testing is underway rather than guessing a second unverified constant here.

- [ ] **Step 3: Build to verify it compiles**

Run: `powershell -File scripts/build.ps1`

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/sources/ytmusic_client.cpp
git commit -m "feat(ytmusic): implement InnertubeClient browse_playlist and browse_library

browse_playlist resolves any playlist's tracklist (used for both
account playlists and, later, the queue cache). browse_library wraps
the Liked Music auto-playlist (fixed id LM) and the playlist library
grid (fixed id FEmusic_liked_playlists). Both fixed ids are flagged
for verification against a real account during manual testing, since
Innertube's library browse ids are undocumented and can drift."
```

---

### Task 5: `InnertubeClient::next` (radio) and `lyrics`

**Files:**
- Modify: `src/sources/ytmusic_client.cpp`

**Interfaces:**
- Consumes: same helpers as Task 4.
- Produces: working `next(video_id)` and `lyrics(video_id)`, used by Task 6.

- [ ] **Step 1: Implement `next`, replacing its Task 3 stub**

```cpp
Result<std::vector<QueueTrack>> InnertubeClient::next(const std::string& video_id) const {
    // isAudioOnly + a plain videoId body is Innertube's radio/autoplay
    // continuation: the same "start radio" queue the WEB_REMIX player
    // builds when a track is played with radio enabled.
    json body = {{"context", json::parse(kContext)}, {"videoId", video_id}, {"isAudioOnly", true}};
    const std::string resp = post("/youtubei/v1/next", body.dump());
    if (resp.empty()) return {InnertubeStatus::network_error, {}};

    try {
        auto root = json::parse(resp);
        if (looks_unauthenticated(root)) return {InnertubeStatus::needs_auth, {}};

        std::vector<json> items;
        collect_objects(root, "playlistPanelVideoRenderer", items);

        std::vector<QueueTrack> out;
        out.reserve(items.size());
        for (auto& item : items) {
            QueueTrack t;
            t.video_id = first_string(item, "videoId");
            if (t.video_id.empty()) continue;
            t.thumbnail_url = best_thumbnail(item);

            std::vector<std::string> texts;
            collect_strings(item, "text", texts);
            if (!texts.empty()) t.title = texts.front();
            if (texts.size() > 1) t.artist = texts[1];
            for (auto& s : texts) {
                if (auto ms = parse_duration_to_ms(s); ms > 0) {
                    t.duration_ms = ms;
                    break;
                }
            }
            if (t.video_id != video_id) out.push_back(std::move(t)); // drop the seed track itself
        }
        return {InnertubeStatus::ok, std::move(out)};
    } catch (const std::exception& e) {
        log::warn("[ytmusic] next (radio) parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }
}
```

- [ ] **Step 2: Implement `lyrics`, replacing its Task 3 stub**

Lyrics is a two-step Innertube call: `next` returns a `browseId` for the lyrics panel (when one exists), then `browse` with that id returns the text. Reuse `next`'s raw response instead of calling the public `next()` method again, to avoid a redundant network round trip when a caller wants both the radio queue and lyrics for the same track; keep it simple here as its own independent call, since lyrics are fetched lazily and separately per the design doc (opened on demand, not prefetched per track):

```cpp
Result<std::string> InnertubeClient::lyrics(const std::string& video_id) const {
    json next_body = {{"context", json::parse(kContext)}, {"videoId", video_id}};
    const std::string next_resp = post("/youtubei/v1/next", next_body.dump());
    if (next_resp.empty()) return {InnertubeStatus::network_error, {}};

    std::string lyrics_browse_id;
    try {
        auto root = json::parse(next_resp);
        if (looks_unauthenticated(root)) return {InnertubeStatus::needs_auth, {}};

        // The lyrics tab's browseId is prefixed "MPLYt" in every known
        // Innertube response; the generic walker collects every browseId in
        // the tree, so filter for that prefix rather than trusting position.
        std::vector<std::string> ids;
        collect_strings(root, "browseId", ids);
        for (auto& id : ids) {
            if (id.starts_with("MPLYt")) {
                lyrics_browse_id = id;
                break;
            }
        }
    } catch (const std::exception& e) {
        log::warn("[ytmusic] lyrics (locating tab) parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }

    if (lyrics_browse_id.empty()) return {InnertubeStatus::ok, {}}; // no lyrics for this track, not an error

    json browse_body = {{"context", json::parse(kContext)}, {"browseId", lyrics_browse_id}};
    const std::string browse_resp = post("/youtubei/v1/browse", browse_body.dump());
    if (browse_resp.empty()) return {InnertubeStatus::network_error, {}};

    try {
        auto root = json::parse(browse_resp);
        // Lyrics text lives in a single "description" run in the lyrics
        // renderer; take the longest string found anywhere in the tree as a
        // pragmatic stand-in for "the one that's the actual lyrics block",
        // since short UI labels are also plain strings in the same tree.
        std::vector<std::string> texts;
        collect_strings(root, "description", texts);
        std::string best;
        for (auto& s : texts)
            if (s.size() > best.size()) best = s;
        return {InnertubeStatus::ok, std::move(best)};
    } catch (const std::exception& e) {
        log::warn("[ytmusic] lyrics (fetching text) parse failed: {}", e.what());
        return {InnertubeStatus::parse_error, {}};
    }
}
```

- [ ] **Step 3: Build to verify it compiles**

Run: `powershell -File scripts/build.ps1`

Expected: build succeeds. `InnertubeClient` now has all five real methods, no stubs remain.

- [ ] **Step 4: Commit**

```bash
git add src/sources/ytmusic_client.cpp
git commit -m "feat(ytmusic): implement InnertubeClient next (radio) and lyrics

next() builds the radio/autoplay continuation queue for a seed track,
dropping the seed itself from the result. lyrics() is a two-step
call: locate the lyrics tab's browseId (prefixed MPLYt in every known
Innertube response) via next, then browse it for the text; no lyrics
found returns ok with an empty string, not an error, per the design
doc's error handling section."
```

---

### Task 6: `YouTubeMusicSource` gets an `InnertubeClient`, a disk-backed queue cache, and three new play entry points

This is the task that fixes the re-resolve cost seen in the live deployment's `bridge.log` and wires the new metadata surface into the existing audio source.

**Files:**
- Modify: `include/fh6/sources/youtube_music_source.hpp`
- Modify: `src/sources/youtube_music_source.cpp`

**Interfaces:**
- Consumes: `fh6::ytmusic::InnertubeClient` and its types (Tasks 3 to 5).
- Produces:
  - `ytmusic::Result<std::vector<ytmusic::SearchResultItem>> YouTubeMusicSource::search_catalog(const std::string&) const`
  - `ytmusic::Result<ytmusic::LibrarySnapshot> YouTubeMusicSource::library_snapshot() const`
  - `ytmusic::Result<std::string> YouTubeMusicSource::track_lyrics(const std::string&) const`
  - `bool YouTubeMusicSource::cast_library_playlist(std::string browse_id)`
  - `bool YouTubeMusicSource::start_radio(std::string seed_video_id)`

  All five are used by Task 8 (HTTP endpoints).

- [ ] **Step 1: Add the header declarations**

In `include/fh6/sources/youtube_music_source.hpp`, add the include and the new public methods:

```cpp
#include "fh6/sources/ytmusic_client.hpp"
```

Inside `class YouTubeMusicSource`, in the public section, add:

```cpp
    // Account/catalog metadata, backed by Innertube. Never touches the audio
    // pipeline; safe to call from the HTTP thread while playback runs.
    ytmusic::Result<std::vector<ytmusic::SearchResultItem>> search_catalog(const std::string& query) const;
    ytmusic::Result<ytmusic::LibrarySnapshot> library_snapshot() const;
    ytmusic::Result<std::string> track_lyrics(const std::string& video_id) const;

    // Ephemeral plays: not persisted as a saved station (unlike
    // set_active_station), mirrors set_target()'s one-off cast semantics.
    bool cast_library_playlist(std::string browse_id);
    bool start_radio(std::string seed_video_id);
```

In the private section, add:

```cpp
    // Innertube-resolved playlist cache. Keyed by browse_id, on disk at
    // <data_dir>/ytmusic_cache/<browse_id>.json, TTL-refreshed in the
    // background. Fixes the full yt-dlp --flat-playlist re-resolve every
    // station reactivation used to cost.
    struct CachedQueue {
        std::vector<ytmusic::QueueTrack> tracks;
        std::int64_t fetched_at_unix = 0;
    };
    std::optional<CachedQueue> load_cached_queue(const std::string& browse_id) const;
    void save_cached_queue(const std::string& browse_id, const std::vector<ytmusic::QueueTrack>& tracks) const;
    void refresh_cache_in_background(std::string browse_id);

    ytmusic::InnertubeClient client_;
    std::filesystem::path cache_dir_;
    std::atomic<bool> cache_refreshing_{false};
```

- [ ] **Step 2: Construct `client_` and `cache_dir_`, and thread a data directory into the constructor**

`YouTubeMusicSource`'s constructor today takes `(YouTubeMusicConfig cfg, std::filesystem::path ffmpeg_path, worker::WorkerClient* worker)`. Add a `data_dir` parameter, matching the pattern `LocalFileSource` already uses for `index_path`:

```cpp
YouTubeMusicSource::YouTubeMusicSource(YouTubeMusicConfig cfg, std::filesystem::path ffmpeg_path,
                                       std::filesystem::path data_dir, worker::WorkerClient* worker)
    : cfg_{std::move(cfg)}, ffmpeg_path_{std::move(ffmpeg_path)}, worker_{worker},
      client_{cfg_.cookies_path}, cache_dir_{data_dir / "ytmusic_cache"} {
    std::error_code ec;
    std::filesystem::create_directories(cache_dir_, ec);
}
```

Update the matching header constructor signature in `youtube_music_source.hpp` to match. Update the one call site in `src/bridge.cpp`:

```cpp
// was:
// auto src = std::make_unique<sources::YouTubeMusicSource>(c.youtube_music,
//                                                          c.general.ffmpeg_path,
//                                                          worker.get());
auto src = std::make_unique<sources::YouTubeMusicSource>(c.youtube_music,
                                                          c.general.ffmpeg_path,
                                                          data_dir,
                                                          worker.get());
```

`set_config` needs to rebuild `client_` when `cookies_path` changes (mirrors how `SpotifySource::set_config` just stores new paths for the next pipe start; here it is simpler since `InnertubeClient` is cheap to construct, no subprocess involved):

```cpp
void YouTubeMusicSource::set_config(YouTubeMusicConfig cfg) {
    {
        std::scoped_lock lk{mu_};
        const auto* old_st = active_station_locked();
        std::string old_url = old_st ? old_st->url : "";

        if (cfg.yt_dlp_path.empty() && !cfg_.yt_dlp_path.empty()) {
            cfg.yt_dlp_path = cfg_.yt_dlp_path;
        }

        if (cfg.cookies_path != cfg_.cookies_path) {
            client_ = ytmusic::InnertubeClient{cfg.cookies_path};
        }

        cfg_ = std::move(cfg);

        const auto* new_st = active_station_locked();
        std::string new_url = new_st ? new_st->url : "";

        if (old_url != new_url && target_url_.empty()) {
            discard_prefetch_locked();
            stop_pipe_locked();
            queue_.clear();
            queue_idx_ = 0;
            queue_built_for_.clear();
        }
    }
}
```

- [ ] **Step 3: Implement the disk cache (load/save), mirroring `LocalFileSource`'s `load_index_if_needed`/`save_index` pattern**

```cpp
std::optional<YouTubeMusicSource::CachedQueue>
YouTubeMusicSource::load_cached_queue(const std::string& browse_id) const {
    const auto path = cache_dir_ / (browse_id + ".json");
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    try {
        nlohmann::json j;
        in >> j;
        CachedQueue cq;
        cq.fetched_at_unix = j.value("fetched_at_unix", std::int64_t{0});
        for (const auto& t : j.value("tracks", nlohmann::json::array())) {
            ytmusic::QueueTrack qt;
            qt.video_id = t.value("video_id", "");
            qt.title = t.value("title", "");
            qt.artist = t.value("artist", "");
            qt.thumbnail_url = t.value("thumbnail_url", "");
            qt.duration_ms = t.value("duration_ms", std::uint64_t{0});
            if (!qt.video_id.empty()) cq.tracks.push_back(std::move(qt));
        }
        return cq.tracks.empty() ? std::nullopt : std::optional<CachedQueue>{std::move(cq)};
    } catch (...) {
        return std::nullopt;
    }
}

void YouTubeMusicSource::save_cached_queue(const std::string& browse_id,
                                           const std::vector<ytmusic::QueueTrack>& tracks) const {
    nlohmann::json j;
    j["fetched_at_unix"] = std::chrono::duration_cast<std::chrono::seconds>(
                               std::chrono::system_clock::now().time_since_epoch())
                               .count();
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& t : tracks) {
        arr.push_back(nlohmann::json{{"video_id", t.video_id},
                                     {"title", t.title},
                                     {"artist", t.artist},
                                     {"thumbnail_url", t.thumbnail_url},
                                     {"duration_ms", t.duration_ms}});
    }
    j["tracks"] = std::move(arr);

    std::error_code ec;
    auto tmp = cache_dir_ / (browse_id + ".json.tmp");
    {
        std::ofstream os(tmp, std::ios::binary | std::ios::trunc);
        if (!os) return;
        os << j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
    }
    std::filesystem::rename(tmp, cache_dir_ / (browse_id + ".json"), ec);
    if (ec) {
        std::error_code rep;
        std::filesystem::remove(cache_dir_ / (browse_id + ".json"), rep);
        std::filesystem::rename(tmp, cache_dir_ / (browse_id + ".json"), rep);
    }
}
```

Add `#include <chrono>` and `#include <nlohmann/json.hpp>` to `youtube_music_source.cpp`'s includes if not already present (the file already includes neither today; `nlohmann::json` is available via the vendored header, same as `local_file_source.cpp` and `jellyfin_source.cpp` already do).

Constant for staleness, near the top of the anonymous namespace:

```cpp
constexpr std::int64_t kQueueCacheTtlSeconds = 3600; // 1 h, per the design doc
```

- [ ] **Step 4: Implement `cast_library_playlist`, `start_radio`, and the background refresh, mirroring `TextureInjector`'s detached-thread-plus-job-id staleness pattern**

```cpp
void YouTubeMusicSource::refresh_cache_in_background(std::string browse_id) {
    bool expected = false;
    if (!cache_refreshing_.compare_exchange_strong(expected, true)) return; // already refreshing

    std::thread([this, browse_id = std::move(browse_id)]() {
        auto result = client_.browse_playlist(browse_id);
        if (result.ok()) {
            save_cached_queue(browse_id, result.value);
            std::scoped_lock lk{mu_};
            // Only swap the live queue in if we are still on this playlist;
            // the user may have switched away while the fetch was in flight.
            if (queue_built_for_ == browse_id) {
                queue_.clear();
                queue_.reserve(result.value.size());
                std::size_t idx = 0;
                for (auto& t : result.value) {
                    queue_.push_back(InternalQueueEntry{watch_url_for_id(t.video_id), t.title,
                                                        t.artist, idx++});
                }
            }
        } else {
            log::warn("[yt] background library refresh failed for {}", browse_id);
        }
        cache_refreshing_.store(false, std::memory_order_release);
    }).detach();
}

bool YouTubeMusicSource::cast_library_playlist(std::string browse_id) {
    auto cached = load_cached_queue(browse_id);
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                        std::chrono::system_clock::now().time_since_epoch())
                        .count();

    std::vector<ytmusic::QueueTrack> tracks;
    if (cached) {
        tracks = std::move(cached->tracks);
        if (now - cached->fetched_at_unix > kQueueCacheTtlSeconds) {
            refresh_cache_in_background(browse_id); // stale: serve it, refresh behind it
        }
    } else {
        auto result = client_.browse_playlist(browse_id);
        if (!result.ok() || result.value.empty()) return false;
        tracks = result.value;
        save_cached_queue(browse_id, tracks);
    }

    std::scoped_lock lk{mu_};
    discard_prefetch_locked();
    stop_pipe_locked();
    queue_.clear();
    queue_.reserve(tracks.size());
    std::size_t idx = 0;
    for (auto& t : tracks) {
        queue_.push_back(InternalQueueEntry{watch_url_for_id(t.video_id), t.title, t.artist, idx++});
    }
    queue_idx_ = 0;
    queue_built_for_ = browse_id;
    target_url_.clear();
    start_pipe_locked();
    if (pipe_) state_.store(PlaybackState::playing, std::memory_order_release);
    return static_cast<bool>(pipe_);
}

bool YouTubeMusicSource::start_radio(std::string seed_video_id) {
    auto result = client_.next(seed_video_id);
    if (!result.ok() || result.value.empty()) return false;

    std::scoped_lock lk{mu_};
    discard_prefetch_locked();
    stop_pipe_locked();
    queue_.clear();
    queue_.reserve(result.value.size() + 1);
    // Keep the seed track as the first entry so radio starts on the track
    // the user actually clicked "start radio" from.
    queue_.push_back(InternalQueueEntry{watch_url_for_id(seed_video_id), "", "", 0});
    std::size_t idx = 1;
    for (auto& t : result.value) {
        queue_.push_back(InternalQueueEntry{watch_url_for_id(t.video_id), t.title, t.artist, idx++});
    }
    queue_idx_ = 0;
    queue_built_for_ = "radio:" + seed_video_id; // never matches a real browse_id, cache-exempt
    target_url_.clear();
    start_pipe_locked();
    if (pipe_) state_.store(PlaybackState::playing, std::memory_order_release);
    return static_cast<bool>(pipe_);
}

ytmusic::Result<std::vector<ytmusic::SearchResultItem>>
YouTubeMusicSource::search_catalog(const std::string& query) const {
    return client_.search(query);
}

ytmusic::Result<ytmusic::LibrarySnapshot> YouTubeMusicSource::library_snapshot() const {
    return client_.browse_library();
}

ytmusic::Result<std::string> YouTubeMusicSource::track_lyrics(const std::string& video_id) const {
    return client_.lyrics(video_id);
}
```

`watch_url_for_id` already exists as a free function in this file's anonymous namespace (used by `resolve_queue_locked`), reused here as-is.

- [ ] **Step 5: Build to verify it compiles**

Run: `powershell -File scripts/build.ps1`

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add include/fh6/sources/youtube_music_source.hpp src/sources/youtube_music_source.cpp src/bridge.cpp
git commit -m "feat(ytmusic): wire InnertubeClient into YouTubeMusicSource with a disk cache

cast_library_playlist and start_radio give the account library and
radio a real ephemeral play path (not a saved station). The disk
cache at <data_dir>/ytmusic_cache/<browse_id>.json with a 1 h TTL and
background refresh fixes the full yt-dlp --flat-playlist re-resolve
that used to run on every station reactivation, confirmed against the
live deployment's bridge.log."
```

---

### Task 7: Confirm the CMake wiring

Task 3 already added `ytmusic_client.cpp` to build that task in isolation. This task is a short, focused check that the full `version` target's source list is correct and nothing was missed, since Task 6 touched `bridge.cpp` and the header include graph grew.

**Files:**
- Modify: `CMakeLists.txt` (verify only, likely a no-op if Task 3 was done correctly)

**Interfaces:**
- Consumes: nothing new.
- Produces: a clean full build, all targets.

- [ ] **Step 1: Verify `src/sources/ytmusic_client.cpp` is listed in the `version` target's `add_library` sources**

Open `CMakeLists.txt` and confirm the `add_library(version SHARED ...)` block includes `src/sources/ytmusic_client.cpp` alongside the other `src/sources/*.cpp` entries. If it is missing (Task 3's step 3 asked for it, but double check), add it in the same alphabetical grouping as the other `src/sources/` entries.

- [ ] **Step 2: Full clean build**

Run:
```bash
rm -rf build
powershell -File scripts/build.ps1
```

Expected: both the `version` target and `fh6-radio-worker` target build with no errors.

- [ ] **Step 3: Commit only if a change was needed**

```bash
git add CMakeLists.txt
git commit -m "build: confirm ytmusic_client.cpp is in the version target's sources"
```

If Task 3 already added it correctly, skip this commit, there is nothing to commit.

---

### Task 8: HTTP API endpoints

**Files:**
- Modify: `src/http/http_server.cpp`

**Interfaces:**
- Consumes: `YouTubeMusicSource::search_catalog`, `library_snapshot`, `track_lyrics`, `cast_library_playlist`, `start_radio` (Task 6).
- Produces: the six new routes the frontend (Tasks 9 onward) calls.

- [ ] **Step 1: Add a `url_decode` helper**

In the anonymous namespace near `mime_for`/`status_text` in `http_server.cpp`:

```cpp
// Minimal percent-decoder for query-string values. The rest of this file's
// routes take their input from the JSON body; the new search/lyrics GET
// routes are the first to need a query string.
std::string url_decode(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) {
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return 10 + c - 'a';
                if (c >= 'A' && c <= 'F') return 10 + c - 'A';
                return -1;
            };
            const int hi = hex(s[i + 1]);
            const int lo = hex(s[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out += static_cast<char>((hi << 4) | lo);
                i += 2;
                continue;
            }
        }
        out += (s[i] == '+') ? ' ' : s[i];
    }
    return out;
}
```

- [ ] **Step 2: Add the six routes to `dispatch()`**

Add these inside `dispatch()`, near the existing `/api/source/youtube_music/*` routes (after the `/api/source/youtube_music/play` block, before the generic transport fallback):

```cpp
if (m == "GET" && p.starts_with("/api/source/youtube_music/search")) {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    std::string q;
    if (auto pos = p.find("?q="); pos != std::string::npos) q = url_decode(p.substr(pos + 3));
    if (q.empty()) return fail(400, "q required");
    auto r = yt->search_catalog(q);
    if (r.status == ytmusic::InnertubeStatus::needs_auth) return fail(401, "not authenticated");
    if (!r.ok()) return fail(502, "search failed");
    json items = json::array();
    for (auto& it : r.value) {
        items.push_back(json{{"video_id", it.video_id},
                             {"browse_id", it.browse_id},
                             {"title", it.title},
                             {"subtitle", it.subtitle},
                             {"thumbnail_url", it.thumbnail_url}});
    }
    return ok(json{{"results", items}});
}
if (m == "GET" && p == "/api/source/youtube_music/library") {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    auto r = yt->library_snapshot();
    if (r.status == ytmusic::InnertubeStatus::needs_auth) return fail(401, "not authenticated");
    if (!r.ok()) return fail(502, "library fetch failed");
    auto tracks_json = [](const std::vector<ytmusic::QueueTrack>& v) {
        json a = json::array();
        for (auto& t : v)
            a.push_back(json{{"video_id", t.video_id},
                             {"title", t.title},
                             {"artist", t.artist},
                             {"thumbnail_url", t.thumbnail_url},
                             {"duration_ms", t.duration_ms}});
        return a;
    };
    auto playlists_json = [](const std::vector<ytmusic::LibraryPlaylist>& v) {
        json a = json::array();
        for (auto& pl : v)
            a.push_back(json{{"browse_id", pl.browse_id},
                             {"title", pl.title},
                             {"thumbnail_url", pl.thumbnail_url}});
        return a;
    };
    return ok(json{{"liked_songs", tracks_json(r.value.liked_songs)},
                   {"playlists", playlists_json(r.value.playlists)},
                   {"subscriptions", playlists_json(r.value.subscriptions)}});
}
if (m == "POST" && p == "/api/source/youtube_music/library/cast") {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    auto browse_id = json::parse(req.body).at("browse_id").get<std::string>();
    if (browse_id.empty()) return fail(400, "browse_id required");
    const bool was_active = (mgr.active() == yt);
    if (!yt->cast_library_playlist(browse_id)) return fail(502, "playlist fetch failed");
    if (was_active) mgr.ring().drain();
    mgr.switch_to("youtube_music");
    return ok();
}
if (m == "POST" && p == "/api/source/youtube_music/play_track") {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    auto video_id = json::parse(req.body).at("video_id").get<std::string>();
    if (video_id.empty()) return fail(400, "video_id required");
    const bool was_active = (mgr.active() == yt);
    yt->stop();
    yt->set_target("https://www.youtube.com/watch?v=" + video_id);
    if (was_active) mgr.ring().drain();
    yt->play();
    mgr.switch_to("youtube_music");
    return ok();
}
if (m == "POST" && p == "/api/source/youtube_music/radio") {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    auto video_id = json::parse(req.body).at("video_id").get<std::string>();
    if (video_id.empty()) return fail(400, "video_id required");
    const bool was_active = (mgr.active() == yt);
    if (!yt->start_radio(video_id)) return fail(502, "radio failed");
    if (was_active) mgr.ring().drain();
    mgr.switch_to("youtube_music");
    return ok();
}
if (m == "GET" && p.starts_with("/api/source/youtube_music/lyrics")) {
    auto* yt = find_typed<sources::YouTubeMusicSource>("youtube_music");
    if (!yt) return fail(404, "youtube_music not registered");
    std::string video_id;
    if (auto pos = p.find("?video_id="); pos != std::string::npos)
        video_id = url_decode(p.substr(pos + 10));
    if (video_id.empty()) return fail(400, "video_id required");
    auto r = yt->track_lyrics(video_id);
    if (!r.ok()) return ok(json{{"lyrics", ""}}); // not found is not an error, per the design doc
    return ok(json{{"lyrics", r.value}});
}
```

Add `#include "fh6/sources/ytmusic_client.hpp"` to `http_server.cpp`'s include block near the other `fh6/sources/*.hpp` includes.

- [ ] **Step 3: Build to verify it compiles**

Run: `powershell -File scripts/build.ps1`

Expected: build succeeds.

- [ ] **Step 4: Manual smoke check**

Install the build (`scripts/install.ps1 -GameDir <path>`), launch the game with YouTube Music enabled and cookies configured, and hit the new routes directly from a browser or `curl` while the game is running:

```bash
curl "http://localhost:8420/api/source/youtube_music/search?q=lofi"
curl "http://localhost:8420/api/source/youtube_music/library"
```

Expected: JSON responses matching the shapes above. If `library` returns `401`, cookies did not load correctly, check `cookies_path` in `config.toml` and `bridge.log` for `[ytmusic]` warnings. If `search` returns an empty `results` array despite a real query, the Innertube response shape likely drifted from what Task 3's generic walker expects, check `bridge.log` for the parse-failed warning and adjust the collector keys in `ytmusic_client.cpp` against the actual response.

- [ ] **Step 5: Commit**

```bash
git add src/http/http_server.cpp
git commit -m "feat(http): add youtube_music search/library/radio/lyrics endpoints

GET .../search, GET .../library, POST .../library/cast,
POST .../play_track, POST .../radio, GET .../lyrics. All proxy
straight through to the YouTubeMusicSource methods added in the
previous task; needs_auth from Innertube maps to HTTP 401, everything
else maps to the existing ok()/fail() response helpers."
```

---

### Task 9: Frontend `api.js` additions

**Files:**
- Modify: `ui/dist/js/data/api.js`
- Test: `ui/test/api.test.js`

**Interfaces:**
- Consumes: the six endpoints from Task 8.
- Produces: `api.youtubeMusic.search`, `.library`, `.castLibraryPlaylist`, `.playTrack`, `.radio`, `.lyrics`, used by every frontend task from here on.

- [ ] **Step 1: Write the failing tests**

Add to `ui/test/api.test.js`:

```js
it("youtube_music search/library/radio/lyrics carry the right method and path", async () => {
  await api.youtubeMusic.search("lofi beats");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/search?q=lofi%20beats",
    method: "GET",
  });

  await api.youtubeMusic.library();
  expect(lastCall()).toMatchObject({ path: "/api/source/youtube_music/library", method: "GET" });

  await api.youtubeMusic.castLibraryPlaylist("VLabc123");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/library/cast",
    method: "POST",
    body: { browse_id: "VLabc123" },
  });

  await api.youtubeMusic.playTrack("dQw4w9WgXcQ");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/play_track",
    method: "POST",
    body: { video_id: "dQw4w9WgXcQ" },
  });

  await api.youtubeMusic.radio("dQw4w9WgXcQ");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/radio",
    method: "POST",
    body: { video_id: "dQw4w9WgXcQ" },
  });

  await api.youtubeMusic.lyrics("dQw4w9WgXcQ");
  expect(lastCall()).toMatchObject({
    path: "/api/source/youtube_music/lyrics?video_id=dQw4w9WgXcQ",
    method: "GET",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/api.test.js`

Expected: FAIL, `api.youtubeMusic.search is not a function`.

- [ ] **Step 3: Implement**

In `ui/dist/js/data/api.js`, replace the existing `youtubeMusic` block:

```js
	// YouTube Music
	youtubeMusic: {
		...sourceApi("youtube_music"),
		cast: url => request("/api/source/youtube_music/cast", { method: "POST", body: { url } }),
		shuffle: shuffle => request("/api/source/youtube_music/shuffle", { method: "POST", body: { shuffle } }),
		search: query => request(`/api/source/youtube_music/search?q=${encodeURIComponent(query)}`),
		library: () => request("/api/source/youtube_music/library"),
		castLibraryPlaylist: browseId =>
			request("/api/source/youtube_music/library/cast", { method: "POST", body: { browse_id: browseId } }),
		playTrack: videoId =>
			request("/api/source/youtube_music/play_track", { method: "POST", body: { video_id: videoId } }),
		radio: videoId =>
			request("/api/source/youtube_music/radio", { method: "POST", body: { video_id: videoId } }),
		lyrics: videoId => request(`/api/source/youtube_music/lyrics?video_id=${encodeURIComponent(videoId)}`),
	},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run ui/test/api.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/dist/js/data/api.js ui/test/api.test.js
git commit -m "feat(ui): add youtubeMusic.search/library/radio/lyrics to api.js"
```

---

### Task 10: `ytmusic/queue.js`, the shared frontend queue state

**Files:**
- Create: `ui/dist/js/ytmusic/queue.js`
- Test: `ui/test/ytmusic/queue.test.js`

**Interfaces:**
- Consumes: `api.youtubeMusic.playTrack`, `.castLibraryPlaylist`, `.radio` (Task 9).
- Produces: `onQueueChange(fn) -> unsubscribeFn`, `getQueue() -> {source, items}`, `playTrack(videoId, title)`, `playLibraryPlaylist(browseId, title)`, `startRadio(videoId, title)`. Used by `shell.js` (Task 11) and every view (Tasks 12 to 15).

- [ ] **Step 1: Write the failing tests**

```js
// ui/test/ytmusic/queue.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { onQueueChange, getQueue, playTrack, playLibraryPlaylist, startRadio } from "../../dist/js/ytmusic/queue.js";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("ytmusic queue", () => {
  it("playTrack sets a single-item search-sourced queue and notifies listeners", async () => {
    const seen = [];
    const unsub = onQueueChange(q => seen.push(q));
    await playTrack("abc123", "Some Song");
    expect(getQueue()).toEqual({ source: "search", items: [{ video_id: "abc123", title: "Some Song" }] });
    expect(seen.at(-1)).toEqual(getQueue());
    unsub();
  });

  it("playLibraryPlaylist tags the queue source as library", async () => {
    await playLibraryPlaylist("VLabc", "My Playlist");
    expect(getQueue().source).toBe("library");
  });

  it("startRadio tags the queue source as radio", async () => {
    await startRadio("abc123", "Some Song");
    expect(getQueue().source).toBe("radio");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/queue.test.js`

Expected: FAIL, module not found (`ui/dist/js/ytmusic/queue.js` does not exist yet).

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/queue.js
//
// Single source of truth for the YouTube Music takeover's current play
// queue. Search, library, and radio all funnel through here instead of each
// view tracking its own queue, so the now-playing bar and any queue panel
// always agree on what is coming up next.
import { api } from "../data/api.js";
import { toast } from "../toast.js";

let current = { source: null, items: [] };
const listeners = new Set();

function notify() {
    for (const fn of listeners) fn(current);
}

export function onQueueChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getQueue() {
    return current;
}

export async function playTrack(videoId, title) {
    try {
        await api.youtubeMusic.playTrack(videoId);
        current = { source: "search", items: [{ video_id: videoId, title }] };
        notify();
    } catch (e) {
        toast(e.message, true);
    }
}

export async function playLibraryPlaylist(browseId, title) {
    try {
        await api.youtubeMusic.castLibraryPlaylist(browseId);
        current = { source: "library", items: [] };
        notify();
        toast(`Playing ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}

export async function startRadio(videoId, title) {
    try {
        await api.youtubeMusic.radio(videoId);
        current = { source: "radio", items: [] };
        notify();
        toast(`Starting radio from ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/queue.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/dist/js/ytmusic/queue.js ui/test/ytmusic/queue.test.js
git commit -m "feat(ui): add ytmusic/queue.js, shared play-queue state for the takeover UI"
```

---

### Task 11: `ytmusic/shell.js`, the takeover frame, plus `main.js` wiring and base CSS

**Files:**
- Create: `ui/dist/js/ytmusic/shell.js`
- Create: `ui/dist/css/ytmusic.css`
- Modify: `ui/dist/js/main.js`
- Modify: `ui/dist/css/styles.css`
- Modify: `ui/dist/lang/en.json`

**Interfaces:**
- Consumes: `render/nowPlaying.js`'s `renderNowPlaying` (existing), `createHome`/`createSearch`/`createLibrary`/`createRadio` (Tasks 12 to 15, stubbed here, filled in there).
- Produces: `createYtMusicShell(ctx) -> { root, render(state, cfg) }`, mounted once from `main.js`.

Views for this task are minimal stubs (`views/home.js`, `views/search.js`, `views/library.js`, `views/radio.js`), each exporting `createX() -> { root, render }` with a placeholder body, so the shell has something real to mount and hide/show. Tasks 12 to 15 replace the stub bodies with real content; the exported shape does not change, so this task's wiring keeps working unmodified.

- [ ] **Step 1: Create the four view stubs**

```js
// ui/dist/js/ytmusic/views/home.js
import { el } from "../../lib/dom.js";

export function createHome() {
    const root = el("section", { class: "yt-view yt-view-home", hidden: true }, [
        el("p", { class: "muted" }, "Home"),
    ]);
    return { root, render() {} };
}
```

```js
// ui/dist/js/ytmusic/views/search.js
import { el } from "../../lib/dom.js";

export function createSearch() {
    const root = el("section", { class: "yt-view yt-view-search", hidden: true }, [
        el("p", { class: "muted" }, "Search"),
    ]);
    return { root, render() {} };
}
```

```js
// ui/dist/js/ytmusic/views/library.js
import { el } from "../../lib/dom.js";

export function createLibrary() {
    const root = el("section", { class: "yt-view yt-view-library", hidden: true }, [
        el("p", { class: "muted" }, "Library"),
    ]);
    return { root, render() {} };
}
```

```js
// ui/dist/js/ytmusic/views/radio.js
import { el } from "../../lib/dom.js";

export function createRadio() {
    const root = el("section", { class: "yt-view yt-view-radio", hidden: true }, [
        el("p", { class: "muted" }, "Radio"),
    ]);
    return { root, render() {} };
}
```

- [ ] **Step 2: Write `shell.js`**

```js
// ui/dist/js/ytmusic/shell.js
import { el } from "../lib/dom.js";
import { t } from "../i18n.js";
import { renderNowPlaying } from "../render/nowPlaying.js";
import { createHome } from "./views/home.js";
import { createSearch } from "./views/search.js";
import { createLibrary } from "./views/library.js";
import { createRadio } from "./views/radio.js";

const TABS = [
    ["home", "ytmusic.nav.home"],
    ["search", "ytmusic.nav.search"],
    ["library", "ytmusic.nav.library"],
    ["radio", "ytmusic.nav.radio"],
];

export function createYtMusicShell() {
    let activeTab = "home";

    const railButtons = new Map();
    const tabButtons = new Map();
    const rail = el("nav", { class: "yt-rail", "aria-label": "YouTube Music sections" });
    const tabbar = el("nav", { class: "yt-tabbar", "aria-label": "YouTube Music sections" });
    const content = el("div", { class: "yt-content" });

    const views = {
        home: createHome(),
        search: createSearch(),
        library: createLibrary(),
        radio: createRadio(),
    };

    function selectTab(id) {
        activeTab = id;
        for (const [key, btn] of railButtons) btn.classList.toggle("on", key === id);
        for (const [key, btn] of tabButtons) btn.classList.toggle("on", key === id);
        for (const [key, view] of Object.entries(views)) view.root.hidden = key !== id;
    }

    for (const [id, labelKey] of TABS) {
        const railBtn = el("button", { type: "button", class: "yt-nav-btn", dataset: { i18n: labelKey } }, t(labelKey));
        const tabBtn = el("button", { type: "button", class: "yt-nav-btn", dataset: { i18n: labelKey } }, t(labelKey));
        railBtn.addEventListener("click", () => selectTab(id));
        tabBtn.addEventListener("click", () => selectTab(id));
        railButtons.set(id, railBtn);
        tabButtons.set(id, tabBtn);
        rail.append(railBtn);
        tabbar.append(tabBtn);
    }

    content.append(views.home.root, views.search.root, views.library.root, views.radio.root);

    const npImg = el("img", { class: "yt-np-img", alt: "" });
    const npTitle = el("div", { class: "yt-np-title" });
    const npArtist = el("div", { class: "yt-np-artist" });
    const npFill = el("div", { class: "yt-np-fill" });
    const npPos = el("span", { class: "yt-np-time" });
    const npDur = el("span", { class: "yt-np-time" });
    const npPlay = el("button", { type: "button", class: "icon-btn primary" });
    const npBar = el("div", { class: "yt-now-playing" }, [
        npImg,
        el("div", { class: "yt-np-text" }, [npTitle, npArtist]),
        el("div", { class: "yt-np-progress" }, [npPos, el("div", { class: "yt-np-bar" }, [npFill]), npDur]),
        npPlay,
    ]);

    const shell = el("div", { id: "ytmusic-shell", hidden: true }, [rail, content, npBar, tabbar]);
    document.body.append(shell);

    selectTab("home");

    const npRefs = {
        art: npBar,
        backdrop: null,
        img: npImg,
        title: npTitle,
        artist: npArtist,
        fill: npFill,
        pos: npPos,
        dur: npDur,
        play: npPlay,
    };

    function render(state, cfg) {
        const active = state?.sources?.active === "youtube_music";
        shell.hidden = !active;
        if (!active) return;
        renderNowPlaying(npRefs, state);
        views[activeTab]?.render?.(state, cfg);
    }

    return { root: shell, render };
}
```

`renderNowPlaying` reads `refs.backdrop.style.backgroundImage` when `refs.backdrop` is truthy (see `render/nowPlaying.js`); passing `null` here is safe, the function's `if (refs.backdrop)` guard already handles it, confirmed by reading `render/nowPlaying.js` during the design phase.

- [ ] **Step 3: Wire `main.js` to mount/unmount the shell alongside the existing dashboard chrome**

In `ui/dist/js/main.js`, add the import near the other view factory imports:

```js
import { createYtMusicShell } from "./ytmusic/shell.js";
```

Declare it alongside the other `let` view variables:

```js
let ytMusicShell;
```

In `boot()`, alongside where `deps`, `externalAudio`, etc are created:

```js
    ytMusicShell = createYtMusicShell();
```

In `render()`, hide the generic dashboard chrome when YouTube Music is active and delegate to the shell, mirroring the existing `background` array used by the settings drawer's inert-toggle:

```js
function render() {
    if (!state) return;

    const ytActive = state.sources?.active === "youtube_music";
    for (const node of background) if (node) node.hidden = ytActive;

    renderStatus(refs.status, state);
    renderNowPlaying(refs.np, state);
    renderSources(refs.sources, state, cfg, switchSource);
    renderOutput(state);
    externalAudio.render();
    localFiles.render();
    onlineRadio.render();
    youtubeMusic.render();
    jellyfin.render();

    refs.sourceCard.hidden = false;
    refs.outputCard.hidden = !state.sources?.active;

    document.body.classList.toggle("view-minimal", prefs.viewMode.get() === "minimal");

    ytMusicShell.render(state, cfg);
}
```

`background` is already declared earlier in `main.js` as `const background = [$("header"), mainEl, $(".credits")];`, reused here as-is rather than duplicated.

- [ ] **Step 4: Add the new CSS file and link it**

Create `ui/dist/css/ytmusic.css` with a minimal working layout (sidebar on wide viewports, bottom tabs under the existing mobile breakpoint used by `base/responsive.css`, `#ytmusic-shell` sitting above the rest of the page when visible):

```css
/* YouTube Music takeover shell: sidebar nav on wide viewports, bottom tabs
   on phone, persistent now-playing bar docked bottom either way. Mounted
   once by ytmusic/shell.js, toggled hidden/visible by main.js based on
   which source is active. */

#ytmusic-shell {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: 220px 1fr;
    grid-template-rows: 1fr auto;
    background: var(--surface-base);
}

#ytmusic-shell .yt-rail {
    grid-row: 1 / 2;
    grid-column: 1 / 2;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-8);
    padding: var(--spacing-24) var(--spacing-16);
    border-right: 1px solid var(--line);
    overflow-y: auto;
}

#ytmusic-shell .yt-content {
    grid-row: 1 / 2;
    grid-column: 2 / 3;
    overflow-y: auto;
    padding: var(--spacing-24);
}

#ytmusic-shell .yt-tabbar {
    display: none;
}

#ytmusic-shell .yt-now-playing {
    grid-row: 2 / 3;
    grid-column: 1 / 3;
    display: flex;
    align-items: center;
    gap: var(--spacing-16);
    padding: var(--spacing-12) var(--spacing-24);
    border-top: 1px solid var(--line);
    background: var(--surface-card);
}

#ytmusic-shell .yt-np-img {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    object-fit: cover;
}

#ytmusic-shell .yt-np-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

#ytmusic-shell .yt-np-title {
    font-weight: var(--font-weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

#ytmusic-shell .yt-np-artist {
    color: var(--text-muted);
    font-size: 0.85em;
}

#ytmusic-shell .yt-np-progress {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--spacing-8);
}

#ytmusic-shell .yt-np-bar {
    flex: 1;
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--surface-raise);
    overflow: hidden;
}

#ytmusic-shell .yt-np-fill {
    height: 100%;
    background: var(--accent);
}

#ytmusic-shell .yt-nav-btn {
    text-align: left;
    padding: var(--spacing-8) var(--spacing-12);
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
}

#ytmusic-shell .yt-nav-btn.on {
    background: var(--surface-raise);
    color: var(--text-strong);
}

@media (max-width: 720px) {
    #ytmusic-shell {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr auto auto;
    }

    #ytmusic-shell .yt-rail {
        display: none;
    }

    #ytmusic-shell .yt-content {
        grid-column: 1 / 2;
    }

    #ytmusic-shell .yt-now-playing {
        grid-row: 2 / 3;
        grid-column: 1 / 2;
    }

    #ytmusic-shell .yt-tabbar {
        grid-row: 3 / 4;
        grid-column: 1 / 2;
        display: flex;
        justify-content: space-around;
        border-top: 1px solid var(--line);
        padding: var(--spacing-8);
    }
}
```

Link it from `ui/dist/index.html`, right after the existing stylesheet link:

```html
    <link rel="stylesheet" href="css/styles.css" />
    <link rel="stylesheet" href="css/ytmusic.css" />
```

- [ ] **Step 5: Add the new i18n keys**

In `ui/dist/lang/en.json`, add near the other `source.*` keys:

```json
  "ytmusic.nav.home": "Home",
  "ytmusic.nav.search": "Search",
  "ytmusic.nav.library": "Library",
  "ytmusic.nav.radio": "Radio",
```

Remember the file's own documented rule at its top: JSON has no real comments, the `//`-prefixed lines are stripped by `i18n.js`'s parser before `JSON.parse`, so keep the new keys as plain entries, no comment markers required around them.

- [ ] **Step 6: Manual smoke check**

Run the dashboard against a live or mocked backend (`npx vite ui/dist` is not set up in this repo; instead, build and run the actual mod, or open `ui/dist/index.html` directly and manually set `state.sources.active` via the browser console against a running `/api/state`). Confirm: switching to YouTube Music hides the header/main/credits and shows the sidebar plus now-playing bar; switching away restores the generic dashboard.

- [ ] **Step 7: Commit**

```bash
git add ui/dist/js/ytmusic/shell.js ui/dist/js/ytmusic/views/home.js ui/dist/js/ytmusic/views/search.js ui/dist/js/ytmusic/views/library.js ui/dist/js/ytmusic/views/radio.js ui/dist/js/main.js ui/dist/css/ytmusic.css ui/dist/css/styles.css ui/dist/index.html ui/dist/lang/en.json
git commit -m "feat(ui): add the YouTube Music takeover shell and mount it from main.js

Sidebar nav on wide viewports, bottom tabs under the existing mobile
breakpoint, persistent now-playing bar. Generic dashboard chrome
(header/main/credits) hides while youtube_music is the active
source, restored when it is not. Views are stubs here, filled in by
the next four tasks."
```

Note: `styles.css` was not actually modified by this task's steps above (only `index.html` gained a second `<link>`), listed in the commit for safety in case the executor also folds an `@import` there instead, either approach is fine, `index.html`'s extra `<link>` is the one specified above.

---

### Task 12: `ytmusic/views/search.js`

**Files:**
- Modify: `ui/dist/js/ytmusic/views/search.js`
- Test: `ui/test/ytmusic/views/search.test.js`

**Interfaces:**
- Consumes: `api.youtubeMusic.search` (Task 9), `playTrack`/`startRadio` from `queue.js` (Task 10).
- Produces: real `createSearch() -> { root, render }`, replacing the Task 11 stub, same exported shape.

- [ ] **Step 1: Write the failing test**

```js
// ui/test/ytmusic/views/search.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSearch } from "../../../dist/js/ytmusic/views/search.js";

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      results: [
        { video_id: "abc", browse_id: "", title: "Song A", subtitle: "Artist A", thumbnail_url: "" },
      ],
    }),
  });
});

describe("ytmusic search view", () => {
  it("renders results after typing and debounce", async () => {
    const { root } = createSearch();
    document.body.append(root);
    const input = root.querySelector("input");
    input.value = "song a";
    input.dispatchEvent(new Event("input"));

    await new Promise(r => setTimeout(r, 250)); // clear the debounce window
    await new Promise(r => setTimeout(r, 0)); // let the fetch promise resolve

    expect(root.textContent).toContain("Song A");
    expect(root.textContent).toContain("Artist A");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/views/search.test.js`

Expected: FAIL, the stub renders no `<input>` and no result text.

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/views/search.js
import { el, debounce } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { playTrack, startRadio } from "../queue.js";

export function createSearch() {
    const input = el("input", {
        type: "text",
        class: "yt-search-input",
        placeholder: t("ytmusic.search.placeholder"),
        autocomplete: "off",
    });
    const results = el("div", { class: "yt-search-results" });
    const root = el("section", { class: "yt-view yt-view-search", hidden: true }, [input, results]);

    function resultRow(item) {
        const row = el("div", { class: "yt-search-row" }, [
            el("span", { class: "yt-search-title" }, item.title),
            item.subtitle ? el("span", { class: "yt-search-subtitle muted" }, item.subtitle) : null,
        ].filter(Boolean));

        if (item.video_id) {
            row.classList.add("clickable");
            row.addEventListener("click", () => playTrack(item.video_id, item.title));

            const radioBtn = el("button", { type: "button", class: "btn ghost yt-radio-btn" }, t("ytmusic.start_radio"));
            radioBtn.addEventListener("click", e => {
                e.stopPropagation();
                startRadio(item.video_id, item.title);
            });
            row.append(radioBtn);
        }
        return row;
    }

    const runSearch = debounce(async () => {
        const query = input.value.trim();
        if (!query) {
            results.replaceChildren();
            return;
        }
        try {
            const r = await api.youtubeMusic.search(query);
            results.replaceChildren(...(r.results || []).map(resultRow));
            if (!r.results?.length) results.append(el("p", { class: "muted" }, t("ytmusic.search.no_results")));
        } catch {
            results.replaceChildren(el("p", { class: "muted" }, t("ytmusic.search.error")));
        }
    }, 200);

    input.addEventListener("input", runSearch);

    return { root, render() {} };
}
```

- [ ] **Step 4: Add the new i18n keys**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.search.placeholder": "Search songs, albums, artists...",
  "ytmusic.search.no_results": "No results.",
  "ytmusic.search.error": "Search failed, try again.",
  "ytmusic.start_radio": "Start radio",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/views/search.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/dist/js/ytmusic/views/search.js ui/test/ytmusic/views/search.test.js ui/dist/lang/en.json
git commit -m "feat(ui): implement the ytmusic search view

Debounced search hitting /api/source/youtube_music/search; clicking a
result plays it via queue.js's playTrack, a per-row Start Radio
button seeds an autoplay queue via startRadio."
```

---

### Task 13: `ytmusic/views/library.js`

**Files:**
- Modify: `ui/dist/js/ytmusic/views/library.js`
- Test: `ui/test/ytmusic/views/library.test.js`

**Interfaces:**
- Consumes: `api.youtubeMusic.library` (Task 9), `playLibraryPlaylist` from `queue.js` (Task 10).
- Produces: real `createLibrary() -> { root, render }`, replacing the Task 11 stub.

- [ ] **Step 1: Write the failing test**

```js
// ui/test/ytmusic/views/library.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLibrary } from "../../../dist/js/ytmusic/views/library.js";

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      liked_songs: [{ video_id: "a", title: "Liked One", artist: "Artist", thumbnail_url: "", duration_ms: 0 }],
      playlists: [{ browse_id: "VLxyz", title: "My Playlist", thumbnail_url: "" }],
      subscriptions: [],
    }),
  });
});

describe("ytmusic library view", () => {
  it("fetches and renders liked songs and playlists on first render", async () => {
    const { root, render } = createLibrary();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    expect(root.textContent).toContain("Liked One");
    expect(root.textContent).toContain("My Playlist");
  });

  it("shows a needs-auth message on a 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, statusText: "Unauthorized", json: async () => ({ error: "not authenticated" }) });
    const { root, render } = createLibrary();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    expect(root.textContent).toContain("not authenticated");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/views/library.test.js`

Expected: FAIL, the stub never fetches or renders anything.

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/views/library.js
import { el } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { playLibraryPlaylist, playTrack } from "../queue.js";

export function createLibrary() {
    const body = el("div", { class: "yt-library-body" });
    const root = el("section", { class: "yt-view yt-view-library", hidden: true }, [body]);

    let loaded = false;

    function playlistTile(pl) {
        const tile = el("button", { type: "button", class: "yt-library-tile" }, [
            el("span", { class: "yt-library-tile-title" }, pl.title),
        ]);
        tile.addEventListener("click", () => playLibraryPlaylist(pl.browse_id, pl.title));
        return tile;
    }

    function trackRow(track) {
        const row = el("div", { class: "yt-search-row clickable" }, [
            el("span", { class: "yt-search-title" }, track.title),
            el("span", { class: "yt-search-subtitle muted" }, track.artist),
        ]);
        row.addEventListener("click", () => playTrack(track.video_id, track.title));
        return row;
    }

    async function load() {
        try {
            const r = await api.youtubeMusic.library();
            body.replaceChildren(
                el("h3", {}, t("ytmusic.library.liked_songs")),
                ...(r.liked_songs || []).map(trackRow),
                el("h3", {}, t("ytmusic.library.playlists")),
                el("div", { class: "yt-library-grid" }, (r.playlists || []).map(playlistTile)),
            );
            if (!r.liked_songs?.length && !r.playlists?.length) {
                body.append(el("p", { class: "muted" }, t("ytmusic.library.empty")));
            }
        } catch (e) {
            body.replaceChildren(el("p", { class: "muted" }, e.message || t("ytmusic.library.error")));
        }
    }

    return {
        root,
        render(state) {
            if (state?.sources?.active !== "youtube_music" || loaded) return;
            loaded = true;
            load();
        },
    };
}
```

The `loaded` guard means `render()` only fetches once per page load, matching the pattern the existing `stationManager.js` uses (`load(force = false)`). A future refinement (out of scope here) could add a manual refresh button; not required for this task.

- [ ] **Step 4: Add the new i18n keys**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.library.liked_songs": "Liked Songs",
  "ytmusic.library.playlists": "Your Playlists",
  "ytmusic.library.empty": "Nothing here yet.",
  "ytmusic.library.error": "Could not load your library.",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/views/library.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/dist/js/ytmusic/views/library.js ui/test/ytmusic/views/library.test.js ui/dist/lang/en.json
git commit -m "feat(ui): implement the ytmusic library view

Liked songs and playlist grid from /api/source/youtube_music/library,
loaded once on first render. A playlist tile plays via queue.js's
playLibraryPlaylist; a 401 (cookie expired or absent) surfaces the
backend's error message directly rather than a generic failure."
```

---

### Task 14: `ytmusic/views/radio.js`

**Files:**
- Modify: `ui/dist/js/ytmusic/views/radio.js`
- Test: `ui/test/ytmusic/views/radio.test.js`

**Interfaces:**
- Consumes: `getQueue`/`onQueueChange` from `queue.js` (Task 10).
- Produces: real `createRadio() -> { root, render }`, replacing the Task 11 stub. Shows the current radio queue when one is active; otherwise an empty-state pointing at search.

- [ ] **Step 1: Write the failing test**

```js
// ui/test/ytmusic/views/radio.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { createRadio } from "../../../dist/js/ytmusic/views/radio.js";

// queue.js's module-level `current` state is shared across the whole test
// file via the real module (not mocked); each test reaches it only through
// startRadio's public API, exercised via the shell in Task 11's manual
// check, this view test only cares about its own render(no queue) path.

describe("ytmusic radio view", () => {
  it("shows the empty state when no radio queue is active", () => {
    document.body.innerHTML = "";
    const { root, render } = createRadio();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    expect(root.textContent).toContain("Start a radio from any search result");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/views/radio.test.js`

Expected: FAIL, the Task 11 stub's text is `"Radio"`, not the empty-state copy.

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/views/radio.js
import { el } from "../../lib/dom.js";
import { t } from "../../i18n.js";
import { getQueue, onQueueChange } from "../queue.js";

export function createRadio() {
    const body = el("div", { class: "yt-radio-body" });
    const root = el("section", { class: "yt-view yt-view-radio", hidden: true }, [body]);

    function draw() {
        const q = getQueue();
        if (q.source !== "radio") {
            body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.radio.empty")));
            return;
        }
        body.replaceChildren(
            el("h3", {}, t("ytmusic.radio.now_playing")),
            ...q.items.map(track =>
                el("div", { class: "yt-search-row" }, [
                    el("span", { class: "yt-search-title" }, track.title || track.video_id),
                    track.artist ? el("span", { class: "yt-search-subtitle muted" }, track.artist) : null,
                ].filter(Boolean)),
            ),
        );
    }

    onQueueChange(draw);
    draw();

    return { root, render() {} };
}
```

- [ ] **Step 4: Add the new i18n key**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.radio.empty": "Start a radio from any search result to see it here.",
  "ytmusic.radio.now_playing": "Now in your radio",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/views/radio.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/dist/js/ytmusic/views/radio.js ui/test/ytmusic/views/radio.test.js ui/dist/lang/en.json
git commit -m "feat(ui): implement the ytmusic radio view

Subscribes to queue.js's onQueueChange and shows the current
autoplay queue when one is active (source === radio), otherwise an
empty state pointing the user at search's Start Radio button."
```

---

### Task 15: `ytmusic/views/home.js`

**Files:**
- Modify: `ui/dist/js/ytmusic/views/home.js`
- Test: `ui/test/ytmusic/views/home.test.js`

**Interfaces:**
- Consumes: `getQueue`/`onQueueChange` from `queue.js` (Task 10).
- Produces: real `createHome() -> { root, render }`, replacing the Task 11 stub. Shows the current queue's upcoming tracks regardless of which view started it (search, library, or radio), the landing view's whole job is "what's playing and what's next," not a fourth copy of the same track list logic.

- [ ] **Step 1: Write the failing test**

```js
// ui/test/ytmusic/views/home.test.js
import { describe, it, expect } from "vitest";
import { createHome } from "../../../dist/js/ytmusic/views/home.js";

describe("ytmusic home view", () => {
  it("shows a getting-started message when nothing has played yet", () => {
    document.body.innerHTML = "";
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    expect(root.textContent).toContain("Search for something to get started");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/views/home.test.js`

Expected: FAIL, the Task 11 stub's text is `"Home"`.

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/views/home.js
import { el } from "../../lib/dom.js";
import { t } from "../../i18n.js";
import { getQueue, onQueueChange } from "../queue.js";

export function createHome() {
    const body = el("div", { class: "yt-home-body" });
    const root = el("section", { class: "yt-view yt-view-home", hidden: true }, [body]);

    function draw() {
        const q = getQueue();
        if (!q.source || !q.items.length) {
            body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.home.empty")));
            return;
        }
        body.replaceChildren(
            el("h3", {}, t("ytmusic.home.up_next")),
            ...q.items.map(track =>
                el("div", { class: "yt-search-row" }, [
                    el("span", { class: "yt-search-title" }, track.title || track.video_id),
                    track.artist ? el("span", { class: "yt-search-subtitle muted" }, track.artist) : null,
                ].filter(Boolean)),
            ),
        );
    }

    onQueueChange(draw);
    draw();

    return { root, render() {} };
}
```

- [ ] **Step 4: Add the new i18n keys**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.home.empty": "Search for something to get started, or browse your library.",
  "ytmusic.home.up_next": "Up next",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/views/home.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui/dist/js/ytmusic/views/home.js ui/test/ytmusic/views/home.test.js ui/dist/lang/en.json
git commit -m "feat(ui): implement the ytmusic home view as a shared queue landing page"
```

---

### Task 16: `ytmusic/lyrics.js`

**Files:**
- Create: `ui/dist/js/ytmusic/lyrics.js`
- Modify: `ui/dist/js/ytmusic/shell.js`
- Test: `ui/test/ytmusic/lyrics.test.js`

**Interfaces:**
- Consumes: `api.youtubeMusic.lyrics` (Task 9).
- Produces: `createLyricsPanel() -> { root, open(videoId, title) }`, mounted once by `shell.js` and opened from the now-playing bar.

- [ ] **Step 1: Write the failing test**

```js
// ui/test/ytmusic/lyrics.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLyricsPanel } from "../../dist/js/ytmusic/lyrics.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ytmusic lyrics panel", () => {
  it("fetches lyrics only when opened, not on creation", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lyrics: "La la la" }) });
    const { root, open } = createLyricsPanel();
    document.body.append(root);
    expect(global.fetch).not.toHaveBeenCalled();

    await open("abc123", "Some Song");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/source/youtube_music/lyrics?video_id=abc123",
      expect.anything(),
    );
    expect(root.textContent).toContain("La la la");
  });

  it("shows an empty state when the track has no lyrics", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lyrics: "" }) });
    const { root, open } = createLyricsPanel();
    document.body.append(root);
    await open("abc123", "Some Song");
    expect(root.textContent).toContain("No lyrics");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run ui/test/ytmusic/lyrics.test.js`

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```js
// ui/dist/js/ytmusic/lyrics.js
//
// Lazy-fetched lyrics panel, opened from the now-playing bar. Never
// prefetched per track (that would be one Innertube call per song change
// for a feature most plays never open), per the design doc.
import { el } from "../lib/dom.js";
import { api } from "../data/api.js";
import { t } from "../i18n.js";

export function createLyricsPanel() {
    const titleEl = el("h3", {});
    const bodyEl = el("pre", { class: "yt-lyrics-body" });
    const closeBtn = el("button", { type: "button", class: "icon-btn", "aria-label": t("btn.close") ?? "Close" }, "×");

    const root = el("div", { class: "yt-lyrics-panel", hidden: true }, [
        el("div", { class: "yt-lyrics-head" }, [titleEl, closeBtn]),
        bodyEl,
    ]);

    closeBtn.addEventListener("click", () => {
        root.hidden = true;
    });

    async function open(videoId, title) {
        titleEl.textContent = title;
        bodyEl.textContent = t("ytmusic.lyrics.loading");
        root.hidden = false;
        try {
            const r = await api.youtubeMusic.lyrics(videoId);
            bodyEl.textContent = r.lyrics && r.lyrics.trim() ? r.lyrics : t("ytmusic.lyrics.none");
        } catch {
            bodyEl.textContent = t("ytmusic.lyrics.error");
        }
    }

    return { root, open };
}
```

- [ ] **Step 4: Add the new i18n keys**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.lyrics.loading": "Loading lyrics...",
  "ytmusic.lyrics.none": "No lyrics for this track.",
  "ytmusic.lyrics.error": "Could not load lyrics.",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run ui/test/ytmusic/lyrics.test.js`

Expected: PASS.

- [ ] **Step 6: Mount the panel from `shell.js` and open it from the now-playing bar**

In `ui/dist/js/ytmusic/shell.js`, import and instantiate it alongside the views:

```js
import { createLyricsPanel } from "./lyrics.js";
```

```js
    const lyricsPanel = createLyricsPanel();
    content.append(lyricsPanel.root);
```

Add a lyrics button to the now-playing bar, next to `npPlay`:

```js
    const npLyricsBtn = el("button", { type: "button", class: "icon-btn", dataset: { i18n: "ytmusic.lyrics.open" } }, t("ytmusic.lyrics.open"));
    npBar.append(npLyricsBtn);
```

Track the current track id/title so the button knows what to open; `render()` already receives `state` every tick, capture it there:

```js
    let currentTrack = { video_id: "", title: "" };
    npLyricsBtn.addEventListener("click", () => {
        if (currentTrack.video_id) lyricsPanel.open(currentTrack.video_id, currentTrack.title);
    });
```

The now-playing state exposes a title but not a raw `video_id` today (`state.track` carries `title`/`artist`/`artwork_url`/`duration_ms`/`position_ms`, per `http_server.cpp`'s `track_to_json`, not a `video_id`). Extending `TrackInfo`/`track_to_json` to also carry `video_id` for the active YouTube Music track is a small, separable backend follow-up (out of scope for this task, since it touches `include/fh6/audio_source.hpp`'s shared `TrackInfo` struct used by every source, not just YouTube Music); until that lands, wire the button to use the last video id the frontend itself initiated (from `queue.js`'s `getQueue().items[0]?.video_id`) as a same-session approximation:

```js
    import { getQueue } from "./queue.js"; // add to the existing import block at the top of the file

    npLyricsBtn.addEventListener("click", () => {
        const q = getQueue();
        const track = q.items[0];
        if (track?.video_id) lyricsPanel.open(track.video_id, track.title);
    });
```

Remove the earlier `currentTrack` sketch, this `getQueue()`-based approach is the one to ship, it needs no new render-time state at all.

- [ ] **Step 7: Add the `ytmusic.lyrics.open` i18n key**

In `ui/dist/lang/en.json`:

```json
  "ytmusic.lyrics.open": "Lyrics",
```

- [ ] **Step 8: Manual smoke check**

With the mod installed and running, play a track from search, open the lyrics panel, confirm it fetches once (check the Network tab, one request to `/api/source/youtube_music/lyrics`) and shows either real lyrics or the "No lyrics for this track" empty state, never an unhandled error.

- [ ] **Step 9: Commit**

```bash
git add ui/dist/js/ytmusic/lyrics.js ui/dist/js/ytmusic/shell.js ui/test/ytmusic/lyrics.test.js ui/dist/lang/en.json
git commit -m "feat(ui): add the lyrics panel, opened lazily from the now-playing bar

Fetches only when opened, never prefetched per track. Uses the
frontend's own queue.js state for the current video id as a
same-session approximation, since TrackInfo/track_to_json does not
carry video_id yet, a separate backend follow-up since TrackInfo is
shared by every source, not just YouTube Music."
```

---

## Post-plan follow-ups (explicitly out of scope for this plan, noted for later)

- Give `InnertubeClient` a distinct 429/captcha-challenge message. Today a 429 falls through `net::http_post`'s existing non-2xx-to-nullopt behavior and surfaces as a generic `network_error`, functionally a safe soft-fail already (toast, retry button, per the design doc), just not the specific "slow down, try again shortly" copy the design doc describes.
- Extend `TrackInfo`/`track_to_json` with an optional `video_id` field so the lyrics button (and any future per-track deep link) works for a track reached by any path, not only the current session's own queue, per Task 16's note.
- Verify the `VLLM` (liked songs) and `FEmusic_liked_playlists` (playlist grid) fixed Innertube browse ids against a real logged-in account, and fill in `LibrarySnapshot.subscriptions` once its browse id is confirmed, per Task 4's notes.
- Fix the pre-existing i18n-loading gap in `ui/test/render/*.test.js` (those tests assert hardcoded English strings against code that now calls `t()`, which returns raw keys when `initI18n()` was never run in a test environment), flagged but explicitly deferred by Task 1.
