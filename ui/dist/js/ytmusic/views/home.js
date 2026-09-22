import { el } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { getQueue, onQueueChange, playTrack, playLibraryPlaylist, startRadio } from "../queue.js";

export function createHome() {
    const body = el("div", { class: "yt-home-body" });
    const root = el("section", { class: "yt-view yt-view-home", hidden: true }, [body]);

    let browseLoaded = false;

    function resultRow(item) {
        const row = el("div", { class: "yt-search-row" }, [
            el("span", { class: "yt-search-title" }, item.title),
            item.subtitle ? el("span", { class: "yt-search-subtitle muted" }, item.subtitle) : null,
        ].filter(Boolean));

        if (item.video_id) {
            // A song: click plays it directly, works with or without an
            // account (search()/browse_playlist() don't require auth).
            row.classList.add("clickable");
            row.addEventListener("click", () => playTrack(item.video_id, item.title));

            const radioBtn = el("button", { type: "button", class: "btn ghost yt-radio-btn" }, t("ytmusic.start_radio"));
            radioBtn.addEventListener("click", e => {
                e.stopPropagation();
                startRadio(item.video_id, item.title);
            });
            row.append(radioBtn);
        } else if (item.browse_id) {
            // A playlist/album/mix: click casts it. Public playlists cast
            // fine without an account too; a private one 401s the same way
            // library casts already do.
            row.classList.add("clickable");
            row.addEventListener("click", () => playLibraryPlaylist(item.browse_id, item.title));
        }
        return row;
    }

    async function loadBrowseFeed() {
        body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.home.loading")));
        try {
            const r = await api.youtubeMusic.home();
            const items = r.results || [];
            if (!items.length) {
                body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.home.browse_empty")));
                return;
            }
            body.replaceChildren(...items.map(resultRow));
        } catch (e) {
            body.replaceChildren(el("p", { class: "muted" }, e.message || t("ytmusic.home.browse_error")));
        }
    }

    // The queue (whatever is currently playing or was last queued, from
    // search, library or radio) takes priority when there is one; otherwise
    // Home is the live browse feed, fetched once, so there is always
    // something to pick from here even with no account signed in.
    function draw() {
        const q = getQueue();
        if (!q.source || !q.items.length) {
            if (!browseLoaded) {
                browseLoaded = true;
                loadBrowseFeed();
            }
            return;
        }
        browseLoaded = false; // queue was cleared elsewhere; re-fetch the feed next time we land here empty
        body.replaceChildren(
            el("h3", {}, t("ytmusic.home.up_next")),
            ...q.items.map(track =>
                el("div", { class: "yt-search-row" }, [
                    el("span", { class: "yt-search-title" }, track.title || track.video_id),
                    track.artist ? el("span", { class: "yt-search-subtitle muted" }, track.artist) : null,
                ].filter(Boolean)),
            ),
        );
    }

    onQueueChange(draw);
    draw();

    return { root, render() {} };
}
