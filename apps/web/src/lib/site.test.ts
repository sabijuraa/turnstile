import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allChromeRoutes, isActivePath } from "./site";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

describe("chrome links", () => {
  it.each(allChromeRoutes())("%s has a page", (href) => {
    const file = href === "/" ? `${appDir}/page.tsx` : `${appDir}${href}/page.tsx`;
    expect(existsSync(file), file).toBe(true);
  });
});

describe("isActivePath", () => {
  it("marks a section active on its child pages", () => {
    expect(isActivePath("/docs/quickstart", "/docs")).toBe(true);
    expect(isActivePath("/docsearch", "/docs")).toBe(false);
    expect(isActivePath("/pricing", "/")).toBe(false);
  });
});
