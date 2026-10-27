import { stdin, stdout } from "node:process";

const ESC = "\x1b";
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;

/** Most items shown at once; longer lists scroll within this window. */
const VIEWPORT = 12;

export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

/**
 * Split one stdin chunk into individual keys.
 *
 * A terminal does not guarantee one keypress per `data` event — pasted text,
 * fast typing, and some pseudo-terminals deliver several at once. Comparing a
 * whole chunk against `"\r"` therefore misses the Enter inside `"hello\r"`.
 */
export function parseKeys(chunk: string): string[] {
  const keys: string[] = [];

  for (let i = 0; i < chunk.length; ) {
    if (chunk[i] === ESC) {
      // CSI sequence: ESC [ … final byte in @–~.
      if (chunk[i + 1] === "[") {
        let end = i + 2;
        while (end < chunk.length && !/[@-~]/.test(chunk[end])) end++;
        keys.push(chunk.slice(i, end + 1));
        i = end + 1;
        continue;
      }
      // Bare ESC or a two-byte sequence we do not act on.
      keys.push(chunk.slice(i, i + 2));
      i += 2;
      continue;
    }

    keys.push(chunk[i]);
    i++;
  }

  return keys;
}

export interface AskTextOptions {
  fallback?: string;
  input?: PromptInput;
  output?: PromptOutput;
  onCancel?: () => void;
}

/**
 * Single-line text input.
 *
 * Deliberately hand-rolled on raw mode rather than `readline`: a readline
 * interface leaves stdin in a state where a following raw-mode prompt stops
 * receiving data, so the checkbox list after this one would silently ignore
 * every keypress.
 */
export async function askText(
  question: string,
  options: AskTextOptions = {},
): Promise<string> {
  const input = options.input ?? (stdin as unknown as PromptInput);
  const output = options.output ?? (stdout as unknown as PromptOutput);
  const fallback = options.fallback ?? "";

  let value = "";
  output.write(`${question} `);

  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve) => {
    const restore = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
    };

    const onData = (data: Buffer) => {
      for (const key of parseKeys(data.toString())) {
        if (key === "\r" || key === "\n") {
          restore();
          output.write("\n");
          resolve(value.trim() || fallback);
          return;
        }

        if (key === "\x03") {
          restore();
          output.write("\nCancelled.\n");
          (options.onCancel ?? (() => process.exit(130)))();
          return;
        }

        if (key === "\x7f" || key === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }

        // Ignore escape sequences and other control bytes.
        if (key.startsWith(ESC) || key < " ") continue;

        value += key;
        output.write(key);
      }
    };

    input.on("data", onData);
  });
}

/** Minimal shape of the streams the prompt drives, so tests can supply fakes. */
export interface PromptInput {
  isRaw?: boolean;
  setRawMode(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (data: Buffer) => void): unknown;
  off(event: "data", listener: (data: Buffer) => void): unknown;
}

export interface PromptOutput {
  write(chunk: string): unknown;
}

export interface MultiSelectOptions {
  title: string;
  choices: string[];
  /** Entries checked when the prompt opens. */
  selected?: string[];
  input?: PromptInput;
  output?: PromptOutput;
  /** Called instead of exiting the process, so tests can observe a cancel. */
  onCancel?: () => void;
}

/**
 * Checkbox list driven by arrow keys, space, and enter.
 *
 * Written against raw stdin rather than a prompt library to keep the install
 * dependency-free; the trade-off is that the terminal state has to be restored
 * by hand on every exit path.
 */
export async function multiSelect(options: MultiSelectOptions): Promise<string[]> {
  const { title, choices } = options;
  if (choices.length === 0) return [];

  const input = options.input ?? (stdin as unknown as PromptInput);
  const output = options.output ?? (stdout as unknown as PromptOutput);
  const chosen = new Set(options.selected ?? []);
  let cursor = 0;
  let offset = 0;
  let painted = 0;

  const render = () => {
    if (painted > 0) output.write(`${ESC}[${painted}A`);

    const lines: string[] = [];
    lines.push(`${title}  (${chosen.size} selected)`);
    lines.push("  ↑↓ move · space toggle · a all · n none · enter confirm");

    if (cursor < offset) offset = cursor;
    if (cursor >= offset + VIEWPORT) offset = cursor - VIEWPORT + 1;
    const visible = choices.slice(offset, offset + VIEWPORT);

    for (const [index, choice] of visible.entries()) {
      const actual = offset + index;
      const pointer = actual === cursor ? ">" : " ";
      const box = chosen.has(choice) ? "[x]" : "[ ]";
      lines.push(`${pointer} ${box} ${choice}`);
    }

    const hidden = choices.length - (offset + visible.length);
    lines.push(hidden > 0 ? `  … ${hidden} more` : "");

    output.write(lines.map((line) => `${CLEAR_LINE}${line}`).join("\n") + "\n");
    painted = lines.length;
  };

  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  output.write(HIDE_CURSOR);
  render();

  return new Promise<string[]>((resolve) => {
    const restore = () => {
      input.off("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write(SHOW_CURSOR);
    };

    const onData = (data: Buffer) => {
      let dirty = false;

      for (const key of parseKeys(data.toString())) {
        switch (key) {
          case `${ESC}[A`:
          case "k":
            cursor = (cursor - 1 + choices.length) % choices.length;
            break;
          case `${ESC}[B`:
          case "j":
            cursor = (cursor + 1) % choices.length;
            break;
          case " ": {
            const choice = choices[cursor];
            if (chosen.has(choice)) chosen.delete(choice);
            else chosen.add(choice);
            break;
          }
          case "a":
            for (const choice of choices) chosen.add(choice);
            break;
          case "n":
            chosen.clear();
            break;
          case "\r":
          case "\n":
            if (dirty) render();
            restore();
            resolve(choices.filter((choice) => chosen.has(choice)));
            return;
          case "\x03": // Ctrl+C
            restore();
            output.write("\nCancelled.\n");
            (options.onCancel ?? (() => process.exit(130)))();
            return;
          default:
            continue;
        }
        dirty = true;
      }

      if (dirty) render();
    };

    input.on("data", onData);
  });
}
