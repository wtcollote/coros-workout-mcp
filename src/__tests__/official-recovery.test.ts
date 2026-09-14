import { describe, it, expect } from "vitest";
import { parseOfficialRecovery } from "../official-recovery.js";
describe("official recovery", () => {
  it("preserves official percentage and wording", () => {
    const r = parseOfficialRecovery('"Recovery Status\\nRecovery: 91%\\nLevel: Heavy training allowed\\nEstimated Full Recovery: 14h"', "2026-09-10T10:00:00Z");
    expect(r.percentage).toBe(91); expect(r.level).toBe("Heavy training allowed"); expect(r.fullRecovery).toBe("14h");
  });
  it("accepts zero without treating it as missing", () => expect(parseOfficialRecovery("Recovery: 0 %").percentage).toBe(0));
  it("does not create a category", () => expect(parseOfficialRecovery("Recovery: 100%").level).toBeNull());
  it("rejects missing percentage", () => expect(() => parseOfficialRecovery("Level: available")).toThrow());
  it("rejects out of range", () => expect(() => parseOfficialRecovery("Recovery: 101%")).toThrow());
  it("preserves decimal percentage", () => expect(parseOfficialRecovery("Recovery: 91.5%\r\n").percentage).toBe(91.5));
});
