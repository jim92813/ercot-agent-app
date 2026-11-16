// Data access for the ERCOT market desk agent: the hosted layers the simulated live feed updates.
// Every query goes to the service (not the map's cached graphics) so answers reflect the latest feed tick.
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";

const EVENTS = "https://services.arcgis.com/l483wZ43iEK8alrh/arcgis/rest/services/ERCOT_price_events_replay/FeatureServer";
const EXTRA = "https://services.arcgis.com/l483wZ43iEK8alrh/arcgis/rest/services/ERCOT_simulated_live_layers/FeatureServer";

export const layers = {
  zones: new FeatureLayer({ url: `${EVENTS}/0` }),
  alerts: new FeatureLayer({ url: `${EVENTS}/1` }),
  stations: new FeatureLayer({ url: `${EVENTS}/2` }),
  history: new FeatureLayer({ url: `${EVENTS}/3` }),
  dayAheadHourly: new FeatureLayer({ url: `${EVENTS}/5` }),
  radar: new FeatureLayer({ url: `${EXTRA}/0` }),
  nodalPrices: new FeatureLayer({ url: `${EXTRA}/1` }),
};

export type Attrs = Record<string, any>;

export async function rows(layer: FeatureLayer, where = "1=1", outFields: string[] = ["*"], orderBy?: string[], num?: number): Promise<Attrs[]> {
  const q = layer.createQuery();
  q.where = where;
  q.outFields = outFields;
  q.returnGeometry = false;
  if (orderBy) q.orderByFields = orderBy;
  if (num) q.num = num;
  const fs = await layer.queryFeatures(q);
  return fs.features.map((f) => f.attributes as Attrs);
}

// Zone names people use -> the label values in the layers.
const ZONE_WORDS: [RegExp, string][] = [
  [/hub|average|avg|system|ercot/i, "Hub average"],
  [/houston|coast/i, "Houston zone"],
  [/north|dallas|fort worth|dfw/i, "North zone"],
  [/south|san antonio|austin|corpus/i, "South zone"],
  [/west|permian|midland|odessa|panhandle/i, "West zone"],
];

export function zoneLabel(text?: string): string | undefined {
  if (!text) return undefined;
  for (const [re, label] of ZONE_WORDS) if (re.test(text)) return label;
  return undefined;
}

export function sqlText(s: string): string {
  return s.replace(/'/g, "''");
}

export function centralTime(ms?: number | null): string {
  if (ms == null) return "unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(ms)) + " CT";
}

export async function replayTime(): Promise<string> {
  const r = await rows(layers.zones, "1=1", ["asof_dt"], ["asof_dt DESC"], 1);
  return centralTime(r[0]?.asof_dt);
}

export const pct = (p?: number | null) => (p == null ? "n/a" : `${Math.round(p * 1000) / 10}%`);
export const usd = (v?: number | null) => (v == null ? "n/a" : `$${Math.round(v * 10) / 10}`);
