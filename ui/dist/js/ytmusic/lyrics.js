// ui/dist/js/ytmusic/lyrics.js
//
// Lazy-fetched lyrics panel, opened from the now-playing bar. Never
// prefetched per track (that would be one Innertube call per song change
// for a feature most plays never open), per the design doc.
import { el } from "../lib/dom.js";
import { api } from "../data/api.js";
import { t } from "../i18n.js";

export function createLyricsPanel() {
    const titleEl = el("h3", {});
    const bodyEl = el("pre", { class: "yt-lyrics-body" });
    const closeBtn = el("button", { type: "button", class: "icon-btn", "aria-label": t("btn.close") ?? "Close" }, "×");

    const root = el("div", { class: "yt-lyrics-panel", hidden: true }, [
        el("div", { class: "yt-lyrics-head" }, [titleEl, closeBtn]),
        bodyEl,
    ]);

    closeBtn.addEventListener("click", () => {
        root.hidden = true;
    });

    async function open(videoId, title) {
        titleEl.textContent = title;
        bodyEl.textContent = t("ytmusic.lyrics.loading");
        root.hidden = false;
        try {
            const r = await api.youtubeMusic.lyrics(videoId);
            bodyEl.textContent = r.lyrics && r.lyrics.trim() ? r.lyrics : t("ytmusic.lyrics.none");
        } catch {
            bodyEl.textContent = t("ytmusic.lyrics.error");
        }
    }

    return { root, open };
}
