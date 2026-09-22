import { el } from "../../lib/dom.js";
import { t } from "../../i18n.js";
import { getQueue, onQueueChange } from "../queue.js";
import { queueRow } from "../itemRow.js";

export function createRadio() {
    const body = el("div", { class: "yt-radio-body" });
    const root = el("section", { class: "yt-view yt-view-radio", hidden: true }, [body]);

    function draw() {
        const q = getQueue();
        if (q.source !== "radio") {
            body.replaceChildren(el("p", { class: "muted" }, t("ytmusic.radio.empty")));
            return;
        }
        body.replaceChildren(
            el("h3", {}, t("ytmusic.radio.now_playing")),
            ...q.items.map(queueRow),
        );
    }

    onQueueChange(draw);
    draw();

    return { root, render() {} };
}
