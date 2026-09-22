import { el } from "../../lib/dom.js";

export function createHome() {
    const root = el("section", { class: "yt-view yt-view-home", hidden: true }, [
        el("p", { class: "muted" }, "Home"),
    ]);
    return { root, render() {} };
}
