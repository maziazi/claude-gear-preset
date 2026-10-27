import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** How often the transcript is re-read while a session is running. */
const POLL_MS = 1000;
/** Keeps the tab label readable in a narrow terminal. */
const MAX_TOPIC = 40;
/**
 * Where Claude Code writes a session's transcript.
 *
 * The directory is the working directory with separators replaced, which is
 * how Claude Code namespaces projects.
 */
export function transcriptPath(sessionId, cwd) {
    const slug = cwd.replace(/[/\\]/g, "-");
    return join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}
/** Pull the text of the most recent thing the user actually typed. */
export function latestUserPrompt(transcript) {
    let latest = null;
    for (const line of transcript.split("\n")) {
        if (!line.trim())
            continue;
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (entry.type !== "user")
            continue;
        const message = entry.message;
        const content = message?.content;
        let text = "";
        if (typeof content === "string") {
            text = content;
        }
        else if (Array.isArray(content)) {
            text = content
                .filter((block) => typeof block === "object" &&
                block !== null &&
                block.type === "text")
                .map((block) => block.text)
                .join(" ");
        }
        text = text.trim();
        // Tool results and injected reminders arrive as user entries too; they
        // open with a tag and are not what the tab should be named after.
        if (!text || text.startsWith("<"))
            continue;
        latest = text;
    }
    return latest;
}
export function formatTitle(preset, prompt) {
    if (!prompt)
        return preset;
    const topic = prompt.replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC);
    return topic ? `${preset} - ${topic}` : preset;
}
/**
 * Keep the terminal tab named after what the session is about.
 *
 * A Claude Code hook cannot do this: hooks run detached, with `/dev/tty`
 * unavailable and stdout piped back to Claude. ccgear's own process still
 * holds the terminal, so it watches the transcript and writes the title
 * itself. OSC 0 only renames the window, so interleaving it with Claude's
 * interface is safe.
 */
export function startTitleWatcher(preset, sessionId, cwd, write = (text) => process.stdout.write(text)) {
    const path = transcriptPath(sessionId, cwd);
    let lastTitle = "";
    const tick = () => {
        if (!existsSync(path))
            return;
        let title;
        try {
            title = formatTitle(preset, latestUserPrompt(readFileSync(path, "utf8")));
        }
        catch {
            return;
        }
        if (title === lastTitle)
            return;
        lastTitle = title;
        write(`\x1b]0;${title}\x07`);
    };
    const timer = setInterval(tick, POLL_MS);
    // Never hold the process open just to rename a tab.
    timer.unref?.();
    return () => clearInterval(timer);
}
