//
// Single source of truth for the YouTube Music takeover's current play
// queue. Search, library, and radio all funnel through here instead of each
// view tracking its own queue, so the now-playing bar and any queue panel
// always agree on what is coming up next.
import { api } from "../data/api.js";
import { toast } from "../toast.js";

let current = { source: null, items: [] };
const listeners = new Set();

function notify() {
    for (const fn of listeners) fn(current);
}

// GET .../queue returns each track's playable watch URL, not a bare
// video_id (that's what the backend queue actually stores; see
// watch_url_for_id() in youtube_music_source.cpp). Pull the video_id back
// out of it, since every view/lyrics.js call site keys off video_id.
function videoIdFromUrl(url) {
    const m = /[?&]v=([^&]+)/.exec(url || "");
    return m ? m[1] : "";
}

// Library casts and radio starts don't return the resolved track list
// themselves (the backend only confirms playback started), so fetch it
// from the queue endpoint the same request just populated. Best-effort:
// if this fails, the queue stays source-tagged but empty rather than
// failing the whole play action, which already succeeded.
async function fetchQueueItems() {
    try {
        const q = await api.youtubeMusic.getQueue();
        return (q.tracks || []).map(t => ({
            video_id: videoIdFromUrl(t.url),
            title: t.title,
            artist: t.artist,
            thumbnail_url: t.thumbnail_url,
        }));
    } catch {
        return [];
    }
}

export function onQueueChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getQueue() {
    return current;
}

export async function playTrack(videoId, title, thumbnailUrl) {
    try {
        await api.youtubeMusic.playTrack(videoId);
        current = { source: "search", items: [{ video_id: videoId, title, thumbnail_url: thumbnailUrl }] };
        notify();
    } catch (e) {
        toast(e.message, true);
    }
}

export async function playLibraryPlaylist(browseId, title) {
    try {
        await api.youtubeMusic.castLibraryPlaylist(browseId);
        current = { source: "library", items: await fetchQueueItems() };
        notify();
        toast(`Playing ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}

export async function startRadio(videoId, title) {
    try {
        await api.youtubeMusic.radio(videoId);
        current = { source: "radio", items: await fetchQueueItems() };
        notify();
        toast(`Starting radio from ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}
