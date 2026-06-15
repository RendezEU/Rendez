export async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Rendez Dating App contact@rendez.app" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { lat: string; lon: string }[];
    if (!data[0]) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ── Cork venue lookup ─────────────────────────────────────────────────────────
// Resolves a venue/location name to GPS coordinates without any external API call.
// Used at activity-creation time so every post lands in the DB with correct coords.
const CORK_EXACT: Record<string, { lat: number; lng: number }> = {
  // ── Preset CORK_SPOTS ──────────────────────────────────────────────────────
  "fitzgerald's park":           { lat: 51.8959, lng: -8.4959 },
  "english market":              { lat: 51.8975, lng: -8.4749 },
  "bishop lucey park":           { lat: 51.8974, lng: -8.4726 },
  "river lee walk":              { lat: 51.8962, lng: -8.4698 },
  "shandon":                     { lat: 51.9019, lng: -8.4793 },
  "the elbow lane":              { lat: 51.8984, lng: -8.4716 },
  "nano nagle place":            { lat: 51.8998, lng: -8.4819 },
  "douglas village":             { lat: 51.8690, lng: -8.4539 },
  "lifetime lab":                { lat: 51.9012, lng: -8.4936 },
  "blarney castle":              { lat: 51.9395, lng: -8.5584 },
  // ── City centre landmarks ───────────────────────────────────────────────────
  "grand parade":                { lat: 51.8975, lng: -8.4730 },
  "washington street":           { lat: 51.8978, lng: -8.4760 },
  "oliver plunkett street":      { lat: 51.8984, lng: -8.4720 },
  "st. patrick's street":        { lat: 51.8985, lng: -8.4712 },
  "paul street":                 { lat: 51.8992, lng: -8.4748 },
  "north main street":           { lat: 51.8990, lng: -8.4810 },
  "mardyke":                     { lat: 51.8945, lng: -8.5007 },
  "mardyke arena":               { lat: 51.8945, lng: -8.5007 },
  "mardyke walk":                { lat: 51.8950, lng: -8.4990 },
  "cork city centre":            { lat: 51.8985, lng: -8.4730 },
  "city centre":                 { lat: 51.8985, lng: -8.4730 },
  // ── Parks & outdoor ─────────────────────────────────────────────────────────
  "lee fields":                  { lat: 51.8960, lng: -8.4960 },
  "blackrock castle":            { lat: 51.9003, lng: -8.4025 },
  "blackrock castle observatory":{ lat: 51.9003, lng: -8.4025 },
  "marina park":                 { lat: 51.9010, lng: -8.4640 },
  "victorian quarter":           { lat: 51.8980, lng: -8.4700 },
  "sunday's well":               { lat: 51.9012, lng: -8.4936 },
  "ballincollig park":           { lat: 51.8876, lng: -8.5816 },
  "ballincollig regional park":  { lat: 51.8876, lng: -8.5816 },
  "ballincollig":                { lat: 51.8876, lng: -8.5816 },
  "tramore valley park":         { lat: 51.8710, lng: -8.4490 },
  "blarney castle grounds":      { lat: 51.9395, lng: -8.5584 },
  "cork city gaol":              { lat: 51.9012, lng: -8.4936 },
  "cork city gaol grounds":      { lat: 51.9012, lng: -8.4936 },
  "ucc quad":                    { lat: 51.8932, lng: -8.4956 },
  "cork public museum":          { lat: 51.8959, lng: -8.4959 },
  // ── Bars, pubs & clubs ───────────────────────────────────────────────────
  "franciscan well brewery":     { lat: 51.9003, lng: -8.4826 },
  "franciscan well":             { lat: 51.9003, lng: -8.4826 },
  "the bodega":                  { lat: 51.8978, lng: -8.4760 },
  "the mutton lane inn":         { lat: 51.8977, lng: -8.4729 },
  "mutton lane inn":             { lat: 51.8977, lng: -8.4729 },
  "tom barry's":                 { lat: 51.8936, lng: -8.4782 },
  "coughlan's":                  { lat: 51.8946, lng: -8.4722 },
  "crane lane theatre":          { lat: 51.8978, lng: -8.4715 },
  "crane lane":                  { lat: 51.8978, lng: -8.4715 },
  "bierhaus":                    { lat: 51.9003, lng: -8.4769 },
  "impala":                      { lat: 51.8982, lng: -8.4729 },
  "sober lane":                  { lat: 51.8944, lng: -8.4726 },
  "dali":                        { lat: 51.8978, lng: -8.4703 },
  "the pav":                     { lat: 51.8985, lng: -8.4718 },
  "voodoo rooms":                { lat: 51.8983, lng: -8.4720 },
  "cask":                        { lat: 51.9010, lng: -8.4755 },
  "monk cocktail bar":           { lat: 51.8982, lng: -8.4720 },
  "the woodford":                { lat: 51.8988, lng: -8.4752 },
  "market lane":                 { lat: 51.8984, lng: -8.4712 },
  "deep south":                  { lat: 51.8970, lng: -8.4740 },
  "clancy's":                    { lat: 51.8993, lng: -8.4762 },
  "reardens":                    { lat: 51.8984, lng: -8.4714 },
  "sin é":                       { lat: 51.9018, lng: -8.4763 },
  "sin e":                       { lat: 51.9018, lng: -8.4763 },
  "cyprus avenue":               { lat: 51.9016, lng: -8.4758 },
  "the oliver plunkett":         { lat: 51.8984, lng: -8.4717 },
  "an bróg":                     { lat: 51.8978, lng: -8.4706 },
  "an brog":                     { lat: 51.8978, lng: -8.4706 },
  "chambers":                    { lat: 51.8975, lng: -8.4709 },
  "the savoy":                   { lat: 51.8987, lng: -8.4710 },
  "dwyers of cork":              { lat: 51.8977, lng: -8.4730 },
  "dwyers":                      { lat: 51.8977, lng: -8.4730 },
  "the spitjack":                { lat: 51.8985, lng: -8.4722 },
  "spitjack":                    { lat: 51.8985, lng: -8.4722 },
  "the long valley":             { lat: 51.8982, lng: -8.4718 },
  "le chateau":                  { lat: 51.8985, lng: -8.4710 },
  "the castle inn":              { lat: 51.8968, lng: -8.4762 },
  "the oval":                    { lat: 51.8984, lng: -8.4714 },
  "the roundy":                  { lat: 51.8990, lng: -8.4770 },
  "the shelbourne bar":          { lat: 51.9010, lng: -8.4760 },
  "dan lowrey's":                { lat: 51.9010, lng: -8.4757 },
  "gallaghers":                  { lat: 51.9009, lng: -8.4761 },
  "electric bar & restaurant":   { lat: 51.8970, lng: -8.4715 },
  "electric":                    { lat: 51.8970, lng: -8.4715 },
  "river lee hotel":             { lat: 51.8958, lng: -8.4987 },
  "goldie":                      { lat: 51.8975, lng: -8.4731 },
  "jacobs on the mall":          { lat: 51.8970, lng: -8.4726 },
  "strasbourg goose":            { lat: 51.8990, lng: -8.4748 },
  // ── Cafés & casual food ───────────────────────────────────────────────────
  "filter":                      { lat: 51.8972, lng: -8.4684 },
  "soma coffee company":         { lat: 51.8991, lng: -8.4755 },
  "soma coffee":                 { lat: 51.8991, lng: -8.4755 },
  "good day deli":               { lat: 51.8987, lng: -8.4742 },
  "three fools coffee":          { lat: 51.8984, lng: -8.4719 },
  "cork coffee roasters":        { lat: 51.8977, lng: -8.4736 },
  "lab 82 coffee":               { lat: 51.9003, lng: -8.4787 },
  "lab 82":                      { lat: 51.9003, lng: -8.4787 },
  "izz café":                    { lat: 51.8978, lng: -8.4721 },
  "izz cafe":                    { lat: 51.8978, lng: -8.4721 },
  "naturally nourished":         { lat: 51.8995, lng: -8.4753 },
  "idaho café":                  { lat: 51.8987, lng: -8.4720 },
  "idaho cafe":                  { lat: 51.8987, lng: -8.4720 },
  "son of a bun":                { lat: 51.8984, lng: -8.4714 },
  "café mexicana":               { lat: 51.8980, lng: -8.4717 },
  "cafe mexicana":               { lat: 51.8980, lng: -8.4717 },
  "crawford art gallery":        { lat: 51.9001, lng: -8.4736 },
  "the crawford art gallery":    { lat: 51.9001, lng: -8.4736 },
  "goldbergs":                   { lat: 51.8984, lng: -8.4726 },
  "miyazaki":                    { lat: 51.8982, lng: -8.4726 },
  // ── Neighbourhoods ──────────────────────────────────────────────────────────
  "douglas":             { lat: 51.8690, lng: -8.4539 },
  "blackrock":           { lat: 51.8898, lng: -8.4210 },
  "rochestown":          { lat: 51.8730, lng: -8.3970 },
  "mahon":               { lat: 51.8824, lng: -8.4367 },
  "ballintemple":        { lat: 51.8870, lng: -8.4100 },
  "monkstown":           { lat: 51.8610, lng: -8.3790 },
  "passage west":        { lat: 51.8690, lng: -8.3380 },
  "carrigaline":         { lat: 51.8130, lng: -8.3940 },
  "cobh":                { lat: 51.8510, lng: -8.2960 },
  "midleton":            { lat: 51.9140, lng: -8.1710 },
  "blarney":             { lat: 51.9395, lng: -8.5584 },
  "bishopstown":         { lat: 51.8850, lng: -8.5000 },
  "wilton":              { lat: 51.8820, lng: -8.5020 },
  "ucc":                 { lat: 51.8932, lng: -8.4956 },
  "western road":        { lat: 51.8945, lng: -8.4970 },
  "togher":              { lat: 51.8730, lng: -8.5010 },
  "turners cross":       { lat: 51.8770, lng: -8.4810 },
  "glasheen":            { lat: 51.8870, lng: -8.5080 },
  "model farm road":     { lat: 51.8900, lng: -8.5120 },
};

