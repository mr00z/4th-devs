
const API_KEY = process.env.HUB_API_KEY;
export const handlers = {
  async get_candidate_localization({ name, surname, }) {
    const result = await fetch('https://hub.ag3nts.org/api/location', {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, surname, apikey: API_KEY }),
      method: 'POST'
    });

    const data = await result.json();
    console.log(`Localization of ${name} ${surname}`, data);
    return data;
  },

  async get_candidate_access_level({ name, surname, birthYear }) {
    const result = await fetch('https://hub.ag3nts.org/api/accesslevel', {
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name, surname, birthYear, apikey: API_KEY }),
      method: 'POST'
    });

    const data = await result.json();
    console.log(`Access level of ${name} ${surname}`, data);
    return data;
  },

  get_distance({ point1, point2 }) {
    const [lat1, lon1] = point1.split(',').map(Number);
    const [lat2, lon2] = point2.split(',').map(Number);

    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return distance;
  }
};
