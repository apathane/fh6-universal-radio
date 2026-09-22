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

  it("playTrack carries the thumbnail url through to the queue item", async () => {
    await playTrack("abc123", "Some Song", "https://example.com/art.jpg");
    expect(getQueue().items[0].thumbnail_url).toBe("https://example.com/art.jpg");
  });

  it("playLibraryPlaylist tags the queue source as library", async () => {
    await playLibraryPlaylist("VLabc", "My Playlist");
    expect(getQueue().source).toBe("library");
  });

  it("startRadio tags the queue source as radio", async () => {
    await startRadio("abc123", "Some Song");
    expect(getQueue().source).toBe("radio");
  });

  it("playLibraryPlaylist pulls thumbnail_url through from the queue endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cursor: 0,
        tracks: [{ index: 0, title: "Track A", artist: "Artist A",
                   url: "https://www.youtube.com/watch?v=xyz789", thumbnail_url: "https://example.com/xyz.jpg" }],
      }),
    });
    await playLibraryPlaylist("VLabc", "My Playlist");
    expect(getQueue().items[0]).toEqual({
      video_id: "xyz789", title: "Track A", artist: "Artist A", thumbnail_url: "https://example.com/xyz.jpg",
    });
  });
});
