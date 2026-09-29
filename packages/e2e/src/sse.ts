export interface SseMessage {
  id: string | null;
  event: string;
  data: string;
}

/**
 * Reads a text/event-stream response until `stop` returns true for a message, the stream
 * ends, or the timeout passes. Comment lines such as keepalives are skipped.
 */
export async function readSse(
  url: string,
  stop: (message: SseMessage) => boolean,
  timeoutMs: number,
): Promise<SseMessage[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const messages: SseMessage[] = [];
  try {
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (res.status !== 200 || !res.body) {
      throw new Error(`GET ${url} answered ${res.status}: ${await res.text()}`);
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\n\n");
        const message: SseMessage = { id: null, event: "message", data: "" };
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line === "" || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "event") message.event = value;
          else if (field === "id") message.id = value;
          else if (field === "data") data.push(value);
        }
        if (data.length === 0) continue;
        message.data = data.join("\n");
        messages.push(message);
        if (stop(message)) {
          controller.abort();
          return messages;
        }
      }
    }
    return messages;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `The event stream ${url} did not finish within ${timeoutMs} ms. It sent ${messages.length} events: ${messages.map((m) => m.event).join(", ")}.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
