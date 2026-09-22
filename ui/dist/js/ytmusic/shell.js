import { el } from "../lib/dom.js";
import { t } from "../i18n.js";
import { icons } from "../icons.js";
import { renderNowPlaying } from "../render/nowPlaying.js";
import { createHome } from "./views/home.js";
import { createSearch } from "./views/search.js";
import { createLibrary } from "./views/library.js";
import { createRadio } from "./views/radio.js";
import { createLyricsPanel } from "./lyrics.js";
import { getQueue } from "./queue.js";

const TABS = [
    ["home", "ytmusic.nav.home"],
    ["search", "ytmusic.nav.search"],
    ["library", "ytmusic.nav.library"],
    ["radio", "ytmusic.nav.radio"],
];

export function createYtMusicShell({ transport, openDrawer } = {}) {
    let activeTab = "home";

    const railButtons = new Map();
    const tabButtons = new Map();
    const rail = el("nav", { class: "yt-rail", "aria-label": "YouTube Music sections" });
    const tabbar = el("nav", { class: "yt-tabbar", "aria-label": "YouTube Music sections" });
    const content = el("div", { class: "yt-content" });

    // The takeover hides the generic dashboard's own header (settings) and
    // hero (transport), so the shell needs its own way to reach both;
    // otherwise, once youtube_music is active, there is no way to pause,
    // skip, or open settings at all.
    const settingsBtn = el("button", {
        type: "button",
        class: "yt-nav-btn icon-btn",
        "aria-label": t("settings.open"),
    });
    settingsBtn.innerHTML = icons.gear; // trusted static app icon, same pattern as main.js's mini-player icons
    settingsBtn.addEventListener("click", () => openDrawer?.());
    rail.append(settingsBtn);

    const views = {
        home: createHome(),
        search: createSearch(),
        library: createLibrary(),
        radio: createRadio(),
    };

    function selectTab(id) {
        activeTab = id;
        for (const [key, btn] of railButtons) btn.classList.toggle("on", key === id);
        for (const [key, btn] of tabButtons) btn.classList.toggle("on", key === id);
        for (const [key, view] of Object.entries(views)) view.root.hidden = key !== id;
        lyricsPanel.root.hidden = true;
    }

    for (const [id, labelKey] of TABS) {
        const railBtn = el("button", { type: "button", class: "yt-nav-btn", dataset: { i18n: labelKey } }, t(labelKey));
        const tabBtn = el("button", { type: "button", class: "yt-nav-btn", dataset: { i18n: labelKey } }, t(labelKey));
        railBtn.addEventListener("click", () => selectTab(id));
        tabBtn.addEventListener("click", () => selectTab(id));
        railButtons.set(id, railBtn);
        tabButtons.set(id, tabBtn);
        rail.append(railBtn);
        tabbar.append(tabBtn);
    }

    const lyricsPanel = createLyricsPanel();
    content.append(views.home.root, views.search.root, views.library.root, views.radio.root, lyricsPanel.root);

    const npImg = el("img", { class: "yt-np-img", alt: "" });
    const npTitle = el("div", { class: "yt-np-title" });
    const npArtist = el("div", { class: "yt-np-artist" });
    const npFill = el("div", { class: "yt-np-fill" });
    const npPos = el("span", { class: "yt-np-time" });
    const npDur = el("span", { class: "yt-np-time" });
    const npPrev = el("button", { type: "button", class: "icon-btn", "aria-label": t("now_playing.previous") });
    npPrev.innerHTML = icons.prev;
    npPrev.addEventListener("click", () => transport?.("previous"));

    const npPlay = el("button", { type: "button", class: "icon-btn primary" });
    npPlay.addEventListener("click", () => transport?.("play"));

    const npNext = el("button", { type: "button", class: "icon-btn", "aria-label": t("now_playing.next") });
    npNext.innerHTML = icons.next;
    npNext.addEventListener("click", () => transport?.("next"));

    const npLyricsBtn = el("button", { type: "button", class: "icon-btn", dataset: { i18n: "ytmusic.lyrics.open" } }, t("ytmusic.lyrics.open"));
    npLyricsBtn.addEventListener("click", () => {
        const track = getQueue().items[0];
        if (track?.video_id) lyricsPanel.open(track.video_id, track.title);
    });
    const npBar = el("div", { class: "yt-now-playing" }, [
        npImg,
        el("div", { class: "yt-np-text" }, [npTitle, npArtist]),
        el("div", { class: "yt-np-progress" }, [npPos, el("div", { class: "yt-np-bar" }, [npFill]), npDur]),
        npPrev,
        npPlay,
        npNext,
        npLyricsBtn,
    ]);

    const shell = el("div", { id: "ytmusic-shell", hidden: true }, [rail, content, npBar, tabbar]);
    document.body.append(shell);

    selectTab("home");

    const npRefs = {
        art: npBar,
        backdrop: null,
        img: npImg,
        title: npTitle,
        artist: npArtist,
        fill: npFill,
        pos: npPos,
        dur: npDur,
        play: npPlay,
    };

    function render(state, cfg) {
        const active = state?.sources?.active === "youtube_music";
        shell.hidden = !active;
        if (!active) return;
        renderNowPlaying(npRefs, state);
        views[activeTab]?.render?.(state, cfg);
    }

    return { root: shell, render };
}
