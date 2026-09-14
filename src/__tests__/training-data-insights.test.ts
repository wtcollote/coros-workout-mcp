import { describe, expect, it } from "vitest";
import { dataQualityReport } from "../providers/training-data-insights.js";
describe("final universal toolkit",()=>{ it("exports toolkit function",()=>{ expect(typeof dataQualityReport).toBe("function"); }); });
