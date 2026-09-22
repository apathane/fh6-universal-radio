import { el } from "../../lib/dom.js";

export function createRadio() {
    const root = el("section", { class: "yt-view yt-view-radio", hidden: true }, [
        el("p", { class: "muted" }, "Radio"),
    ]);
    return { root, render() {} };
}
