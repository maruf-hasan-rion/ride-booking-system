const getDistanceInKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in km
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const calculateFare = (ride: any) => {
  const baseFare = 50; // Flat base fare
  const perKmRate = 20; // Rate per kilometer

  const { lat: pickupLat, lng: pickupLng } = ride.pickupLocation;
  const { lat: destLat, lng: destLng } = ride.destination;

  const distance = getDistanceInKm(pickupLat, pickupLng, destLat, destLng);

  return Math.round(baseFare + distance * perKmRate);
};
