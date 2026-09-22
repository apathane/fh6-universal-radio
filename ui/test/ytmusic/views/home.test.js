// ui/test/ytmusic/views/home.test.js
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../dist/js/i18n.js", () => ({
  t: (key) => {
    const strings = {
      "ytmusic.home.empty": "Search for something to get started, or browse your library.",
      "ytmusic.home.up_next": "Up next",
    };
    return strings[key] || key;
  },
}));

import { createHome } from "../../../dist/js/ytmusic/views/home.js";

describe("ytmusic home view", () => {
  it("shows a getting-started message when nothing has played yet", () => {
    document.body.innerHTML = "";
    const { root, render } = createHome();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    expect(root.textContent).toContain("Search for something to get started");
  });
});