const CORK_KEYWORDS: Array<{ keywords: string[]; lat: number; lng: number }> = [
  { keywords: ["fitzgerald"],                            lat: 51.8959, lng: -8.4959 },
  { keywords: ["mardyke arena"],                        lat: 51.8945, lng: -8.5007 },
  { keywords: ["mardyke"],                              lat: 51.8945, lng: -8.5007 },
  { keywords: ["lee fields"],                           lat: 51.8960, lng: -8.4960 },
  { keywords: ["blackrock castle"],                     lat: 51.9003, lng: -8.4025 },
  { keywords: ["english market", "grand parade"],       lat: 51.8975, lng: -8.4749 },
  { keywords: ["bishop lucey", "lucey park"],           lat: 51.8974, lng: -8.4726 },
  { keywords: ["river lee", "lee walk"],                lat: 51.8962, lng: -8.4698 },
  { keywords: ["shandon"],                              lat: 51.9019, lng: -8.4793 },
  { keywords: ["elbow", "oliver plunkett"],             lat: 51.8984, lng: -8.4716 },
  { keywords: ["nano nagle", "north main"],             lat: 51.8998, lng: -8.4819 },
  { keywords: ["lifetime", "sunday"],                   lat: 51.9012, lng: -8.4936 },
  { keywords: ["franciscan well"],                      lat: 51.9003, lng: -8.4826 },
  { keywords: ["bodega"],                               lat: 51.8978, lng: -8.4760 },
  { keywords: ["mutton lane"],                          lat: 51.8977, lng: -8.4729 },
  { keywords: ["tom barry"],                            lat: 51.8936, lng: -8.4782 },
  { keywords: ["coughlan"],                             lat: 51.8946, lng: -8.4722 },
  { keywords: ["crane lane"],                           lat: 51.8978, lng: -8.4715 },
  { keywords: ["bierhaus"],                             lat: 51.9003, lng: -8.4769 },
  { keywords: ["impala"],                               lat: 51.8982, lng: -8.4729 },
  { keywords: ["sober lane"],                           lat: 51.8944, lng: -8.4726 },
  { keywords: ["dali"],                                 lat: 51.8978, lng: -8.4703 },
  { keywords: ["the pav"],                              lat: 51.8985, lng: -8.4718 },
  { keywords: ["voodoo"],                               lat: 51.8983, lng: -8.4720 },
  { keywords: ["cask", "maccurtain"],                   lat: 51.9010, lng: -8.4755 },
  { keywords: ["monk cocktail"],                        lat: 51.8982, lng: -8.4720 },
  { keywords: ["soma coffee"],                          lat: 51.8991, lng: -8.4755 },
  { keywords: ["filter,", "filter coffee"],             lat: 51.8972, lng: -8.4684 },
  { keywords: ["good day deli"],                        lat: 51.8987, lng: -8.4742 },
  { keywords: ["three fools"],                          lat: 51.8984, lng: -8.4719 },
  { keywords: ["cork coffee roasters"],                 lat: 51.8977, lng: -8.4736 },
  { keywords: ["lab 82"],                               lat: 51.9003, lng: -8.4787 },
  { keywords: ["izz café", "izz cafe"],                 lat: 51.8978, lng: -8.4721 },
  { keywords: ["naturally nourished"],                  lat: 51.8995, lng: -8.4753 },
  { keywords: ["idaho"],                                lat: 51.8987, lng: -8.4720 },
  { keywords: ["son of a bun"],                         lat: 51.8984, lng: -8.4714 },
  { keywords: ["mexicana"],                             lat: 51.8980, lng: -8.4717 },
  { keywords: ["market lane"],                          lat: 51.8984, lng: -8.4712 },
  { keywords: ["crawford"],                             lat: 51.9001, lng: -8.4736 },
  { keywords: ["spitjack"],                             lat: 51.8985, lng: -8.4722 },
  { keywords: ["goldberg"],                             lat: 51.8984, lng: -8.4726 },
  { keywords: ["blarney"],                              lat: 51.9395, lng: -8.5584 },
  { keywords: ["douglas"],                              lat: 51.8690, lng: -8.4539 },
  { keywords: ["blackrock", "rochestown"],              lat: 51.8898, lng: -8.4210 },
  { keywords: ["ballincollig"],                         lat: 51.8876, lng: -8.5816 },
  { keywords: ["mahon"],                                lat: 51.8824, lng: -8.4367 },
  { keywords: ["ucc", "western road", "wilton"],        lat: 51.8932, lng: -8.4956 },
  { keywords: ["patrick street", "paul street"],        lat: 51.8985, lng: -8.4720 },
  { keywords: ["centre", "center"],                     lat: 51.8985, lng: -8.4730 },
];

/**
 * Resolve a Cork venue/location name to GPS coordinates.
 * Returns null when the name isn't recognised (e.g. outside Cork).
 * Tries exact match first, then keyword fallback for full address strings.
 */
export function geocodeVenueName(name: string | null | undefined): { lat: number; lng: number } | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (CORK_EXACT[lower]) return CORK_EXACT[lower];
  for (const entry of CORK_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return { lat: entry.lat, lng: entry.lng };
  }
  return null;
}
