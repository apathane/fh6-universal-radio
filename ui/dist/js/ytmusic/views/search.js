import { el, debounce } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { playTrack, startRadio } from "../queue.js";

export function createSearch() {
    const input = el("input", {
        type: "text",
        class: "yt-search-input",
        placeholder: t("ytmusic.search.placeholder"),
        autocomplete: "off",
    });
    const results = el("div", { class: "yt-search-results" });
    const root = el("section", { class: "yt-view yt-view-search", hidden: true }, [input, results]);

    function resultRow(item) {
        const row = el("div", { class: "yt-search-row" }, [
            el("span", { class: "yt-search-title" }, item.title),
            item.subtitle ? el("span", { class: "yt-search-subtitle muted" }, item.subtitle) : null,
        ].filter(Boolean));

        if (item.video_id) {
            row.classList.add("clickable");
            row.addEventListener("click", () => playTrack(item.video_id, item.title));

            const radioBtn = el("button", { type: "button", class: "btn ghost yt-radio-btn" }, t("ytmusic.start_radio"));
            radioBtn.addEventListener("click", e => {
                e.stopPropagation();
                startRadio(item.video_id, item.title);
            });
            row.append(radioBtn);
        }
        return row;
    }

    const runSearch = debounce(async () => {
        const query = input.value.trim();
        if (!query) {
            results.replaceChildren();
            return;
        }
        try {
            const r = await api.youtubeMusic.search(query);
            results.replaceChildren(...(r.results || []).map(resultRow));
            if (!r.results?.length) results.append(el("p", { class: "muted" }, t("ytmusic.search.no_results")));
        } catch {
            results.replaceChildren(el("p", { class: "muted" }, t("ytmusic.search.error")));
        }
    }, 200);

    input.addEventListener("input", runSearch);

    return { root, render() {} };
}
