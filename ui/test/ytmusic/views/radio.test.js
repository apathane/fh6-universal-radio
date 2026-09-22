// ui/test/ytmusic/views/radio.test.js
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../dist/js/i18n.js", () => ({
  t: (key) => {
    const strings = {
      "ytmusic.radio.empty": "Start a radio from any search result to see it here.",
      "ytmusic.radio.now_playing": "Now in your radio",
    };
    return strings[key] || key;
  },
}));

import { createRadio } from "../../../dist/js/ytmusic/views/radio.js";

// queue.js's module-level `current` state is shared across the whole test
// file via the real module (not mocked); each test reaches it only through
// startRadio's public API, exercised via the shell in Task 11's manual
// check, this view test only cares about its own render(no queue) path.

describe("ytmusic radio view", () => {
  it("shows the empty state when no radio queue is active", () => {
    document.body.innerHTML = "";
    const { root, render } = createRadio();
    document.body.append(root);
    render({ sources: { active: "youtube_music" } });
    expect(root.textContent).toContain("Start a radio from any search result");
  });
});
