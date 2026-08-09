import { describe, expect, it } from "vitest";
import {
  applyFilter,
  isNormalizable,
  measureFilter,
  parseLoudnorm,
  TARGET_LUFS,
} from "./loudness.js";

const pass1Output = `
ffmpeg version 7.1 Copyright (c) 2000-2024 the FFmpeg developers
  Stream #0:1: Audio: aac, 48000 Hz, stereo
[Parsed_loudnorm_0 @ 0x600001234]
{
	"input_i" : "-23.51",
	"input_tp" : "-5.10",
	"input_lra" : "7.40",
	"input_thresh" : "-33.90",
	"output_i" : "-14.02",
	"target_offset" : "0.40"
}
`;

describe("parseLoudnorm", () => {
  it("reads the measurement out of ffmpeg's noisy stderr", () => {
    expect(parseLoudnorm(pass1Output)).toEqual({
      inputI: -23.51,
      inputTp: -5.1,
      inputLra: 7.4,
      inputThresh: -33.9,
      targetOffset: 0.4,
    });
  });

  it("keeps -inf as -Infinity so digital silence stays detectable", () => {
    const silent = pass1Output.replace('"-23.51"', '"-inf"');
    expect(parseLoudnorm(silent).inputI).toBe(-Infinity);
  });

  it("fails loud when ffmpeg printed no measurement", () => {
    expect(() => parseLoudnorm("ffmpeg version 7.1\nno json here")).toThrow(/no measurement/);
  });

  it("fails loud on malformed JSON rather than guessing", () => {
    expect(() => parseLoudnorm('prefix { "input_i" : }')).toThrow(/malformed/);
  });

  it("fails loud when a required field is missing", () => {
    expect(() => parseLoudnorm('{ "input_i" : "-20.0" }')).toThrow(/missing input_tp/);
  });
});

describe("isNormalizable", () => {
  const base = { inputTp: -5, inputLra: 7, inputThresh: -33, targetOffset: 0 };

  it("accepts ordinary program material", () => {
    expect(isNormalizable({ ...base, inputI: -23.5 })).toBe(true);
  });

  it("rejects digital silence instead of amplifying its noise floor", () => {
    expect(isNormalizable({ ...base, inputI: -Infinity })).toBe(false);
    expect(isNormalizable({ ...base, inputI: -91 })).toBe(false);
  });
});

describe("filters", () => {
  it("targets the streaming loudness standard on both passes", () => {
    expect(measureFilter()).toContain(`I=${TARGET_LUFS}`);
    expect(measureFilter()).toContain("print_format=json");
  });

  it("feeds pass 1's numbers into pass 2 for a linear move", () => {
    const filter = applyFilter(parseLoudnorm(pass1Output));
    expect(filter).toContain("measured_I=-23.51");
    expect(filter).toContain("measured_TP=-5.1");
    expect(filter).toContain("measured_LRA=7.4");
    expect(filter).toContain("measured_thresh=-33.9");
    expect(filter).toContain("offset=0.4");
    expect(filter).toContain("linear=true");
  });
});
