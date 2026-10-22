import { describe, expect, it } from "vitest";
import { calculateRoadFare } from "../src/app/utils/fareCalculator";

/**
 * Opt-in smoke test for the real provider. Run it explicitly:
 *   PowerShell: $env:RUN_LIVE_ORS="true"; npx vitest run tests/live-ors.test.ts
 *   POSIX:      RUN_LIVE_ORS=true npx vitest run tests/live-ors.test.ts
 *
 * It is skipped by default so CI and offline development stay deterministic.
 */
const liveDescribe =
  process.env.RUN_LIVE_ORS === "true" ? describe : describe.skip;

liveDescribe("live OpenRouteService smoke", () => {
  it("returns a positive road distance and a distance-derived fare", async () => {
    if (!process.env.ORS_API_KEY) {
      throw new Error(
        "Set ORS_API_KEY and RUN_LIVE_ORS=true to run the live ORS smoke test.",
      );
    }

    const result = await calculateRoadFare(
      [90.4051, 23.7509],
      [90.4244, 23.7806],
    );

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(30);
    expect(result.fare).toBeCloseTo(result.distanceKm * 100, 2);
  }, 30000);
});
