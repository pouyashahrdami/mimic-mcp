import { describe, expect, it } from "vitest";
import {
  buildKeepRanges,
  captionsFromWords,
  findDisfluencies,
  findPhrase,
  normalizeWord,
  planCuts,
  remapTime,
  remapWords,
  trimmedDuration,
  type TimedWord,
} from "./transcript-edit.js";

/** Words on a 0.5s grid: "the quick brown fox" -> 0, 0.5, 1.0, 1.5. */
function say(text: string, { from = 0, each = 0.5, gap = 0 } = {}): TimedWord[] {
  return text.split(" ").map((word, i) => ({
    word,
    start: Math.round((from + i * (each + gap)) * 100) / 100,
    end: Math.round((from + i * (each + gap) + each) * 100) / 100,
  }));
}

describe("normalizeWord", () => {
  it("strips the punctuation whisper attaches and lowercases", () => {
    expect(normalizeWord("Um,")).toBe("um");
    expect(normalizeWord("know.")).toBe("know");
    expect(normalizeWord("don't")).toBe("don't");
  });

  it("keeps letters from other scripts", () => {
    expect(normalizeWord("Café,")).toBe("café");
  });
});

describe("findDisfluencies", () => {
  it("finds non-words wherever they sit, punctuation and all", () => {
    const words = say("so Um, I uh built this");
    const found = findDisfluencies(words);
    expect(found.map((f) => f.text)).toEqual(["Um,", "uh"]);
    expect(found[0].reason).toBe("disfluency");
  });

  it("leaves real words alone", () => {
    expect(findDisfluencies(say("I like this a lot"))).toEqual([]);
  });
});

describe("findPhrase", () => {
  it("matches across word boundaries", () => {
    const words = say("and you know it works");
    const [span] = findPhrase(words, "you know");
    expect(span.start).toBe(words[1].start);
    expect(span.end).toBe(words[2].end);
    expect(span.text).toBe("you know");
  });

  it("finds every occurrence", () => {
    expect(findPhrase(say("go now and go now"), "go now")).toHaveLength(2);
  });

  it("does not let one match's tail begin the next", () => {
    // "no no no" contains "no no" twice by naive scanning; they overlap.
    expect(findPhrase(say("no no no"), "no no")).toHaveLength(1);
  });

  it("ignores a phrase that isn't there", () => {
    expect(findPhrase(say("all good here"), "not present")).toEqual([]);
    expect(findPhrase(say("all good here"), "   ")).toEqual([]);
  });
});

