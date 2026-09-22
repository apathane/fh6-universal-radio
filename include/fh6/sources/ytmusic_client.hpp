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
