export interface OfficialRecovery {
  source: "COROS official OAuth";
  percentage: number;
  level: string | null;
  fullRecovery: string | null;
  observedAt: string;
}

export function parseOfficialRecovery(text: string, observedAt = new Date().toISOString()): OfficialRecovery {
  let value = text.trim();
  for (let i = 0; i < 2 && value.startsWith('"'); i++) {
    try { const decoded = JSON.parse(value); if (typeof decoded !== "string") break; value = decoded; } catch { break; }
  }
  const match = value.match(/^Recovery:\s*(\d+(?:\.\d+)?)\s*%\s*$/im);
  const percentage = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw new Error("Official recovery unavailable.");
  const field = (name: string) => value.match(new RegExp(`^${name}:[ \\t]*([^\\r\\n]+)`, "im"))?.[1]?.trim() || null;
  return { source: "COROS official OAuth", percentage, level: field("Level"), fullRecovery: field("Estimated Full Recovery"), observedAt };
}
