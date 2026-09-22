import { el } from "../../lib/dom.js";
import { api } from "../../data/api.js";
import { t } from "../../i18n.js";
import { getQueue, onQueueChange } from "../queue.js";
import { itemRow, itemTile, splitResults } from "../itemRow.js";

export function createHome() {
    const body = el("div", { class: "yt-home-body" });
    const root = el("section", { class: "yt-view yt-view-home", hidden: true }, [body]);

    let browseLoaded = false;
    let browseFetchInFlight = false;

    async function loadBrowseFeed() {
        if (browseFetchInFlight) return;
        browseFetchInFlight = true;
        body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.home.loading")));
        try {
            const r = await api.youtubeMusic.home();
            const items = r.results || [];
            if (!items.length) {
                body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.home.browse_empty")));
                return;
            }
            const { songs, playlists } = splitResults(items);
            body.replaceChildren(
                ...songs.map(itemRow),
                ...(playlists.length ? [el("div", { class: "yt-item-grid" }, playlists.map(itemTile))] : []),
            );
        } catch (e) {
            // e.message surfaces the backend's actual text (e.g. "not
            // authenticated" for a signed-in user's expired cookie), same
            // pattern the library view uses, distinct from the generic
            // fallback for an unrelated network hiccup.
            body.replaceChildren(el("p", { class: "muted" }, e.message || t("ytmusic.home.browse_error")));
        } finally {
            browseFetchInFlight = false;
        }
    }

    function drawUpNext(q) {
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

    // Reacts to the shared queue regardless of which tab is currently shown
    // (matches the pre-existing design: Home always reflects what's
    // actually playing). The live browse feed is different: fetching it is
    // a real network call, so it's gated in render() below on Home actually
    // being the visible tab, not fired unconditionally at construction.
    onQueueChange(q => {
        if (q.source && q.items.length) {
            browseLoaded = false; // queue emptying later should re-fetch a fresh feed
            drawUpNext(q);
        }
    });

    return {
        root,
        render(state) {
            if (state?.sources?.active !== "youtube_music") return;
            const q = getQueue();
            if (q.source && q.items.length) {
                drawUpNext(q);
                return;
            }
            if (!browseLoaded) {
                browseLoaded = true;
                loadBrowseFeed();
            }
        },
    };
}
