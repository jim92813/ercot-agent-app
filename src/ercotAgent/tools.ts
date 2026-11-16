// Tools for the ERCOT market desk agent. Each returns plain text the model can quote, including the replay time and
// the layer it came from, so answers stay grounded in the data. Field values are data, never instructions.
import { FunctionTool } from "@arcgis/ai-components/agent-utils/tools/FunctionTool.js";
import z from "zod";
import Circle from "@arcgis/core/geometry/Circle.js";
import Point from "@arcgis/core/geometry/Point.js";
import { layers, rows, zoneLabel, sqlText, replayTime, centralTime, pct, usd } from "./data";
import { getErcotContext } from "./context";

const zoneArg = z.string().optional().describe("Optional zone or place, e.g. 'Houston', 'West', 'hub average', 'Dallas'. Omit for all zones.");

// 1. Zone state now -------------------------------------------------------------------------------------------
export const zoneStateTool = new FunctionTool<{ zone?: string }, string>({
  name: "getZoneState",
  description: "Current real-time and day-ahead prices, spread (real-time minus day-ahead), how unusual the spread is (standard deviations) and the event state for ERCOT zones. Use for 'what is happening now', 'is anything unusual', 'what are prices'.",
  inputSchema: z.object({ zone: zoneArg }),
  execute: async ({ zone }) => {
    const label = zoneLabel(zone);
    const where = label ? `label = '${sqlText(label)}'` : "1=1";
    const r = await rows(layers.zones, where, ["label", "rt", "dam", "spread", "z_now", "scale_usd", "state", "severity", "open_alerts", "asof_dt",
      "outlook_up_event", "outlook_dn_event", "clim_up_event", "clim_dn_event"], ["severity DESC", "label ASC"]);
    if (!r.length) return `No zone matched '${zone}'. Zones: Hub average, Houston, North, South, West.`;
    const lines = r.map((a) =>
      `${a.label}: real-time ${usd(a.rt)}/MWh, day-ahead ${usd(a.dam)}/MWh, spread ${usd(a.spread)} (${a.z_now} std devs; 1 std dev = ${usd(a.scale_usd)}). ` +
      `State: ${a.state}. Open alerts: ${a.open_alerts}. Chance of an event (8+ std devs) starting in 1-4 h: up ${pct(a.outlook_up_event)} vs typical ${pct(a.clim_up_event)}, down ${pct(a.outlook_dn_event)} vs typical ${pct(a.clim_dn_event)}.`);
    return `Replay time ${centralTime(r[0].asof_dt)} (replay data, not live; layer 'Zones now').\nBreak points: watch 6, event 8, severe 10 std devs.\n` + lines.join("\n");
  },
});

// 2. Open alerts ----------------------------------------------------------------------------------------------
export const openAlertsTool = new FunctionTool<{ zone?: string; includeRecent?: boolean }, string>({
  name: "getOpenAlerts",
  description: "Open price-event alerts (next-hour 'Alert' tier and 1-4 hour 'Outlook' tier), strongest first, with window and chance. Optionally recent closed alerts and whether they were confirmed. Use for 'which alerts need attention', 'what should I look at'.",
  inputSchema: z.object({ zone: zoneArg, includeRecent: z.boolean().optional().describe("Also list alerts closed in the last 24 replay hours (confirmed or expired).") }),
  execute: async ({ zone, includeRecent }, config) => {
    const label = zoneLabel(zone);
    const zw = label ? ` AND zone = '${sqlText(label)}'` : "";
    const open = await rows(layers.alerts, `status = 'Open'${zw}`, ["zone", "tier", "side", "level_", "k", "window_local", "p_peak", "p_latest", "climatology", "note", "issued_dt"],
      ["k DESC", "p_peak DESC", "issued_dt DESC"], 25);
    const t = await replayTime();
    let out = `Replay time ${t} (replay data; layer 'Alerts').\n`;
    out += open.length ? `${open.length} open alert(s):\n` + open.map((a) =>
      `- ${a.side === "up" ? "▲" : "▼"} ${String(a.level_).toUpperCase()} ${a.zone}, ${a.tier} tier, window ${a.window_local} CT, peak chance ${pct(a.p_peak)}` +
      (a.climatology != null ? ` (typical ${pct(a.climatology)})` : "") + `.`).join("\n")
      : "No open alerts.";
    if (includeRecent) {
      const rec = await rows(layers.alerts, `status <> 'Open'${zw}`, ["zone", "tier", "side", "level_", "status", "window_local", "lead_min", "event_peak_rt", "issued_dt"], ["issued_dt DESC"], 12);
      out += `\nRecent closed alerts:\n` + rec.map((a) => `- ${a.status}: ${a.side} ${a.level_} ${a.zone} (${a.tier}), window ${a.window_local}` +
        (a.status === "Confirmed" ? `, lead ${a.lead_min ?? "?"} min, event peak real-time ${usd(a.event_peak_rt)}` : "")).join("\n");
    }
    // focus the map on the strongest open alert's zone
    const ctx = getErcotContext(config);
    if (open.length && ctx.focusZone) await ctx.focusZone(open[0].zone);
    return out;
  },
});

