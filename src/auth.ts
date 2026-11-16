// ArcGIS Online user sign-in (OAuth 2.0, browser redirect). The client ID is public by design; there is no secret.
// The assistant needs a signed-in member of an organization with AI assistants enabled.
import esriConfig from "@arcgis/core/config.js";
import esriId from "@arcgis/core/identity/IdentityManager.js";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo.js";

import { PORTAL_URL as portalUrl, ARCGIS_CLIENT_ID as appId } from "./config";

export async function signIn(): Promise<void> {
  if (!portalUrl || !appId) throw new Error("Set PORTAL_URL and ARCGIS_CLIENT_ID in src/config.ts");
  esriConfig.portalUrl = portalUrl;
  const info = new OAuthInfo({ appId, portalUrl, popup: false, flowType: "auto" });
  esriId.registerOAuthInfos([info]);
  const sharing = `${info.portalUrl}/sharing`;
  try {
    await esriId.checkSignInStatus(sharing);
  } catch {
    await esriId.getCredential(sharing); // redirects to the ArcGIS sign-in page and back
  }
}
