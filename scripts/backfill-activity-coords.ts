/**
 * One-time backfill: geocode locationName for existing ActivityPost rows
 * that have no lat/lng stored yet.
 *
 * Run with:  npx tsx scripts/backfill-activity-coords.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CORK_GEOCODE: Array<{ keywords: string[]; lat: number; lng: number }> = [
  { keywords: ["fitzgerald", "mardyke"],                           lat: 51.8985, lng: -8.4780 },
  { keywords: ["english market", "grand parade", "washington"],    lat: 51.8975, lng: -8.4758 },
  { keywords: ["bishop lucey", "lucey park", "bishop lucy"],       lat: 51.8977, lng: -8.4724 },
  { keywords: ["river lee", "lee walk", "lee road"],               lat: 51.8960, lng: -8.4730 },
  { keywords: ["shandon"],                                          lat: 51.9015, lng: -8.4798 },
  { keywords: ["elbow", "oliver plunkett", "patrick street"],      lat: 51.8985, lng: -8.4720 },
  { keywords: ["nano nagle", "north main"],                         lat: 51.8990, lng: -8.4810 },
  { keywords: ["lifetime", "sunday", "sundays well"],              lat: 51.9015, lng: -8.4936 },
  { keywords: ["blarney"],                                          lat: 51.9377, lng: -8.5641 },
  { keywords: ["douglas"],                                          lat: 51.8718, lng: -8.4543 },
  { keywords: ["blackrock", "rochestown"],                          lat: 51.8900, lng: -8.4220 },
  { keywords: ["ballincollig"],                                     lat: 51.8876, lng: -8.5816 },
  { keywords: ["ucc", "western road", "wilton", "bishopstown"],    lat: 51.8932, lng: -8.4956 },
  { keywords: ["mahon"],                                            lat: 51.8824, lng: -8.4367 },
  { keywords: ["city centre", "city center", "centre"],            lat: 51.8985, lng: -8.4730 },
];

function geocode(name: string | null): { lat: number; lng: number } | null {
  if (!name) return null;
  const loc = name.toLowerCase();
  for (const entry of CORK_GEOCODE) {
    if (entry.keywords.some((kw) => loc.includes(kw))) return { lat: entry.lat, lng: entry.lng };
  }
  return null;
}

async function main() {
  const posts = await prisma.activityPost.findMany({
    where: { locationLat: null },
    select: { id: true, locationName: true },
  });

  let fixed = 0;
  for (const p of posts) {
    const coords = geocode(p.locationName);
    if (!coords) continue;
    await prisma.activityPost.update({
      where: { id: p.id },
      data: { locationLat: coords.lat, locationLng: coords.lng },
    });
    console.log(`✅ ${p.locationName} → ${coords.lat}, ${coords.lng}`);
    fixed++;
  }

  console.log(`\nDone — ${fixed} / ${posts.length} activities geocoded.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
