import { PHCFacility } from '../../src/types/health';
import { db, doc, getDoc, setDoc } from '../../src/lib/firebase';

export const FALLBACK_FACILITIES: PHCFacility[] = [
  {
    id: "phc_khed_01",
    name: "Khed Primary Health Centre (PHC)",
    type: "PHC",
    district: "Pune",
    state: "Maharashtra",
    address: "Main Market Road, Khed Town, Pune Rural, Maharashtra 410505",
    lat: 18.8475,
    lng: 73.9102,
    distanceKm: 2.4,
    phone: "+91 2135 222108",
    emergencyServices: true,
    is24x7: true,
    doctorOnDuty: "Dr. A. K. Deshmukh (MO)",
    openingHours: "24 Hours (Emergency OPD Open)"
  },
  {
    id: "phc_chakan_02",
    name: "Chakan Rural Hospital & Community Health Centre",
    type: "CHC",
    district: "Pune",
    state: "Maharashtra",
    address: "Talegaon Road, Chakan, Khed Taluka, Pune District 410501",
    lat: 18.7610,
    lng: 73.8615,
    distanceKm: 8.7,
    phone: "+91 2135 252300",
    emergencyServices: true,
    is24x7: true,
    doctorOnDuty: "Dr. S. Patil (Surgeon)",
    openingHours: "24/7 Casualty & Delivery Ward"
  },
  {
    id: "subcenter_pait_03",
    name: "Pait Village Health Sub-Centre (Ayushman Arogya Mandir)",
    type: "SubCentre",
    district: "Pune",
    state: "Maharashtra",
    address: "Near ZP School, Pait Village, Khed Block, Pune 410505",
    lat: 18.8801,
    lng: 73.8950,
    distanceKm: 1.1,
    phone: "+91 98220 10899 (ANM Desk)",
    emergencyServices: true,
    is24x7: false,
    doctorOnDuty: "Smt. Sunita Pawar (CHO)",
    openingHours: "9:00 AM - 4:00 PM (ANM / CHO Available)"
  },
  {
    id: "subcenter_wada_04",
    name: "Wada Ayushman Arogya Mandir Sub-Centre",
    type: "SubCentre",
    district: "Pune",
    state: "Maharashtra",
    address: "Gram Panchayat Complex, Wada Village, Khed 410505",
    lat: 18.8230,
    lng: 73.9310,
    distanceKm: 4.8,
    phone: "+91 94210 55432",
    emergencyServices: false,
    is24x7: false,
    openingHours: "9:00 AM - 5:00 PM"
  },
  {
    id: "dh_pune_05",
    name: "Aundh District Hospital & Trauma Care",
    type: "DistrictHospital",
    district: "Pune",
    state: "Maharashtra",
    address: "Aundh Camp, Pune City, Maharashtra 411027",
    lat: 18.5601,
    lng: 73.8080,
    distanceKm: 34.0,
    phone: "+91 20 2728 0108",
    emergencyServices: true,
    is24x7: true,
    doctorOnDuty: "Civil Surgeon & On-Call Trauma Specialists",
    openingHours: "24/7 Tertiary Trauma Centre"
  }
];

export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

export async function fetchOverpassFacilities(
  userLat: number,
  userLng: number,
  radiusMeters: number = 25000
): Promise<PHCFacility[]> {
  try {
    const overpassQuery = `
      [out:json][timeout:8];
      (
        node["amenity"="clinic"](around:${radiusMeters},${userLat},${userLng});
        node["amenity"="hospital"](around:${radiusMeters},${userLat},${userLng});
        way["amenity"="hospital"](around:${radiusMeters},${userLat},${userLng});
        node["healthcare"="centre"](around:${radiusMeters},${userLat},${userLng});
      );
      out center 12;
    `;

    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "data=" + encodeURIComponent(overpassQuery)
    });

    if (!response.ok) {
      throw new Error(`Overpass API response error HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.elements) || data.elements.length === 0) {
      return [];
    }

    const fetchedFacilities: PHCFacility[] = data.elements
      .map((el: any, index: number) => {
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;
        if (!lat || !lng) return null;

        const tags = el.tags || {};
        const rawName = tags.name || tags["name:en"] || tags["name:hi"] || "Government Primary Health Facility";
        const distKm = calculateHaversineDistanceKm(userLat, userLng, lat, lng);

        let type = "PHC";
        const lowerName = rawName.toLowerCase();
        if (lowerName.includes("sub") || lowerName.includes("arogya mandir")) {
          type = "SubCentre";
        } else if (lowerName.includes("chc") || lowerName.includes("community")) {
          type = "CHC";
        } else if (lowerName.includes("district") || lowerName.includes("civil") || lowerName.includes("trauma")) {
          type = "DistrictHospital";
        }

        return {
          id: `osm_${el.id || index}`,
          name: rawName,
          type,
          district: tags["addr:district"] || "Rural District",
          state: tags["addr:state"] || "Maharashtra",
          address: tags["addr:full"] || tags["addr:street"] || `${rawName}, Rural Sector`,
          lat,
          lng,
          distanceKm: distKm,
          phone: tags.phone || tags["contact:phone"] || "+91 108 Emergency",
          emergencyServices: true,
          is24x7: true,
          openingHours: tags.opening_hours || "24/7 Health Service"
        } as PHCFacility;
      })
      .filter((f: PHCFacility | null): f is PHCFacility => f !== null)
      .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));

    return fetchedFacilities;
  } catch (err) {
    console.warn("OSM Overpass API fetch warning, falling back to curated PHCs:", err);
    return [];
  }
}

export async function getNearestFacilities(
  userLat?: number,
  userLng?: number,
  district?: string
): Promise<{ facilities: PHCFacility[]; isFallback: boolean; source: string }> {
  if (db && district) {
    try {
      const docRef = doc(db, 'phc_facilities', district.toLowerCase().replace(/\s+/g, '_'));
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (Array.isArray(data.facilities) && data.facilities.length > 0) {
          let facs = data.facilities as PHCFacility[];
          if (userLat && userLng) {
            facs = facs.map(f => {
              const d = calculateHaversineDistanceKm(userLat, userLng, f.lat, f.lng);
              return { ...f, distanceKm: d };
            }).sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
          }
          return { facilities: facs, isFallback: false, source: 'firestore' };
        }
      }
    } catch (err) {
      console.warn('Firestore facility fetch warning:', err);
    }
  }

  if (userLat !== undefined && userLng !== undefined) {
    const osmFacilities = await fetchOverpassFacilities(userLat, userLng);
    if (osmFacilities.length > 0) {
      if (db && district) {
        try {
          const docRef = doc(db, 'phc_facilities', district.toLowerCase().replace(/\s+/g, '_'));
          setDoc(docRef, { district, updatedAt: new Date().toISOString(), facilities: osmFacilities }).catch(e => {
            console.warn('Failed to cache OSM facilities in Firestore:', e);
          });
        } catch (e) {
          console.warn('Firestore caching error:', e);
        }
      }

      return {
        facilities: osmFacilities,
        isFallback: false,
        source: "osm_overpass_live"
      };
    }
  }

  const baseLat = userLat !== undefined ? userLat : 18.8475;
  const baseLng = userLng !== undefined ? userLng : 73.9102;

  const sortedFallback = FALLBACK_FACILITIES.map(f => {
    const dist = calculateHaversineDistanceKm(baseLat, baseLng, f.lat, f.lng);
    return {
      ...f,
      distanceKm: dist
    };
  }).sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));

  return {
    facilities: sortedFallback,
    isFallback: true,
    source: "curated_fallback"
  };
}
