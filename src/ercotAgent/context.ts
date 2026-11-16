import type { ArcgisMap } from "@arcgis/map-components/components/arcgis-map";

/** Context the app supplies to the ERCOT agent through the arcgis-assistant-agent `context` provider. */
export type ErcotContext = {
  mapElement: ArcgisMap;
  /** Pan and zoom the map to a zone (by label), optionally showing a radius in km. */
  focusZone?: (label: string, radiusKm?: number) => Promise<void>;
};

type AgentExecutionConfigLike = { configurable?: Record<string, unknown> };

export function getErcotContext(config?: AgentExecutionConfigLike): ErcotContext {
  const context = config?.configurable?.context;
  if (!context || typeof context !== "object" || !("mapElement" in context)) {
    throw new Error("ERCOT agent context missing: mapElement");
  }
  return context as ErcotContext;
}
