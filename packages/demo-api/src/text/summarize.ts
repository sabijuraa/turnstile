import { contentTerms, countWords, type Sentence, splitSentences } from "./tokenize.js";

export interface SummarySentence {
  /** Position of the sentence in the input, from 0. */
  index: number;
  text: string;
  /** Relevance score, higher is more central. Rounded to 4 decimals. */
  score: number;
}

export interface Summary {
  summary: string;
  sentences: SummarySentence[];
  inputSentences: number;
  inputWords: number;
  summaryWords: number;
  /** Summary words divided by input words, rounded to 3 decimals. */
  compressionRatio: number;
}

export interface SummarizeOptions {
  /** How many sentences to keep. Default 3. */
  sentences?: number;
}

/** Sentences above this similarity to an already chosen sentence are skipped as repeats. */
const REDUNDANCY_THRESHOLD = 0.6;
const IDEAL_MIN_WORDS = 8;
const IDEAL_MAX_WORDS = 35;

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Term weight is normalized frequency times inverse sentence frequency. */
function termWeights(terms: string[][]): Map<string, number> {
  const tf = new Map<string, number>();
  const sf = new Map<string, number>();
  for (const sentence of terms) {
    for (const t of sentence) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of new Set(sentence)) sf.set(t, (sf.get(t) ?? 0) + 1);
  }
  let maxTf = 1;
  for (const v of tf.values()) maxTf = Math.max(maxTf, v);
  const n = terms.length;
  const weights = new Map<string, number>();
  for (const [t, f] of tf) {
    const isf = Math.log(1 + n / (sf.get(t) ?? 1));
    // A term seen once says little about the topic, so it counts at half strength.
    const repeat = f > 1 ? 1 : 0.5;
    weights.set(t, (f / maxTf) * isf * repeat);
  }
  return weights;
}

/** Rewards sentences near the start of the text and of each paragraph. */
function positionFactor(s: Sentence, total: number): number {
  let factor = 1 + 0.15 * (1 - s.index / Math.max(1, total));
  if (s.index === 0) factor += 0.2;
  else if (s.positionInParagraph === 0) factor += 0.1;
  return factor;
}

/** Full weight inside the ideal length band, tapering outside it. */
function lengthFactor(wordCount: number): number {
  if (wordCount < 4) return 0.3;
  if (wordCount < IDEAL_MIN_WORDS) return 0.6 + (0.4 * (wordCount - 4)) / (IDEAL_MIN_WORDS - 4);
  if (wordCount <= IDEAL_MAX_WORDS) return 1;
  return Math.max(0.5, IDEAL_MAX_WORDS / wordCount);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Extractive summary. Scores each sentence by the weight of its content terms, its position
 * and its length, picks the best ones while skipping near repeats, and returns them in their
 * original order. Deterministic for a given input.
 */
export function summarize(text: string, options: SummarizeOptions = {}): Summary {
  const wanted = Math.max(1, Math.floor(options.sentences ?? 3));
  const sentences = splitSentences(text);
  const inputWords = countWords(text);
  const terms = sentences.map((s) => contentTerms(s.text));
  const weights = termWeights(terms);

  const scored = sentences.map((s, i) => {
    const sentenceTerms = terms[i] ?? [];
    let sum = 0;
    for (const t of sentenceTerms) sum += weights.get(t) ?? 0;
    // Square root normalization keeps long sentences from winning on length alone.
    const density = sentenceTerms.length > 0 ? sum / Math.sqrt(sentenceTerms.length) : 0;
    const score = density * positionFactor(s, sentences.length) * lengthFactor(countWords(s.text));
    return { sentence: s, score, terms: new Set(sentenceTerms) };
  });

  const ranked = [...scored].sort(
    (a, b) => b.score - a.score || a.sentence.index - b.sentence.index,
  );
  const chosen: typeof scored = [];
  for (const candidate of ranked) {
    if (chosen.length >= wanted) break;
    if (chosen.some((c) => jaccard(c.terms, candidate.terms) > REDUNDANCY_THRESHOLD)) continue;
    chosen.push(candidate);
  }
  chosen.sort((a, b) => a.sentence.index - b.sentence.index);

  const summaryText = chosen.map((c) => c.sentence.text).join(" ");
  const summaryWords = countWords(summaryText);
  return {
    summary: summaryText,
    sentences: chosen.map((c) => ({
      index: c.sentence.index,
      text: c.sentence.text,
      score: round(c.score, 4),
    })),
    inputSentences: sentences.length,
    inputWords,
    summaryWords,
    compressionRatio: inputWords > 0 ? round(summaryWords / inputWords, 3) : 0,
  };
}
