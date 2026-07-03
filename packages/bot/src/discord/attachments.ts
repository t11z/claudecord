import type { Attachment, Collection } from "discord.js";

const MAX_TEXT_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|yaml|yml|toml|csv|tsv|xml|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|sh|bash|zsh|sql|log|ini|cfg|conf|env|diff|patch)$/i;

export interface PreparedPrompt {
  /** String prompt, or an SDK streaming-input iterable when images are included. */
  prompt: string | AsyncIterable<unknown>;
  /** Notes about skipped attachments, to surface to the user. */
  skipped: string[];
}

interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

function isTextAttachment(a: Attachment): boolean {
  if (a.contentType?.startsWith("text/")) return true;
  if (a.contentType === "application/json") return true;
  return TEXT_EXTENSIONS.test(a.name ?? "");
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Turns a Discord message (text + attachments) into an Agent SDK prompt.
 * Text files are inlined as fenced blocks; images become base64 content
 * blocks, which requires the SDK's streaming input format.
 */
export async function buildPrompt(
  text: string,
  attachments: Collection<string, Attachment>,
): Promise<PreparedPrompt> {
  const skipped: string[] = [];
  const textParts: string[] = [text];
  const imageBlocks: ImageBlock[] = [];

  for (const attachment of attachments.values()) {
    const name = attachment.name ?? "attachment";
    try {
      if (attachment.contentType && IMAGE_TYPES.has(attachment.contentType)) {
        if (attachment.size > MAX_IMAGE_BYTES) {
          skipped.push(`${name} (image too large, max 5 MB)`);
          continue;
        }
        const buffer = await fetchBuffer(attachment.url);
        imageBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.contentType,
            data: buffer.toString("base64"),
          },
        });
      } else if (isTextAttachment(attachment)) {
        if (attachment.size > MAX_TEXT_BYTES) {
          skipped.push(`${name} (text file too large, max 256 KB)`);
          continue;
        }
        const buffer = await fetchBuffer(attachment.url);
        textParts.push(
          `\n\nAttached file \`${name}\`:\n\`\`\`\n${buffer.toString("utf8")}\n\`\`\``,
        );
      } else {
        skipped.push(`${name} (unsupported type)`);
      }
    } catch {
      skipped.push(`${name} (could not download)`);
    }
  }

  const combinedText = textParts.join("");

  if (imageBlocks.length === 0) {
    return { prompt: combinedText, skipped };
  }

  const content: unknown[] = [...imageBlocks, { type: "text", text: combinedText }];
  async function* stream(): AsyncGenerator<unknown> {
    yield {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: "",
    };
  }
  return { prompt: stream(), skipped };
}
