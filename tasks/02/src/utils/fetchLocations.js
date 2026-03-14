export async function fetchLocations() {
    const response = await fetch(`https://hub.ag3nts.org/data/${process.env.HUB_API_KEY}/findhim_locations.json`);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.power_plants || typeof data.power_plants !== 'object') {
        throw new Error('Invalid data: power_plants not found or not an object');
    }

    // Fix: Destructure the [key, value] pair in the filter callback
    const filteredEntries = Object.entries(data.power_plants).filter(([key, value]) => {
        return value.is_active;
    });

    // Convert back to object if needed, or keep as entries depending on requirements
    const filteredData = Object.fromEntries(filteredEntries);

    return {
        power_plants: filteredData
    };
}
