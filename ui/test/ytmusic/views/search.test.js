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
