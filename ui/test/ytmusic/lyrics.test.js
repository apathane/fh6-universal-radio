// ui/test/ytmusic/lyrics.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../dist/js/i18n.js", () => ({
  t: (key) => {
    const strings = {
      "ytmusic.lyrics.loading": "Loading lyrics...",
      "ytmusic.lyrics.none": "No lyrics for this track.",
      "ytmusic.lyrics.error": "Could not load lyrics.",
    };
    return strings[key] || key;
  },
}));

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
