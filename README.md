# ERCOT market desk (replay prototype)

A small web app for exploring ERCOT electricity price events on a map, with an AI assistant you can ask questions in plain language ("What is moving ERCOT prices right now?", "Which alerts need attention?", "Is weather involved anywhere?").

**It is a replay, not live data.** The app plays back 20 to 31 August 2026 as if it were happening now. A "REPLAY · NOT LIVE" badge and a replay clock sit in the header, and the assistant is told to say "replay" whenever it gives a time.

## What is in it

- A web map ("ERCOT price events: now") showing price zones, alerts, radar, day-ahead nodal prices and weather stations.
- An assistant panel (the ArcGIS `arcgis-assistant` component, beta) with a custom agent called **ERCOT market desk**. Its tools read the hosted layers directly and cover:
  - `getZoneState`: which zones are unusual right now
  - `getOpenAlerts`: open price alerts, strongest first
  - `getNodalPriceSplit`: gaps between locations, which suggest congestion (day-ahead nodal prices only; real-time nodal prices are not available)
  - `getDayAheadFlags`: the day-ahead outlook
  - `getWeatherNearZone`: weather near a zone
- Built with React 19, Vite 8, TypeScript, the ArcGIS Maps SDK for JavaScript 5.2 (map components) and Calcite.

## Before you run it

The map and layers belong to Jim's ArcGIS Online organization (`esrirenewables`) and are **private**. The app will not show data for you until one of these is true:

1. **You use his organization.** You need an account in that organization, the organization must have AI assistants enabled, and the web map and the two hosted layer services must be shared with you. Ask Jim.
2. **You point it at your own organization.** See "Use your own organization" below.

You also need Node.js 22 LTS and npm. (Built and tested with Node 22.23.)

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in to ArcGIS when asked. Use exactly that address and port: the OAuth sign-in only allows `http://localhost:5173` as a return address.

Other commands: `npm run build` (production build into `dist/`) and `npm run preview`.

## Use your own organization

1. In ArcGIS Online, publish the layers the app reads (see `src/ercotAgent/data.ts`) and a web map that contains them.
2. Register an OAuth 2.0 application item in your organization with `http://localhost:5173` as a redirect URL. Copy its client ID. A browser app has no secret, so there is nothing else to copy.
3. Edit `src/config.ts`: set `PORTAL_URL` (your organization's URL) and `ARCGIS_CLIENT_ID`.
4. Edit `src/ercotAgent/data.ts`: set the two service URLs (`EVENTS` and `EXTRA`) and check the layer numbers.
5. Edit `src/App.tsx`: set `NOW_WEBMAP` to your web map's item ID.
6. Make sure your organization has AI assistants enabled, or the assistant panel will not work.

## Where things are

| Path | What it does |
| --- | --- |
| `src/App.tsx` | Page layout, map, replay clock, assistant panel and suggested prompts |
| `src/auth.ts`, `src/config.ts` | ArcGIS sign-in (OAuth redirect) and the public organization settings |
| `src/ercotAgent/index.ts` | The agent: its instructions and how it should answer |
| `src/ercotAgent/tools.ts` | The agent's tools |
| `src/ercotAgent/data.ts` | Layer URLs and query helpers |
| `src/ercotAgent/context.ts` | What the agent can use from the page (the map) |
| `CLAUDE.md` | Project notes for AI coding assistants |

## Not in this repository

- **The replay feed.** A separate script (`live_feed.py`, in Jim's `ercot-model` project) updates the hosted layers on a timer so the August 2026 data appears to move. Without it the layers show whatever they last held.
- **The data and the models** behind the price-event alerts.

## Credits and licence

- Started from Esri's `ai-components-agent-utils-tools-react` template (`npm init @arcgis`). Check that template's licence before you reuse or redistribute this code. This repository does not set a licence of its own yet.
- AI components are in beta. Answers come from a language model, so check the numbers against the map layers before relying on them.
- The OAuth client ID in `src/config.ts` is public by design. No passwords, tokens or API keys are stored in this repository.
