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

export function onQueueChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getQueue() {
    return current;
}

export async function playTrack(videoId, title) {
    try {
        await api.youtubeMusic.playTrack(videoId);
        current = { source: "search", items: [{ video_id: videoId, title }] };
        notify();
    } catch (e) {
        toast(e.message, true);
    }
}

export async function playLibraryPlaylist(browseId, title) {
    try {
        await api.youtubeMusic.castLibraryPlaylist(browseId);
        current = { source: "library", items: [] };
        notify();
        toast(`Playing ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}

export async function startRadio(videoId, title) {
    try {
        await api.youtubeMusic.radio(videoId);
        current = { source: "radio", items: [] };
        notify();
        toast(`Starting radio from ${title}`);
    } catch (e) {
        toast(e.message, true);
    }
}
