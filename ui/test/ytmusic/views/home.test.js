// ui/test/ytmusic/views/home.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../dist/js/i18n.js", () => ({
  t: (key) => {
    const strings = {
      "ytmusic.home.up_next": "Up next",
      "ytmusic.home.loading": "Loading...",
      "ytmusic.home.browse_empty": "Nothing to show right now.",
      "ytmusic.home.browse_error": "Could not load, try again.",
      "ytmusic.start_radio": "Start radio",
    };
    return strings[key] || key;
  },
}));

import { createHome } from "../../../dist/js/ytmusic/views/home.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ytmusic home view", () => {
  it("fetches and renders the live browse feed when nothing is queued", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { video_id: "abc", browse_id: "", title: "Quick Pick Song", subtitle: "Some Artist", thumbnail_url: "" },
          { video_id: "", browse_id: "VLmix1", title: "Chill Mix", subtitle: "", thumbnail_url: "" },
        ],
      }),
    });
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    expect(root.textContent).toContain("Quick Pick Song");
    expect(root.textContent).toContain("Chill Mix");
  });

  it("shows an empty state when the browse feed returns nothing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    expect(root.textContent).toContain("Nothing to show right now.");
  });

  it("works without an account: a 401 from the backend still doesn't crash the view", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Unauthorized",
      json: async () => ({ error: "not authenticated" }),
    });
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    // The home feed itself never requires auth; a 401 here would only come
    // from an unrelated backend hiccup, and should degrade to the error
    // copy rather than throw.
    expect(root.textContent).toContain("not authenticated");
  });
});
