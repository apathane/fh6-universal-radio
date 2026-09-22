import { el, debounce } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { itemRow, itemTile, splitResults } from "../itemRow.js";

export function createSearch() {
    const input = el("input", {
        type: "text",
        class: "yt-search-input",
        placeholder: t("ytmusic.search.placeholder"),
        autocomplete: "off",
    });
    const results = el("div", { class: "yt-search-results" });
    const root = el("section", { class: "yt-view yt-view-search", hidden: true }, [input, results]);

    const runSearch = debounce(async () => {
        const query = input.value.trim();
        if (!query) {
            results.replaceChildren();
            return;
        }
        try {
            const r = await api.youtubeMusic.search(query);
            const items = r.results || [];
            if (!items.length) {
                results.replaceChildren(el("p", { class: "muted" }, t("ytmusic.search.no_results")));
                return;
            }
            const { songs, playlists } = splitResults(items);
            results.replaceChildren(
                ...songs.map(itemRow),
                ...(playlists.length ? [el("div", { class: "yt-item-grid" }, playlists.map(itemTile))] : []),
            );
        } catch {
            results.replaceChildren(el("p", { class: "muted" }, t("ytmusic.search.error")));
        }
    }, 200);

    input.addEventListener("input", runSearch);

    return { root, render() {} };
}
