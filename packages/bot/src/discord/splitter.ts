/**
 * Splits Claude's markdown output into Discord-sized chunks without ever
 * breaking a code fence: an open fence is closed at the chunk boundary and
 * reopened (with its language tag) at the start of the next chunk.
 */

export const DISCORD_MESSAGE_LIMIT = 2000;
/** Past this total length the caller should attach a file instead. */
export const ATTACHMENT_THRESHOLD = 6000;
export const MAX_CHUNKS = 4;

export interface SplitResult {
  chunks: string[];
  /** True when the content is better delivered as a .md attachment. */
  asAttachment: boolean;
}

const FENCE_RE = /^\s{0,3}(```+|~~~+)(.*)$/;

type OpenFence = { marker: string; info: string };

/**
 * Advances the open-fence state for one line. A fence closes only with the same
 * character and an equal-or-longer run (CommonMark rule); an unrelated fence
 * line inside an open block is ignored. Shared by splitMessage and closeOpenFences.
 */
function trackFence(open: OpenFence | null, line: string): OpenFence | null {
  const match = line.match(FENCE_RE);
  if (!match) return open;
  const marker = match[1]!;
  if (open && marker[0] === open.marker[0] && marker.length >= open.marker.length) {
    return null;
  }
  if (!open) {
    return { marker, info: match[2] ?? "" };
  }
  return open;
}

/**
 * Closes a dangling code fence at the end of a partial markdown string so a
 * mid-stream preview never renders a broken ``` block. Balanced text is
 * returned unchanged.
 */
export function closeOpenFences(text: string): string {
  let open: OpenFence | null = null;
  for (const line of text.split("\n")) {
    open = trackFence(open, line);
  }
  return open ? `${text}\n${open.marker}` : text;
}

export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): SplitResult {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) {
    return { chunks: [], asAttachment: false };
  }
  if (trimmed.length <= limit) {
    return { chunks: [trimmed], asAttachment: false };
  }

  const chunks: string[] = [];
  let buffer = "";
  // Fence state carried across lines: the exact marker (``` or ~~~) and info string.
  let openFence: OpenFence | null = null;

  const closeLen = () => (openFence ? openFence.marker.length + 1 : 0);

  const flush = () => {
    if (buffer.length === 0) return;
    let chunk = buffer;
    if (openFence) chunk += `\n${openFence.marker}`;
    chunks.push(chunk);
    buffer = openFence ? `${openFence.marker}${openFence.info}` : "";
  };

  const append = (line: string) => {
    const candidate = buffer.length === 0 ? line : `${buffer}\n${line}`;
    if (candidate.length + closeLen() <= limit) {
      buffer = candidate;
      return;
    }
    flush();
    const rejoined = buffer.length === 0 ? line : `${buffer}\n${line}`;
    if (rejoined.length + closeLen() <= limit) {
      buffer = rejoined;
      return;
    }
    // Single line longer than the limit: hard-split it.
    let rest = line;
    while (rest.length > 0) {
      const room = limit - closeLen() - (buffer.length === 0 ? 0 : buffer.length + 1);
      if (room <= 0) {
        flush();
        continue;
      }
      const piece = rest.slice(0, room);
      rest = rest.slice(room);
      buffer = buffer.length === 0 ? piece : `${buffer}\n${piece}`;
      if (rest.length > 0) flush();
    }
  };

  for (const line of trimmed.split("\n")) {
    append(line);
    openFence = trackFence(openFence, line);
  }
  if (buffer.length > 0) {
    let chunk = buffer;
    if (openFence) chunk += `\n${openFence.marker}`;
    chunks.push(chunk);
  }

  const asAttachment = trimmed.length > ATTACHMENT_THRESHOLD || chunks.length > MAX_CHUNKS;
  return { chunks, asAttachment };
}
