import { describe, expect, it } from "vitest";
import { parseOfficialSleepText } from "../official-oauth.js";

describe("official sleep awake minutes", () => {
  it.each([
    ["Awake Time: 21 min", 21],
    ["Awake Time: 1h 21min", 81],
  ])("parses %s", (awakeLine, expected) => {
    const text = `2026-09-09\nSleep Score: 43\nMain Sleep: 4h 40min\n${awakeLine}`;
    const [record] = parseOfficialSleepText(text);
    expect(record.awakeMinutes).toBe(expected);
  });
});
