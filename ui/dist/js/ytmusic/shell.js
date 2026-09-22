import { el } from "../lib/dom.js";
import { t } from "../i18n.js";
import { renderNowPlaying } from "../render/nowPlaying.js";
import { createHome } from "./views/home.js";
import { createSearch } from "./views/search.js";
import { createLibrary } from "./views/library.js";
import { createRadio } from "./views/radio.js";

const TABS = [
    ["home", "ytmusic.nav.home"],
    ["search", "ytmusic.nav.search"],
    ["library", "ytmusic.nav.library"],
    ["radio", "ytmusic.nav.radio"],
];

export function createYtMusicShell() {
    let activeTab = "home";

    const railButtons = new Map();
    const tabButtons = new Map();
    const rail = el("nav", { class: "yt-rail", "aria-label": "YouTube Music sections" });
    const tabbar = el("nav", { class: "yt-tabbar", "aria-label": "YouTube Music sections" });
    const content = el("div", { class: "yt-content" });

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

    content.append(views.home.root, views.search.root, views.library.root, views.radio.root);

    const npImg = el("img", { class: "yt-np-img", alt: "" });
    const npTitle = el("div", { class: "yt-np-title" });
    const npArtist = el("div", { class: "yt-np-artist" });
    const npFill = el("div", { class: "yt-np-fill" });
    const npPos = el("span", { class: "yt-np-time" });
    const npDur = el("span", { class: "yt-np-time" });
    const npPlay = el("button", { type: "button", class: "icon-btn primary" });
    const npBar = el("div", { class: "yt-now-playing" }, [
        npImg,
        el("div", { class: "yt-np-text" }, [npTitle, npArtist]),
        el("div", { class: "yt-np-progress" }, [npPos, el("div", { class: "yt-np-bar" }, [npFill]), npDur]),
        npPlay,
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
