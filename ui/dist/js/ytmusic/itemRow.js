// Shared song-row and playlist-tile renderers for the YouTube Music
// takeover's search/home/library views, so the three don't each carry their
// own near-identical DOM-building code. A "song" has a video_id and plays
// directly (with a Start Radio button); a "playlist/album/mix" has only a
// browse_id and casts on click. Both shapes come from the backend as
// {video_id, browse_id, title, subtitle|artist, thumbnail_url}.
import { el } from "../lib/dom.js";
import { t } from "../i18n.js";
import { playTrack, playLibraryPlaylist, startRadio } from "./queue.js";

// CSS ::after (used for the fallback "no art" glyph) doesn't render on
// replaced elements like <img>, so the glyph lives on a wrapping div, same
// pattern as the existing .track-cover/.track-cover-img in playlistQueue.js.
function thumb(item, wrapCls, imgCls) {
    const wrap = el("div", { class: wrapCls });
    if (item.thumbnail_url) {
        wrap.append(el("img", { class: imgCls, src: item.thumbnail_url, alt: "", loading: "lazy" }));
    } else {
        wrap.dataset.noart = "";
    }
    return wrap;
}

// A song: thumbnail, title/subtitle, click plays it, a Start Radio button
// seeds an autoplay queue from it. Works with or without an account.
export function itemRow(item) {
    const row = el("div", { class: "yt-item-row clickable" }, [
        thumb(item, "yt-item-thumb", "yt-item-thumb-img"),
        el("div", { class: "yt-item-text" }, [
            el("span", { class: "yt-item-title" }, item.title),
            item.subtitle || item.artist
                ? el("span", { class: "yt-item-subtitle muted" }, item.subtitle || item.artist)
                : null,
        ].filter(Boolean)),
    ]);
    row.addEventListener("click", () => playTrack(item.video_id, item.title, item.thumbnail_url));

    const radioBtn = el("button", { type: "button", class: "btn ghost yt-radio-btn" }, t("ytmusic.start_radio"));
    radioBtn.addEventListener("click", e => {
        e.stopPropagation();
        startRadio(item.video_id, item.title);
    });
    row.append(radioBtn);
    return row;
}

// A playlist/album/mix: bigger square art in a grid, title below, click
// casts it. Works for playlists the user doesn't own too (a generic
// Innertube browse, not scoped to the account's own library).
export function itemTile(item) {
    const tile = el("button", { type: "button", class: "yt-item-tile" }, [
        thumb(item, "yt-item-tile-art", "yt-item-tile-art-img"),
        el("span", { class: "yt-item-tile-title" }, item.title),
    ]);
    tile.addEventListener("click", () => playLibraryPlaylist(item.browse_id, item.title));
    return tile;
}

// A queued/now-playing track, display only: thumbnail plus title/artist, no
// click handler and no Start Radio button (it's already playing or queued,
// re-triggering play from here would be redundant). Used by the "up next"
// list (home.js) and the radio view's current autoplay queue (radio.js).
export function queueRow(item) {
    return el("div", { class: "yt-item-row" }, [
        thumb(item, "yt-item-thumb", "yt-item-thumb-img"),
        el("div", { class: "yt-item-text" }, [
            el("span", { class: "yt-item-title" }, item.title || item.video_id),
            item.artist ? el("span", { class: "yt-item-subtitle muted" }, item.artist) : null,
        ].filter(Boolean)),
    ]);
}

// Splits a mixed result list (search results, the home feed) into playable
// songs and playlist/album/mix tiles, so callers can render each with its
// own layout (a list for songs, a grid for tiles) instead of one flat list
// mixing two different visual shapes.
export function splitResults(items) {
    const songs = [];
    const playlists = [];
    for (const item of items) {
        if (item.video_id) songs.push(item);
        else if (item.browse_id) playlists.push(item);
    }
    return { songs, playlists };
}
