import { RideStatus } from "./ride.interface";

/** REQUESTED rides expire after this long without a driver accepting them. */
export const RIDE_REQUEST_TTL_MS = 15 * 60 * 1000;

/** Statuses that count as "the rider still has a live ride" (blocks double booking). */
export const RIDER_ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.ACCEPTED,
  RideStatus.PICKED_UP,
  RideStatus.IN_TRANSIT,
  RideStatus.ARRIVED,
];

/** Statuses that count as "the driver is currently operating a ride". */
export const DRIVER_ACTIVE_RIDE_STATUSES: RideStatus[] = [
  RideStatus.ACCEPTED,
  RideStatus.PICKED_UP,
  RideStatus.IN_TRANSIT,
  RideStatus.ARRIVED,
];

/** Valid forward transitions of the ride state machine. */
export const RIDE_STATUS_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  [RideStatus.REQUESTED]: [RideStatus.ACCEPTED, RideStatus.REJECTED],
  [RideStatus.ACCEPTED]: [RideStatus.PICKED_UP],
  [RideStatus.REJECTED]: [],
  [RideStatus.PICKED_UP]: [RideStatus.IN_TRANSIT],
  [RideStatus.IN_TRANSIT]: [RideStatus.ARRIVED],
  [RideStatus.ARRIVED]: [RideStatus.COMPLETED],
  [RideStatus.COMPLETED]: [],
  [RideStatus.CANCELLED]: [],
};

/** For each driver-initiated target status, the ride state it must transition from. */
export const RIDE_TRANSITION_SOURCE: Record<
  RideStatus,
  RideStatus | undefined
> = {
  [RideStatus.PICKED_UP]: RideStatus.ACCEPTED,
  [RideStatus.IN_TRANSIT]: RideStatus.PICKED_UP,
  [RideStatus.ARRIVED]: RideStatus.IN_TRANSIT,
  [RideStatus.COMPLETED]: RideStatus.ARRIVED,
  [RideStatus.ACCEPTED]: undefined, // only riders may cancel; drivers never ACCEPT
  [RideStatus.REJECTED]: undefined,
  [RideStatus.REQUESTED]: undefined,
  [RideStatus.CANCELLED]: undefined,
};

/** Driver-initiated target status -> the timestamps field written on that transition. */
export const RIDE_TRANSITION_TIMESTAMP_FIELD: Record<
  RideStatus,
  string | undefined
> = {
  [RideStatus.PICKED_UP]: "timestamps.pickedUpAt",
  [RideStatus.IN_TRANSIT]: "timestamps.startedAt",
  [RideStatus.ARRIVED]: "timestamps.arrivedAt",
  [RideStatus.COMPLETED]: "timestamps.completedAt",
  [RideStatus.ACCEPTED]: undefined,
  [RideStatus.REJECTED]: undefined,
  [RideStatus.REQUESTED]: undefined,
  [RideStatus.CANCELLED]: undefined,
};
