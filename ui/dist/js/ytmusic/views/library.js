import { el } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { itemRow, itemTile } from "../itemRow.js";

export function createLibrary() {
    const body = el("div", { class: "yt-library-body" });
    const root = el("section", { class: "yt-view yt-view-library", hidden: true }, [body]);

    let loaded = false;

    async function load() {
        try {
            const r = await api.youtubeMusic.library();
            body.replaceChildren(
                el("h3", {}, t("ytmusic.library.liked_songs")),
                ...(r.liked_songs || []).map(itemRow),
                el("h3", {}, t("ytmusic.library.playlists")),
                el("div", { class: "yt-item-grid" }, (r.playlists || []).map(itemTile)),
            );
            if (!r.liked_songs?.length && !r.playlists?.length) {
                body.append(el("p", { class: "muted" }, t("ytmusic.library.empty")));
            }
        } catch (e) {
            body.replaceChildren(el("p", { class: "muted" }, e.message || t("ytmusic.library.error")));
        }
    }

    return {
        root,
        render(state) {
            if (state?.sources?.active !== "youtube_music" || loaded) return;
            loaded = true;
            load();
        },
    };
}
