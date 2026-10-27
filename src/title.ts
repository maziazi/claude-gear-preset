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
export function transcriptPath(sessionId: string, cwd: string): string {
  const slug = cwd.replace(/[/\\]/g, "-");
  return join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}

/**
 * Pull the text of the first thing the user actually typed.
 *
 * The first prompt is what the session is about; later ones wander. Naming the
 * tab after the newest message would rewrite it mid-conversation, which makes
 * a row of tabs unreadable precisely when there are enough of them to matter.
 */
export function firstUserPrompt(transcript: string): string | null {
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;

    const text = extractText((entry.message as { content?: unknown } | undefined)?.content);
    if (text) return text;
  }
  return null;
}

/** Text of a user entry, or empty when it is not something the user typed. */
function extractText(content: unknown): string {
  let text = "";
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter(
        (block): block is { type: string; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text",
      )
      .map((block) => block.text)
      .join(" ");
  }

  text = text.trim();
  // Tool results and injected reminders arrive as user entries too; they open
  // with a tag and are not what the tab should be named after.
  return text.startsWith("<") ? "" : text;
}

/** Pull the text of the most recent thing the user actually typed. */
export function latestUserPrompt(transcript: string): string | null {
  let latest: string | null = null;

  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;

    const text = extractText((entry.message as { content?: unknown } | undefined)?.content);
    if (text) latest = text;
  }

  return latest;
}

export function formatTitle(preset: string, prompt: string | null): string {
  if (!prompt) return preset;
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
export function startTitleWatcher(
  preset: string,
  sessionId: string,
  cwd: string,
  write: (text: string) => void = (text) => process.stdout.write(text),
): () => void {
  const path = transcriptPath(sessionId, cwd);

  // Settled once the first prompt is in: from then on the tab keeps that name
  // for the rest of the session.
  let title: string | null = null;

  const tick = () => {
    if (title === null) {
      if (!existsSync(path)) return;
      let prompt: string | null;
      try {
        prompt = firstUserPrompt(readFileSync(path, "utf8"));
      } catch {
        return;
      }
      if (!prompt) return;
      title = formatTitle(preset, prompt);
    }

    // Written repeatedly, not once: Claude Code sets its own title at every
    // turn, so a single write would show for a moment and then be replaced.
    write(`\x1b]0;${title}\x07`);
  };

  const timer = setInterval(tick, POLL_MS);
  // Never hold the process open just to rename a tab.
  timer.unref?.();
  return () => clearInterval(timer);
}
