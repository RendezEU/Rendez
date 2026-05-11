import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/auth/session";

const ACTIVITY_TAGS: Record<string, string> = {
  RUNNING: '["leisure"="track"]["sport"="running"]',
  COFFEE_WALK: '["amenity"="cafe"]',
  DRINKS: '["amenity"="bar"]',
  TENNIS: '["leisure"="pitch"]["sport"="tennis"]',
  HIKING: '["leisure"="nature_reserve"]',
  CYCLING: '["route"="bicycle"]',
  YOGA: '["sport"="yoga"]',
  COOKING: '["amenity"="restaurant"]["cuisine"="cooking_school"]',
  MUSEUM: '["tourism"="museum"]',
  PICNIC: '["leisure"="park"]',
  CLIMBING: '["sport"="climbing"]',
  DANCING: '["amenity"="nightclub"]',
};

interface NominatimResult {
  lat: string;
  lon: string;
}

interface OverpassElement {
  tags?: { name?: string; website?: string; "addr:street"?: string; "addr:city"?: string };
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

export async function GET(req: Request) {
  await getRequestUserId(req);
  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city") ?? "";
  const activity = searchParams.get("activity") ?? "";

  if (!city || !activity) {
    return NextResponse.json({ venues: [] });
  }

  try {
    // Geocode city
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
      { headers: { "User-Agent": "Rendez dating app (contact@rendez.app)" } }
    );
    const geoData = (await geoRes.json()) as NominatimResult[];
    if (!geoData.length) return NextResponse.json({ venues: [] });

    const { lat, lon } = geoData[0];
    const radius = 5000; // 5km
    const tag = ACTIVITY_TAGS[activity] ?? '["amenity"="cafe"]';

    const query = `[out:json][timeout:10];node${tag}(around:${radius},${lat},${lon});out 8;`;
    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
    });
    const overpassData = await overpassRes.json() as { elements: OverpassElement[] };

    const venues = (overpassData.elements ?? [])
      .filter((e) => e.tags?.name)
      .slice(0, 6)
      .map((e) => ({
        name: e.tags!.name!,
        address: [e.tags?.["addr:street"], e.tags?.["addr:city"]].filter(Boolean).join(", ") || city,
        website: e.tags?.website,
        lat: e.lat ?? e.center?.lat,
        lon: e.lon ?? e.center?.lon,
      }));

    return NextResponse.json({ venues });
  } catch {
    return NextResponse.json({ venues: [] });
  }
}