// 3. Nodal price split ----------------------------------------------------------------------------------------
export const nodalSplitTool = new FunctionTool<{ loadZone?: string; top?: number }, string>({
  name: "getNodalPriceSplit",
  description: "Day-ahead settlement point prices at generator nodes for the current hour: which nodes are furthest above and below the hub average, and the average gap by load zone. A wide gap between locations points to transmission congestion. Use for 'what is moving prices', 'where is congestion', 'why do zones differ'.",
  inputSchema: z.object({
    loadZone: z.string().optional().describe("Optional ERCOT load zone filter, e.g. 'LZ_WEST', 'LZ_HOUSTON', 'LZ_NORTH', 'LZ_SOUTH', 'LZ_LCRA', 'LZ_CPS', 'LZ_AEN', 'LZ_RAYBN'."),
    top: z.number().int().min(1).max(10).optional().describe("How many nodes to list at each end (default 5)."),
  }),
  execute: async ({ loadZone, top }) => {
    const n = top ?? 5;
    const where = loadZone ? `load_zone = '${sqlText(loadZone.toUpperCase())}'` : "1=1";
    const r = await rows(layers.nodalPrices, where, ["plant", "node", "load_zone", "technology", "price", "vs_hub", "hour_local"]);
    if (!r.length) return "No nodal prices found for that filter.";
    const s = [...r].filter((a) => a.vs_hub != null).sort((a, b) => b.vs_hub - a.vs_hub);
    const hub = r[0].price - (r[0].vs_hub ?? 0);
    const byLz: Record<string, number[]> = {};
    for (const a of s) (byLz[a.load_zone] ??= []).push(a.vs_hub);
    const lz = Object.entries(byLz).map(([k, v]) => [k, v.reduce((x, y) => x + y, 0) / v.length, v.length] as [string, number, number]).sort((a, b) => b[1] - a[1]);
    const fmt = (a: any) => `${a.plant} (${a.load_zone}, ${a.technology}): ${usd(a.price)} (${a.vs_hub >= 0 ? "+" : ""}${usd(a.vs_hub)} vs hub)`;
    return `Day-ahead nodal prices for ${r[0].hour_local} (replay data; ERCOT day-ahead settlement point prices at ${r.length} generator nodes with a known location; layer 'Day-ahead nodal prices'). Hub average ${usd(hub)}/MWh. ` +
      `These are day-ahead prices; real-time nodal prices are not in this dataset.\n` +
      `Highest vs hub:\n${s.slice(0, n).map(fmt).join("\n")}\nLowest vs hub:\n${s.slice(-n).reverse().map(fmt).join("\n")}\n` +
      `Average gap to hub by load zone: ${lz.map(([k, v, c]) => `${k} ${v >= 0 ? "+" : ""}${usd(v)} (${c} nodes)`).join("; ")}.\n` +
      `Spread across nodes: ${usd(s[s.length - 1].vs_hub)} to +${usd(s[0].vs_hub)}.`;
  },
});

