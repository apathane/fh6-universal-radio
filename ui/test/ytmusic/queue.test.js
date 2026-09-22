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
