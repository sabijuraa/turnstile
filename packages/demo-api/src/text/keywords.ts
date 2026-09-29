import { isStopword } from "./stopwords.js";
import { stem, words } from "./tokenize.js";

export interface Keyphrase {
  phrase: string;
  /** Relevance score, higher is better. Rounded to 4 decimals. */
  score: number;
  /** How many times the phrase appears. */
  count: number;
}

export interface KeywordsOptions {
  /** How many phrases to return. Default 10. */
  limit?: number;
}

const MAX_PHRASE_WORDS = 4;

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function usable(word: string): boolean {
  return word.length > 2 && !isStopword(word) && !/^\d+$/.test(word);
}

/** Candidate phrases are runs of content words between stopwords and punctuation. */
function candidates(text: string): string[][] {
  const out: string[][] = [];
  for (const fragment of text.split(/[.,;:!?()[\]{}"—–\n]+|\s-\s/)) {
    let run: string[] = [];
    for (const w of words(fragment)) {
      if (usable(w)) {
        run.push(w);
        continue;
      }
      if (run.length > 0) out.push(run);
      run = [];
    }
    if (run.length > 0) out.push(run);
  }
  // Split long runs into windows so one run-on list does not become a single phrase.
  const bounded: string[][] = [];
  for (const run of out) {
    for (let i = 0; i < run.length; i += MAX_PHRASE_WORDS) {
      bounded.push(run.slice(i, i + MAX_PHRASE_WORDS));
    }
  }
  return bounded;
}

/**
 * Ranked keyphrases with the RAKE method. A word scores its co-occurrence degree over its
 * frequency. A phrase scores the sum of its words, scaled by how often it repeats.
 * Phrases that differ only by plural or suffix are merged. Deterministic for a given input.
 */
export function keywords(text: string, options: KeywordsOptions = {}): Keyphrase[] {
  const limit = Math.max(1, Math.floor(options.limit ?? 10));
  const phrases = candidates(text);
  const freq = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const phrase of phrases) {
    for (const w of phrase) {
      const s = stem(w);
      freq.set(s, (freq.get(s) ?? 0) + 1);
      degree.set(s, (degree.get(s) ?? 0) + phrase.length - 1);
    }
  }
  const wordScore = (s: string): number =>
    ((degree.get(s) ?? 0) + (freq.get(s) ?? 0)) / (freq.get(s) ?? 1);

  interface Entry {
    key: string;
    score: number;
    count: number;
    first: number;
    forms: Map<string, number>;
  }
  const merged = new Map<string, Entry>();
  phrases.forEach((phrase, position) => {
    const stems = phrase.map(stem);
    const key = stems.join(" ");
    const surface = phrase.join(" ");
    const entry = merged.get(key);
    if (entry) {
      entry.count++;
      entry.forms.set(surface, (entry.forms.get(surface) ?? 0) + 1);
      return;
    }
    let score = 0;
    for (const s of stems) score += wordScore(s);
    merged.set(key, { key, score, count: 1, first: position, forms: new Map([[surface, 1]]) });
  });

  const ranked = [...merged.values()]
    .map((e) => ({ ...e, score: e.score * (1 + Math.log(e.count)) }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.first - b.first);

  return ranked.slice(0, limit).map((e) => {
    // Show the spelling used most often, and the earliest one on a tie.
    let best = "";
    let bestCount = 0;
    for (const [form, count] of e.forms) {
      if (count > bestCount) {
        best = form;
        bestCount = count;
      }
    }
    return { phrase: best, score: round(e.score, 4), count: e.count };
  });
}
