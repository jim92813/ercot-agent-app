import "./index.css";

import React, { useEffect, useRef, useState } from "react";

import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-expand";

import "@esri/calcite-components/components/calcite-shell";
import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-shell-panel";
import "@esri/calcite-components/components/calcite-chip";
import "@esri/calcite-components/components/calcite-loader";
import "@esri/calcite-components/components/calcite-notice";

import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-agent";
import "@arcgis/ai-components/components/arcgis-assistant-navigation-agent";

import type { ArcgisMap } from "@arcgis/map-components/components/arcgis-map";
import WebMap from "@arcgis/core/WebMap.js";
import Point from "@arcgis/core/geometry/Point.js";

import { signIn } from "./auth";
import { ErcotAgent } from "./ercotAgent";
import { layers, replayTime, sqlText } from "./ercotAgent/data";

const NOW_WEBMAP = "36c176ae86ac4b30b589bd7e7815a653"; // "ERCOT price events: now" (zones, alerts, radar, nodal prices, stations)

function Ready(): React.JSX.Element {
  const mapElementRef = useRef<ArcgisMap | null>(null);
  const [map] = useState(() => new WebMap({ portalItem: { id: NOW_WEBMAP } }));
  const [clock, setClock] = useState<string>("…");

  // replay clock: the newest time on the zones layer, polled at the feed's pace
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try { const t = await replayTime(); if (alive) setClock(t); } catch { /* keep last value */ }
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const focusZone = async (label: string, radiusKm?: number) => {
    const el = mapElementRef.current;
    if (!el) return;
    const q = layers.zones.createQuery();
    q.where = `label = '${sqlText(label)}'`; q.returnGeometry = true; q.outFields = ["label"];
    const f = (await layers.zones.queryFeatures(q)).features[0];
    if (f) await el.goTo({ target: f.geometry as Point, zoom: radiusKm && radiusKm > 200 ? 6 : 7 }, { duration: 800 });
  };

  return (
    <calcite-shell>
      <header slot="header" className="app-header">
        <span className="title">ERCOT price events</span>
        <calcite-chip className="replay" scale="s" kind="brand" label="Replay, not live">REPLAY · NOT LIVE</calcite-chip>
        <span className="clock-label">Replay clock</span>
        <span className="clock" aria-live="polite">{clock}</span>
        <span className="sub">August 2026 played back as if live · agent prototype</span>
      </header>

      <calcite-shell-panel slot="panel-end" id="assistant-panel" resizable>
        <calcite-panel>
          <arcgis-assistant
            reference-element="#main-map"
            heading="Ask the ERCOT desk"
            description="Ask about prices, alerts, what is coming, congestion and weather. Answers use the replay layers on the map."
            entryMessage="Replay of August 2026, played as if live. Try one of the suggestions, or ask your own question."
            suggestedPrompts={[
              "What is moving ERCOT prices right now?",
              "Which alerts need attention?",
              "Is weather involved anywhere?",
              "What does the day-ahead outlook flag for Houston?",
              "Where is congestion showing up in nodal prices?",
            ]}
            keep-suggested-prompts
            log-enabled
          >
            <arcgis-assistant-navigation-agent></arcgis-assistant-navigation-agent>
            <arcgis-assistant-agent
              agent={ErcotAgent}
              context={async () => {
                const mapElement = mapElementRef.current!;
                await mapElement.componentOnReady();
                await mapElement.viewOnReady();
                return { mapElement, focusZone };
              }}
            ></arcgis-assistant-agent>
          </arcgis-assistant>
        </calcite-panel>
      </calcite-shell-panel>

      <arcgis-map id="main-map" ref={mapElementRef} map={map}>
        <arcgis-zoom slot="top-left"></arcgis-zoom>
        <arcgis-home slot="top-left"></arcgis-home>
        <arcgis-expand slot="top-right" expand-tooltip="Layers" expand-icon="layers">
          <arcgis-layer-list></arcgis-layer-list>
        </arcgis-expand>
        <arcgis-expand slot="bottom-left" expand-tooltip="Legend" expand-icon="legend">
          <arcgis-legend></arcgis-legend>
        </arcgis-expand>
      </arcgis-map>
    </calcite-shell>
  );
}

function App(): React.JSX.Element {
  const [state, setState] = useState<"signing-in" | "ready" | "error">("signing-in");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    signIn().then(() => setState("ready")).catch((e) => { setError(String(e?.message ?? e)); setState("error"); });
  }, []);

  if (state === "ready") return <Ready />;
  return (
    <div className="gate">
      {state === "signing-in" ? <calcite-loader label="Signing in to ArcGIS" text="Signing in to ArcGIS…"></calcite-loader>
        : <calcite-notice open kind="danger" icon="exclamation-mark-triangle"><div slot="title">Sign-in failed</div><div slot="message">{error}</div></calcite-notice>}
    </div>
  );
}

export default App;
