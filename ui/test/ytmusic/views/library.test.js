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
