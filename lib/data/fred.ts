const BASE = 'https://api.stlouisfed.org/fred/series/observations';

export async function getVIX(): Promise<number | undefined> {
  const k = process.env.FRED_API_KEY;
  if (!k) return undefined;
  const url = `${BASE}?series_id=VIXCLS&api_key=${k}&file_type=json&limit=5&sort_order=desc`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { observations?: Array<{ value: string }> };
  for (const obs of data.observations ?? []) {
    const v = parseFloat(obs.value);
    if (!Number.isNaN(v)) return v;
  }
  return undefined;
}
