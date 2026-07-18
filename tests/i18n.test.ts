import { describe, expect, it } from "vitest";
import { COPY } from "../src/i18n";

describe("PT-BR-first copy", () => {
  it("keeps both languages structurally complete and non-causal", () => {
    expect(Object.keys(COPY["pt-BR"])).toEqual(Object.keys(COPY.en));
    expect(Object.keys(COPY["pt-BR"].actions)).toEqual(Object.keys(COPY.en.actions));
    expect(Object.keys(COPY["pt-BR"].proof)).toEqual(Object.keys(COPY.en.proof));
    expect(COPY["pt-BR"].coincided).toContain("coincidiu");
    expect(COPY.en.coincided).toContain("coincided");
    expect(COPY["pt-BR"].nonCausal).toContain("sinal opaco");
    expect(COPY.en.nonCausal).toContain("opaque signal");
    expect(JSON.stringify(COPY).toLowerCase()).not.toContain("caused");
  });
});
