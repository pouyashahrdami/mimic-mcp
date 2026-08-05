import { describe, expect, it } from "vitest";
import { parseStudioUrl } from "./tools/open-in-studio.js";

describe("parseStudioUrl", () => {
  it("finds the local server URL in Remotion Studio's banner", () => {
    expect(
      parseStudioUrl("Server ready - Local: http://localhost:3000, Network: http://192.168.1.5:3000\n")
    ).toBe("http://localhost:3000");
  });

  it("ignores docs links that appear before the server URL", () => {
    expect(
      parseStudioUrl("Read more at https://www.remotion.dev/docs/zod-types/\nbundling...")
    ).toBeNull();
    expect(
      parseStudioUrl(
        "Read more at https://www.remotion.dev/docs/zod-types/\nServer ready - Local: http://localhost:3001"
      )
    ).toBe("http://localhost:3001");
  });

  it("strips trailing punctuation", () => {
    expect(parseStudioUrl("open (http://localhost:3123).")).toBe("http://localhost:3123");
  });

  it("returns null when no URL has appeared yet", () => {
    expect(parseStudioUrl("bundling 42%...")).toBeNull();
  });
});
