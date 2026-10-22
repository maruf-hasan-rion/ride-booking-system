import { calculateRoadFare } from "./fareCalculator";

export interface FareResult {
  distanceKm: number;
  fare: number;
}

export type FareProvider = (
  pickup: [number, number],
  destination: [number, number],
  baseFarePerKm?: number,
) => Promise<FareResult>;

/**
 * The live provider is the default. Tests replace this module with a
 * deterministic fake so the lifecycle suite never depends on ORS uptime.
 */
export const calculateFare: FareProvider = (
  pickup,
  destination,
  baseFarePerKm,
) => calculateRoadFare(pickup, destination, baseFarePerKm);
