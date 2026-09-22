import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../dist/js/data/api.js";

function ok(body = {}) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

function lastCall() {
  const [path, opts] = global.fetch.mock.calls.at(-1);
  return {
    path,
    method: opts.method,
    body: opts.body ? JSON.parse(opts.body) : undefined,
    headers: opts.headers,
  };
}

beforeEach(() => {
  global.fetch = ok();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api endpoints", () => {
  it("getState GETs /api/state with no body", async () => {
    await api.getState();
    expect(lastCall()).toEqual({ path: "/api/state", method: "GET", body: undefined, headers: {} });
  });

  it("getConfig / reloadConfig / putConfig hit /api/config", async () => {
    await api.getConfig();
    expect(lastCall().path).toBe("/api/config");
    expect(lastCall().method).toBe("GET");

    await api.reloadConfig();
    expect(lastCall()).toMatchObject({ path: "/api/config/reload", method: "POST" });

    await api.putConfig({ audio: { output_gain: 0.4 } });
    const put = lastCall();
    expect(put.path).toBe("/api/config");
    expect(put.method).toBe("PUT");
    expect(put.body).toEqual({ audio: { output_gain: 0.4 } });
    expect(put.headers).toEqual({ "content-type": "application/json" });
  });

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

  it("castOnlineRadio carries url plus optional name/logo", async () => {
    await api.castOnlineRadio("https://stream");
    expect(lastCall()).toMatchObject({
      path: "/api/source/online_radio/cast",
      body: { url: "https://stream" },
    });

    await api.castOnlineRadio("https://stream", { name: "Jazz FM", logo: "http://logo" });
    expect(lastCall()).toMatchObject({
      path: "/api/source/online_radio/cast",
      body: { url: "https://stream", name: "Jazz FM", logo: "http://logo" },
    });
  });

  it("putExternalAudio PUTs config payload", async () => {
    await api.putExternalAudio({ enabled: true, endpoint_id: "dev", media_session_id: "sess" });
    expect(lastCall()).toMatchObject({
      path: "/api/external_audio/config",
      method: "PUT",
      body: { enabled: true, endpoint_id: "dev", media_session_id: "sess" },
    });
  });

  it("local files endpoints carry the right method and body", async () => {
    await api.browseFs("C:\\Music");
    expect(lastCall()).toMatchObject({
      path: "/api/fs/browse",
      method: "POST",
      body: { path: "C:\\Music" },
    });

    await api.localFiles.getStations();
    expect(lastCall()).toMatchObject({ path: "/api/source/local_files/stations", method: "GET" });

    const stations = [{ name: "Rock", roots: ["D:\\Rock"], excluded: [] }];
    await api.localFiles.putStations(stations, "Rock");
    expect(lastCall()).toMatchObject({
      path: "/api/source/local_files/stations",
      method: "PUT",
      body: { stations, active_station: "Rock" },
    });

    await api.localFiles.activateStation("Rock");
    expect(lastCall()).toMatchObject({
      path: "/api/source/local_files/activate",
      method: "POST",
      body: { name: "Rock" },
    });

    await api.localFiles.getQueue();
    expect(lastCall()).toMatchObject({ path: "/api/source/local_files/queue", method: "GET" });

    await api.localFiles.playIndex(7);
    expect(lastCall()).toMatchObject({
      path: "/api/source/local_files/play",
      method: "POST",
      body: { index: 7 },
    });

    await api.reshuffleLocal();
    expect(lastCall()).toMatchObject({ path: "/api/source/local_files/reshuffle", method: "POST" });
  });

  it("throws the server error message on non-ok responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Bad Gateway",
      json: async () => ({ error: "jellyfin fetch failed" }),
    });
    await expect(api.jellyfin.cast("x", false)).rejects.toThrow("jellyfin fetch failed");
  });

  it("falls back to statusText when no error body", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, statusText: "Not Found", json: async () => ({}) });
    await expect(api.getState()).rejects.toThrow("Not Found");
  });
});
