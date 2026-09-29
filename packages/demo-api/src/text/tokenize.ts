import { isStopword } from "./stopwords.js";

/** Abbreviations that end with a period but do not end a sentence. Lowercase, no period. */
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "mt",
  "gen",
  "col",
  "capt",
  "lt",
  "sgt",
  "rev",
  "hon",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "cf",
  "no",
  "vol",
  "fig",
  "inc",
  "ltd",
  "co",
  "corp",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "u.s",
  "u.k",
  "a.m",
  "p.m",
]);

export interface Sentence {
  /** Position in the whole text, from 0. */
  index: number;
  /** Paragraph the sentence belongs to, from 0. */
  paragraph: number;
  /** Position inside its paragraph, from 0. */
  positionInParagraph: number;
  text: string;
}

/** Collapses runs of spaces and tabs, keeps blank lines as paragraph breaks. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function endsWithAbbreviation(chunk: string): boolean {
  const match = /([A-Za-z](?:\.[A-Za-z])*|[A-Za-z]+)\.$/.exec(chunk);
  if (!match?.[1]) return false;
  const word = match[1].toLowerCase();
  // A single capital letter followed by a period is an initial, as in "J. Smith".
  if (/^[a-z]$/.test(word) && /(^|\s)[A-Z]\.$/.test(chunk)) return true;
  return ABBREVIATIONS.has(word);
}

/** Splits one paragraph into sentences. Handles quotes, brackets, ellipses and abbreviations. */
function splitParagraph(paragraph: string): string[] {
  const text = paragraph.replace(/\n/g, " ");
  const out: string[] = [];
  // A candidate boundary is terminal punctuation, optional closing quotes or brackets, then
  // whitespace, then something that can start a sentence.
  const boundary = /[.!?]+["')\]]*(?=\s+["'([]?[A-Z0-9])/g;
  let start = 0;
  for (let m = boundary.exec(text); m !== null; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    const chunk = text.slice(start, end).trim();
    if (m[0] === "." && endsWithAbbreviation(chunk)) continue;
    if (chunk) out.push(chunk);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

export function splitSentences(text: string): Sentence[] {
  const paragraphs = normalizeText(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const sentences: Sentence[] = [];
  paragraphs.forEach((p, paragraph) => {
    splitParagraph(p).forEach((s, positionInParagraph) => {
      sentences.push({ index: sentences.length, paragraph, positionInParagraph, text: s });
    });
  });
  return sentences;
}

/** Lowercase word tokens. Apostrophes inside words are kept, as in "don't". */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+(?:['’][a-z]+)*/g)) out.push(m[0]);
  return out;
}

export function countWords(text: string): number {
  return words(text).length;
}

/**
 * A light suffix stripper so that "agents", "agent's" and "agent" share one term, and
 * "payments" and "payment" too. Deliberately conservative to stay readable and predictable.
 */
export function stem(word: string): string {
  let w = word.replace(/'s$/, "").replace(/'$/, "");
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    w = w.slice(0, -1);
  }
  if (w.endsWith("ing") && w.length > 6) return w.slice(0, -3);
  if (w.endsWith("edly") && w.length > 7) return w.slice(0, -4);
  if (w.endsWith("ed") && w.length > 5 && !w.endsWith("eed")) return w.slice(0, -2);
  // "settle", "settles" and "settled" all end up as "settl".
  if (w.endsWith("e") && w.length > 4 && !w.endsWith("ee")) return w.slice(0, -1);
  return w;
}

/** A word that carries meaning: not a stopword, not a bare number, at least two letters. */
export function isContentWord(word: string): boolean {
  return word.length > 1 && !isStopword(word) && !/^\d+$/.test(word);
}

/** Stems of the content words of a text, in order. */
export function contentTerms(text: string): string[] {
  return words(text).filter(isContentWord).map(stem);
}
