import { describe, expect, it } from "vitest";
import { PASSAGES } from "../src/passages.js";
import { keywords } from "../src/text/keywords.js";
import { summarize } from "../src/text/summarize.js";
import { countWords, splitSentences, stem } from "../src/text/tokenize.js";

function passage(author: string): string {
  const p = PASSAGES.find((x) => x.author === author);
  if (!p) throw new Error(`no passage by ${author}`);
  return p.text;
}

describe("splitSentences", () => {
  it("keeps abbreviations, initials and decimals inside one sentence", () => {
    const s = splitSentences(
      "Dr. Smith paid 3.5 tUSDC at 9 a.m. on Monday. J. R. Tolkien wrote books, e.g. The Hobbit. Was it paid? Yes!",
    );
    expect(s.map((x) => x.text)).toEqual([
      "Dr. Smith paid 3.5 tUSDC at 9 a.m. on Monday.",
      "J. R. Tolkien wrote books, e.g. The Hobbit.",
      "Was it paid?",
      "Yes!",
    ]);
  });

  it("tracks paragraphs and closing quotes", () => {
    const s = splitSentences(
      'He said "Stop." Then he left.\n\nA new paragraph starts here. It ends.',
    );
    expect(s.map((x) => [x.text, x.paragraph, x.positionInParagraph])).toEqual([
      ['He said "Stop."', 0, 0],
      ["Then he left.", 0, 1],
      ["A new paragraph starts here.", 1, 0],
      ["It ends.", 1, 1],
    ]);
  });

  it("splits the Gettysburg Address into its ten sentences", () => {
    expect(splitSentences(passage("Abraham Lincoln"))).toHaveLength(10);
  });
});

describe("stem", () => {
  it("merges plural and verb forms", () => {
    expect(stem("payments")).toBe(stem("payment"));
    expect(stem("settled")).toBe(stem("settle"));
    expect(stem("settles")).toBe(stem("settle"));
    expect(stem("policies")).toBe("policy");
    expect(stem("agent's")).toBe("agent");
    expect(stem("business")).toBe("business");
  });
});

describe("summarize", () => {
  it("picks the central sentences of the Gettysburg Address in original order", () => {
    const text = passage("Abraham Lincoln");
    const result = summarize(text, { sentences: 3 });
    expect(result.inputSentences).toBe(10);
    expect(result.sentences).toHaveLength(3);
    const indexes = result.sentences.map((s) => s.index);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    // The opening sentence carries the thesis and the position boost.
    expect(result.sentences[0]?.text.startsWith("Four score and seven years ago")).toBe(true);
    expect(result.summary).toBe(result.sentences.map((s) => s.text).join(" "));
    expect(result.inputWords).toBe(countWords(text));
    expect(result.summaryWords).toBe(countWords(result.summary));
    expect(result.compressionRatio).toBeCloseTo(result.summaryWords / result.inputWords, 3);
    expect(result.compressionRatio).toBeLessThan(0.6);
  });

  it("keeps the butcher, brewer and baker line from Adam Smith", () => {
    const result = summarize(passage("Adam Smith"), { sentences: 2 });
    expect(result.summary).toContain("self-love");
    expect(result.sentences).toHaveLength(2);
  });

  it("is deterministic", () => {
    const text = passage("Charles Darwin");
    expect(summarize(text, { sentences: 2 })).toEqual(summarize(text, { sentences: 2 }));
  });

  it("returns every sentence when asked for more than exist", () => {
    const result = summarize("Receipts land on chain. Owners export statements monthly.", {
      sentences: 5,
    });
    expect(result.sentences.map((s) => s.index)).toEqual([0, 1]);
    expect(result.compressionRatio).toBe(1);
  });

  it("skips a sentence that repeats an already chosen one", () => {
    const text =
      "The agent pays the metered API for every request it makes. The agent pays the metered API for every request it makes today. Receipts land on chain for the owner to read later.";
    const result = summarize(text, { sentences: 2 });
    expect(result.sentences.map((s) => s.index)).toEqual([0, 2]);
  });

  it("handles empty input", () => {
    const result = summarize("", { sentences: 3 });
    expect(result).toMatchObject({
      summary: "",
      inputSentences: 0,
      inputWords: 0,
      compressionRatio: 0,
    });
  });
});

describe("keywords", () => {
  it("ranks the recurring themes of Federalist No. 10", () => {
    const result = keywords(passage("James Madison"), { limit: 8 });
    expect(result).toHaveLength(8);
    const phrases = result.map((k) => k.phrase);
    expect(phrases).toContain("popular governments");
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(result[i]?.score ?? 0);
    }
    expect(result.find((k) => k.phrase === "popular governments")?.count).toBe(2);
  });

  it("merges phrases that differ by a plural and never returns stopwords", () => {
    const result = keywords(
      "Rotate the session keys. Revoke a session key. Register the session key.",
      { limit: 5 },
    );
    const session = result.find((k) => k.phrase.startsWith("session key"));
    expect(session?.count).toBe(3);
    expect(result.map((k) => k.phrase)).not.toContain("the");
  });

  it("is deterministic and respects the limit", () => {
    const text = passage("Henry David Thoreau");
    expect(keywords(text, { limit: 3 })).toEqual(keywords(text, { limit: 3 }));
    expect(keywords(text, { limit: 3 })).toHaveLength(3);
  });
});
