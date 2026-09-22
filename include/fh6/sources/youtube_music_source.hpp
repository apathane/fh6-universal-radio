#pragma once

#include "fh6/audio_source.hpp"
#include "fh6/config.hpp"
#include "fh6/worker/worker_client.hpp"
#include "fh6/playback_dsp.hpp"
#include "fh6/sources/ytmusic_client.hpp"

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace fh6::sources {

// Streams audio via `yt-dlp | ffmpeg -f s16le -ar 48000 -ac 2`. The PCM pipe
// is drained into the ring buffer by pump(). For playlist URLs we resolve the
// item list up front (via --flat-playlist) so next() / previous() can walk it.
class YouTubeMusicSource final : public IAudioSource {
public:
    YouTubeMusicSource(YouTubeMusicConfig cfg, std::filesystem::path ffmpeg_path,
                        std::filesystem::path data_dir, worker::WorkerClient* worker = nullptr);
    ~YouTubeMusicSource() override;

    std::string_view name() const noexcept override { return "youtube_music"; }
    std::string_view display_name() const noexcept override { return "YouTube Music"; }

    bool initialize() override;
    void shutdown() noexcept override;

    void play() override;
    void pause() override;
    void stop() override;
    void next() override;
    void previous() override;
    bool skip_next() override;
    bool restart_current() override;
    void pump(RingBuffer& ring) override;

    // URL / playlist to play next.
    void set_target(std::string url);

    void set_shuffle(bool shuffle);
    void set_ffmpeg_path(std::filesystem::path p);
    void set_yt_dlp_path(std::filesystem::path p);
    void set_playback_options(const PlaybackConfig& opts) override;

    void set_config(YouTubeMusicConfig cfg);
    void set_active_station(std::string name);

    std::size_t station_count() const noexcept;
    std::string active_station_name() const;

    struct QueueEntry {
        std::size_t index;
        std::string url;
        std::string title;
        std::string artist;
    };
    struct QueueSnapshot {
        std::size_t cursor;
        std::vector<QueueEntry> entries;
    };

    QueueSnapshot queue_snapshot() const;
    bool jump_to(std::size_t index);

    TrackInfo current_track() const override;
    PlaybackState playback_state() const noexcept override {
        return state_.load(std::memory_order_acquire);
    }
    AuthState auth_state() const noexcept override { return auth_; }
    std::string auth_instructions() const override;
    SourceCapabilities capabilities() const noexcept override { return {false, true, true}; }

    bool shuffle() const {
        std::scoped_lock lk{mu_};
        return cfg_.shuffle;
    }

    // Account/catalog metadata, backed by Innertube. Never touches the audio
    // pipeline; safe to call from the HTTP thread while playback runs.
    ytmusic::Result<std::vector<ytmusic::SearchResultItem>> search_catalog(const std::string& query) const;
    ytmusic::Result<ytmusic::LibrarySnapshot> library_snapshot() const;
    ytmusic::Result<std::string> track_lyrics(const std::string& video_id) const;

    // Ephemeral plays: not persisted as a saved station (unlike
    // set_active_station), mirrors set_target()'s one-off cast semantics.
    bool cast_library_playlist(std::string browse_id);
    bool start_radio(std::string seed_video_id);

private:
    struct Pipe;

    // mu_ held for all *_locked helpers.
    std::unique_ptr<Pipe> spawn_pipe_locked(std::string_view url, std::size_t for_idx);
    void start_pipe_locked(); // (re)spawn pipe_ for queue_[queue_idx_]
    void stop_pipe_locked();  // drop pipe_ only
    void discard_prefetch_locked() noexcept;
    void resolve_queue_locked(); // populates queue_ from target_url_
    std::size_t next_queue_idx_locked() const noexcept;
    bool promote_prefetch_locked(std::size_t expected_idx);
    void maybe_spawn_prefetch_locked(); // called from pump() once current is healthy
    void drain_title_pipe_locked(Pipe* p);

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

    YouTubeMusicConfig cfg_;
    std::filesystem::path ffmpeg_path_;
    worker::WorkerClient* worker_;
    // Declared after worker_ (and before pipe_) to match the constructor's
    // member-init order: cfg_, ffmpeg_path_, worker_, client_, cache_dir_.
    // client_ is rebuilt (not mutated) under client_mtx_ whenever cookies_path
    // changes; readers copy the shared_ptr under the lock and then call
    // through it unlocked, same shape as dsp_control_loop.cpp's
    // playback_opts_/playback_opts_mtx_.
    mutable std::mutex client_mtx_;
    std::shared_ptr<const ytmusic::InnertubeClient> client_;
    std::filesystem::path cache_dir_;
    std::atomic<bool> cache_refreshing_{false};
    std::unique_ptr<Pipe> pipe_;
    std::unique_ptr<Pipe> prefetch_; // pre-spawned next-track pipeline (or null)

    const YouTubeStation* active_station_locked() const noexcept;

    mutable std::mutex mu_;
    std::string target_url_;
    struct InternalQueueEntry {
        std::string url;
        std::string title;
        std::string artist;
        std::size_t original_index = 0;
    };
    std::vector<InternalQueueEntry> queue_; // canonical watch URLs in playback order
    std::size_t queue_idx_ = 0;
    std::string queue_built_for_; // value of target_url_ when queue_ was resolved
    std::atomic<uint64_t> position_ms_{0};
    int consecutive_failed_ = 0; // tracks-in-a-row that produced 0 PCM bytes
    AuthState auth_         = AuthState::none_required;
    std::atomic<PlaybackState> state_{PlaybackState::stopped};

    EqualizerStage eq_;
    std::atomic<bool> volume_norm_{true};
    std::atomic<bool> prebuffer_next_{true};
};

} // namespace fh6::sources