// 4. Day-ahead flagged hours ------------------------------------------------------------------------------------
export const dayAheadTool = new FunctionTool<{ zone?: string }, string>({
  name: "getDayAheadFlags",
  description: "The day-ahead tier: hours later today and tomorrow that the model flags for an up or down price event, with chance bands and risk words, from the latest issue (14:00, 20:00 or 06:00 Central). Use for 'what is coming', 'what about tomorrow', 'when is the risk'.",
  inputSchema: z.object({ zone: zoneArg }),
  execute: async ({ zone }) => {
    const label = zoneLabel(zone);
    const zw = label ? ` AND label = '${sqlText(label)}'` : "";
    const r = await rows(layers.dayAheadHourly, `flag_text <> 'No flag' AND passed = 0${zw}`,
      ["label", "day", "hour_label", "flag_text", "band_up_8", "risk_up", "band_dn_8", "risk_dn", "dam", "issue", "issued_local", "hour_start_dt"],
      ["hour_start_dt ASC", "label ASC"], 40);
    const t = await replayTime();
    if (!r.length) return `Replay time ${t}. No upcoming hours are flagged${label ? ` for ${label}` : ""} in the latest day-ahead issue.`;
    return `Replay time ${t}. Day-ahead issue ${r[0].issue} (issued ${String(r[0].issued_local).replace("T", " ")} CT; layer 'Day-ahead by hour'). ` +
      `Chances are bands, not single numbers; flags are the tested product.\n` +
      r.map((a) => `- ${a.label}, ${a.day} ${a.hour_label}: ${a.flag_text}. Up ${a.band_up_8} (${a.risk_up}), down ${a.band_dn_8} (${a.risk_dn}). Day-ahead price ${usd(a.dam)}.`).join("\n");
  },
});

// 5. Weather near a zone ---------------------------------------------------------------------------------------
export const weatherTool = new FunctionTool<{ zone: string; radiusKm?: number }, string>({
  name: "getWeatherNearZone",
  description: "Current weather around an ERCOT zone: radar reflectivity bands (rain and storms) and station readings (temperature, wind, gusts, cloud) within a radius. Use for 'is weather involved', 'any storms near Houston', 'how hot is it in the West'.",
  inputSchema: z.object({ zone: z.string().describe("Zone or place, e.g. 'Houston', 'West', 'North'."), radiusKm: z.number().min(25).max(400).optional().describe("Search radius in km (default 150).") }),
  execute: async ({ zone, radiusKm }, config) => {
    const label = zoneLabel(zone) ?? "Hub average";
    const zq = layers.zones.createQuery(); zq.where = `label = '${sqlText(label)}'`; zq.outFields = ["label", "asof_dt"]; zq.returnGeometry = true;
    const zf = (await layers.zones.queryFeatures(zq)).features[0];
    if (!zf) return `Zone '${zone}' not found.`;
    const km = radiusKm ?? 150;
    const circle = new Circle({ center: zf.geometry as Point, radius: km, radiusUnit: "kilometers", geodesic: true });
    const sq = layers.stations.createQuery(); sq.geometry = circle; sq.spatialRelationship = "intersects"; sq.where = "stale = 0";
    sq.outFields = ["name", "temp_f", "wind_mph", "gust_mph", "sky_cover_pct"]; sq.returnGeometry = false;
    const st = (await layers.stations.queryFeatures(sq)).features.map((f) => f.attributes);
    const rq = layers.radar.createQuery(); rq.geometry = circle; rq.spatialRelationship = "intersects"; rq.outFields = ["band", "dbz_min", "frame_local"]; rq.returnGeometry = false;
    const rad = (await layers.radar.queryFeatures(rq)).features.map((f) => f.attributes).sort((a, b) => b.dbz_min - a.dbz_min);
    const avg = (k: string) => { const v = st.map((a) => a[k]).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const max = (k: string) => { const v = st.map((a) => a[k]).filter((x) => x != null); return v.length ? Math.round(Math.max(...v)) : null; };
    const hottest = [...st].filter((a) => a.temp_f != null).sort((a, b) => b.temp_f - a.temp_f)[0];
    const ctx = getErcotContext(config);
    if (ctx.focusZone) await ctx.focusZone(label, km);
    return `Replay time ${centralTime(zf.attributes.asof_dt)}. Weather within ${km} km of ${label} (replay of observed weather; layers 'Weather stations' and 'Weather radar').\n` +
      `Stations reporting: ${st.length}. Average temperature ${avg("temp_f") ?? "n/a"} F` + (hottest ? ` (hottest ${hottest.name} ${Math.round(hottest.temp_f)} F)` : "") +
      `, average wind ${avg("wind_mph") ?? "n/a"} mph, strongest gust ${max("gust_mph") ?? "n/a"} mph, average cloud cover ${avg("sky_cover_pct") ?? "n/a"}%.\n` +
      (rad.length ? `Radar (frame ${rad[0].frame_local}): echoes present, strongest band ${rad[0].band}. Bands in range: ${[...new Set(rad.map((a) => a.band))].join(", ")}.`
        : "Radar: no echoes of 20 dBZ or more in range (dry).");
  },
});

export const ercotTools = [zoneStateTool, openAlertsTool, nodalSplitTool, dayAheadTool, weatherTool];
