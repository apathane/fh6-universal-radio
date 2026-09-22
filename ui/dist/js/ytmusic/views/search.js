import { el } from "../../lib/dom.js";

export function createSearch() {
    const root = el("section", { class: "yt-view yt-view-search", hidden: true }, [
        el("p", { class: "muted" }, "Search"),
    ]);
    return { root, render() {} };
}
