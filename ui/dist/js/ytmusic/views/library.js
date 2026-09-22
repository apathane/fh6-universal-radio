import { el } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { playLibraryPlaylist, playTrack } from "../queue.js";

export function createLibrary() {
    const body = el("div", { class: "yt-library-body" });
    const root = el("section", { class: "yt-view yt-view-library", hidden: true }, [body]);

    let loaded = false;

    function playlistTile(pl) {
        const tile = el("button", { type: "button", class: "yt-library-tile" }, [
            el("span", { class: "yt-library-tile-title" }, pl.title),
        ]);
        tile.addEventListener("click", () => playLibraryPlaylist(pl.browse_id, pl.title));
        return tile;
    }

    function trackRow(track) {
        const row = el("div", { class: "yt-search-row clickable" }, [
            el("span", { class: "yt-search-title" }, track.title),
            el("span", { class: "yt-search-subtitle muted" }, track.artist),
        ]);
        row.addEventListener("click", () => playTrack(track.video_id, track.title));
        return row;
    }

    async function load() {
        try {
            const r = await api.youtubeMusic.library();
            body.replaceChildren(
                el("h3", {}, t("ytmusic.library.liked_songs")),
                ...(r.liked_songs || []).map(trackRow),
                el("h3", {}, t("ytmusic.library.playlists")),
                el("div", { class: "yt-library-grid" }, (r.playlists || []).map(playlistTile)),
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
