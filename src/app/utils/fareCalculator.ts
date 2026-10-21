import axios from "axios";
import { envVars } from "../config/env";
import AppError from "../errorHelpers/AppError";
import httpStatus from "http-status-codes";

const ORS_ROUTE_ENDPOINT =
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

export const fareCalulator = async (
  pickup: [number, number],
  destination: [number, number],
  baseFarePerKm = 100
) => {
  try {
    const res = await axios.post(
      ORS_ROUTE_ENDPOINT,
      {
        coordinates: [
          [pickup[0], pickup[1]],
          [destination[0], destination[1]],
        ],
      },
      {
        headers: {
          Authorization: envVars.ORS_API_KEY,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const route = res.data.features[0];
    const distanceInMeters = route?.properties?.summary?.distance;

    if (typeof distanceInMeters !== "number" || distanceInMeters <= 0) {
      throw new AppError(
        httpStatus.SERVICE_UNAVAILABLE,
        "Routing service returned no usable route. Please try again shortly."
      );
    }

    const distanceKm = parseFloat((distanceInMeters / 1000).toFixed(2));
    const fare = parseFloat((distanceKm * baseFarePerKm).toFixed(2));

    return {
      distanceKm,
      fare,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Route distance service is unavailable. Please try again shortly."
    );
  }
};
