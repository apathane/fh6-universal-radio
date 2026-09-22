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
  it("does not fetch the browse feed on construction, only once render() sees youtube_music active", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const { root } = createHome();
    document.body.append(root);
    await new Promise(r => setTimeout(r, 0));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when render() is called but a different source is active", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const { render } = createHome();
    render({ sources: { active: "online_radio" } });
    await new Promise(r => setTimeout(r, 0));

    expect(global.fetch).not.toHaveBeenCalled();
  });

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

  it("shows the backend's own error text on a 401, rather than throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Unauthorized",
      json: async () => ({ error: "not authenticated" }),
    });
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    await new Promise(r => setTimeout(r, 0));

    // browse_home() itself has no auth gate, an anonymous user never sees
    // this, but a signed-in user's expired cookie can still produce a real
    // needs_auth/401 here (the request still carries whatever cookie is
    // stored). Surfacing the backend's own message, same pattern the
    // library view uses, distinguishes that case from a generic failure.
    expect(root.textContent).toContain("not authenticated");
  });
});