describe("planCuts", () => {
  it("cuts disfluencies by default and leaves crutch words in", () => {
    const words = say("um I basically like it");
    const cuts = planCuts(words);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].reason).toBe("disfluency");
  });

  it("cuts crutch words only when asked", () => {
    const words = say("I basically ship it, you know");
    expect(planCuts(words)).toEqual([]);

    const cuts = planCuts(words, { removeCrutchWords: true });
    expect(cuts.map((c) => c.text)).toEqual(["basically", "you know"]);
  });

  it("can be told to leave even the disfluencies", () => {
    expect(planCuts(say("um ok"), { removeDisfluencies: false })).toEqual([]);
  });

  it("cuts an explicit phrase", () => {
    const cuts = planCuts(say("keep this drop that keep this"), {
      removePhrases: ["drop that"],
    });
    expect(cuts).toHaveLength(1);
    expect(cuts[0].text).toBe("drop that");
  });

  it("merges cuts that touch instead of emitting both", () => {
    // "um uh" back to back: two spans that abut, one cut.
    const cuts = planCuts(say("um uh yes"));
    expect(cuts).toHaveLength(1);
    expect(cuts[0].start).toBe(0);
    expect(cuts[0].end).toBe(1);
  });

  it("returns cuts in time order", () => {
    const words = say("um one two you know three uh four");
    const cuts = planCuts(words, { removeCrutchWords: true });
    const starts = cuts.map((c) => c.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("buildKeepRanges", () => {
  it("keeps the whole clip when nothing is cut", () => {
    expect(buildKeepRanges([], 10)).toEqual([{ start: 0, end: 10, outStart: 0 }]);
  });

  it("splits around a cut and stacks the second range against the first", () => {
    const cuts = planCuts(say("one um two", { each: 1 }));
    const keeps = buildKeepRanges(cuts, 3, 0);
    expect(keeps).toEqual([
      { start: 0, end: 1, outStart: 0 },
      { start: 2, end: 3, outStart: 1 },
    ]);
    expect(trimmedDuration(keeps)).toBe(2);
  });

  it("leaves a margin of the cut in place so neighbours aren't clipped", () => {
    const cuts = planCuts(say("one um two", { each: 1 }));
    const keeps = buildKeepRanges(cuts, 3, 0.05);
    expect(keeps[0].end).toBeCloseTo(1.05, 3);
    expect(keeps[1].start).toBeCloseTo(1.95, 3);
  });

  it("skips a cut too short to be worth making", () => {
    const cuts = [{ start: 1, end: 1.02, reason: "phrase" as const, text: "x" }];
    expect(buildKeepRanges(cuts, 3, 0)).toEqual([{ start: 0, end: 3, outStart: 0 }]);
  });

  it("drops a keep sliver rather than leaving a click", () => {
    const cuts = [
      { start: 0, end: 1, reason: "phrase" as const, text: "a" },
      { start: 1.02, end: 2, reason: "phrase" as const, text: "b" },
    ];
    const keeps = buildKeepRanges(cuts, 3, 0);
    expect(keeps).toEqual([{ start: 2, end: 3, outStart: 0 }]);
  });

  it("handles a cut running to the very end", () => {
    const cuts = [{ start: 2, end: 3, reason: "phrase" as const, text: "tail" }];
    expect(buildKeepRanges(cuts, 3, 0)).toEqual([{ start: 0, end: 2, outStart: 0 }]);
  });
});

describe("remapTime", () => {
  const keeps = [
    { start: 0, end: 1, outStart: 0 },
    { start: 2, end: 3, outStart: 1 },
  ];

  it("leaves a time in the first range where it was", () => {
    expect(remapTime(keeps, 0.4)).toBe(0.4);
  });

  it("pulls a later time back by everything cut before it", () => {
    expect(remapTime(keeps, 2.5)).toBe(1.5);
  });

  it("returns null for a time that was cut out", () => {
    expect(remapTime(keeps, 1.5)).toBeNull();
  });

  it("puts a boundary time in the range that contains it", () => {
    expect(remapTime(keeps, 2)).toBe(1);
    expect(remapTime(keeps, 1)).toBeNull();
  });
});

describe("remapWords", () => {
  it("drops the cut words and re-times the survivors", () => {
    const words = say("one um two", { each: 1 });
    const keeps = buildKeepRanges(planCuts(words), 3, 0);
    const remapped = remapWords(keeps, words);

    expect(remapped.map((w) => w.word)).toEqual(["one", "two"]);
    expect(remapped[0].start).toBe(0);
    expect(remapped[1].start).toBe(1);
  });

  it("keeps a word's own length when its end fell inside a cut", () => {
    const words: TimedWord[] = [{ word: "straddle", start: 0.5, end: 1.5 }];
    const keeps = [{ start: 0, end: 1, outStart: 0 }];
    const [remapped] = remapWords(keeps, words);
    expect(remapped.start).toBe(0.5);
    expect(remapped.end).toBe(1.5);
  });

  it("returns nothing when everything was cut", () => {
    expect(remapWords([], say("all gone"))).toEqual([]);
  });

  it("drops a cut word even though the margin left its edges in the clip", () => {
    // The margin shrinks each cut so neighbouring words aren't clipped, which
    // leaves the filler's own start inside a kept range. Passing the cuts is
    // what keeps it out of the captions.
    const words = say("one um two", { each: 1 });
    const cuts = planCuts(words);
    const keeps = buildKeepRanges(cuts, 3, 0.3);

    expect(remapWords(keeps, words).map((w) => w.word)).toContain("um");
    expect(remapWords(keeps, words, cuts).map((w) => w.word)).toEqual(["one", "two"]);
  });
});

describe("captionsFromWords", () => {
  it("returns nothing for no speech", () => {
    expect(captionsFromWords([])).toEqual([]);
  });

  it("keeps a short line as one segment with word-relative timings", () => {
    const words = say("three short words", { each: 0.4 });
    const [segment] = captionsFromWords(words);
    expect(segment.caption).toBe("three short words");
    expect(segment.wordTimings[0]).toBe(0);
    expect(segment.wordTimings).toHaveLength(3);
  });

  it("splits a long take into several readable lines", () => {
    const words = say(
      "one two three four five six seven eight nine ten eleven twelve",
      { each: 0.4 }
    );
    const segments = captionsFromWords(words);
    expect(segments.length).toBeGreaterThan(1);
    // Every word survives the split, in order and exactly once.
    expect(segments.flatMap((s) => s.caption.split(" "))).toEqual(
      words.map((w) => w.word)
    );
  });

  it("breaks the line at a real pause", () => {
    const before = say("before the pause", { each: 0.3 });
    const after = say("after the pause", { from: 4, each: 0.3 });
    const segments = captionsFromWords([...before, ...after]);
    expect(segments[0].caption).toBe("before the pause");
    expect(segments[1].caption).toBe("after the pause");
  });

  it("times every segment against its own start", () => {
    const words = say("a b c d e f g h i j", { each: 0.4 });
    for (const segment of captionsFromWords(words)) {
      expect(segment.wordTimings[0]).toBe(0);
      expect(segment.start).toBeLessThan(segment.end);
    }
  });
});
