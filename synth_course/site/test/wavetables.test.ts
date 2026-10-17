import { describe, expect, it } from "vitest";
import { buildMipTables, buildTable, harmonicsForFreq, harmonicsForLevel, mipLevelForFreq, TABLE_PEAK } from "@/playgrounds/shared/wavetables";

const saw = Array.from({ length: 32 }, (_, h) => 1 / (h + 1));

describe("wavetables", () => {
  it("band-limits each octave against its top edge (same counts as notebook 07)", () => {
    expect(harmonicsForLevel(3, 1000)).toBe(17); // 640–1280 Hz: 22050 / 1280
    expect(harmonicsForLevel(0, 1000)).toBe(137);
    expect(harmonicsForLevel(0, 32)).toBe(32); // capped by the spectrum's length
    expect(harmonicsForLevel(8, 32)).toBe(1); // top level keeps a bare fundamental
  });

  it("cuts exactly at Nyquist per note", () => {
    expect(harmonicsForFreq(3520, 32)).toBe(6);
  });

  it("picks the mip level by octave", () => {
    expect(mipLevelForFreq(80)).toBe(0);
    expect(mipLevelForFreq(639)).toBe(2);
    expect(mipLevelForFreq(640)).toBe(3);
    expect(mipLevelForFreq(1e6)).toBe(8);
  });

  it("rescales every table to the same peak, never past it", () => {
    for (const table of buildMipTables(saw)) {
      const peak = Math.max(...Array.from(table, Math.abs));
      expect(peak).toBeLessThanOrEqual(TABLE_PEAK);
      expect(peak).toBeGreaterThan(TABLE_PEAK - 2);
    }
  });

  it("a one-harmonic table is a sine", () => {
    const t = buildTable([1], 1);
    expect(t[256]).toBe(TABLE_PEAK); // quarter period
    expect(t[0]).toBe(0);
  });
});
