import { el } from "../../lib/dom.js";

export function createLibrary() {
    const root = el("section", { class: "yt-view yt-view-library", hidden: true }, [
        el("p", { class: "muted" }, "Library"),
    ]);
    return { root, render() {} };
}
