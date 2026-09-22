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
    try {
        json body = {{"context", json::parse(kContext)}, {"query", query}};
        const std::string resp = post("/youtubei/v1/search", body.dump());
        if (resp.empty()) return {InnertubeStatus::network_error, {}};

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

Result<std::vector<QueueTrack>> InnertubeClient::browse_playlist(const std::string& browse_id) const {
    try {
        json body = {{"context", json::parse(kContext)}, {"browseId", browse_id}};
        const std::string resp = post("/youtubei/v1/browse", body.dump());
        if (resp.empty()) return {InnertubeStatus::network_error, {}};

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
    try {
        json body = {{"context", json::parse(kContext)}, {"browseId", "FEmusic_liked_playlists"}};
        const std::string resp = post("/youtubei/v1/browse", body.dump());
        if (resp.empty()) return {InnertubeStatus::network_error, {}};

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
Result<std::vector<QueueTrack>> InnertubeClient::next(const std::string& video_id) const {
    try {
        // isAudioOnly + a plain videoId body is Innertube's radio/autoplay
        // continuation: the same "start radio" queue the WEB_REMIX player
        // builds when a track is played with radio enabled.
        json body = {{"context", json::parse(kContext)}, {"videoId", video_id}, {"isAudioOnly", true}};
        const std::string resp = post("/youtubei/v1/next", body.dump());
        if (resp.empty()) return {InnertubeStatus::network_error, {}};

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

Result<std::string> InnertubeClient::lyrics(const std::string& video_id) const {
    std::string lyrics_browse_id;
    try {
        json next_body = {{"context", json::parse(kContext)}, {"videoId", video_id}};
        const std::string next_resp = post("/youtubei/v1/next", next_body.dump());
        if (next_resp.empty()) return {InnertubeStatus::network_error, {}};

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

    try {
        json browse_body = {{"context", json::parse(kContext)}, {"browseId", lyrics_browse_id}};
        const std::string browse_resp = post("/youtubei/v1/browse", browse_body.dump());
        if (browse_resp.empty()) return {InnertubeStatus::network_error, {}};

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

} // namespace fh6::ytmusic
