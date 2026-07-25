// React Native entry. Wires the device adapters (AsyncStorage LocalStore + HTTP
// transport to the platform API) into the CaptureController and renders the
// capture screen. Run with the RN toolchain (see apps/mobile/README.md).
import React, { useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native";
import { JkPlatformClient } from "@jk/contracts-rest";
import { AsyncKvLocalStore, CaptureController, HttpSyncTransport } from "../src/index.js";
import { CaptureScreen } from "./CaptureScreen.js";
import { theme } from "../src/theme.js";

const API_BASE_URL = "https://api.saga.example"; // configured per build/environment

export default function App(): React.ReactElement {
  const controller = useMemo(() => {
    // On device, the dev-auth seam is replaced by an OIDC bearer token.
    const client = new JkPlatformClient({
      baseUrl: API_BASE_URL,
      auth: { mode: "bearer", getToken: async () => getSessionToken() },
      tenantId: getActiveTenantId(),
    });
    const store = new AsyncKvLocalStore(AsyncStorage);
    return new CaptureController(store, new HttpSyncTransport(client), {
      gatewayId: "mobile",
    });
  }, []);

  return (
    // The brand ground reaches the safe area, so the status-bar inset is not
    // a bare white strip above a paper screen (docs/brand §3.2).
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.color.ground }}>
      <CaptureScreen controller={controller} />
    </SafeAreaView>
  );
}

// Provided by the app's auth/session layer (placeholders for the shell).
function getSessionToken(): string {
  return "";
}
function getActiveTenantId(): string {
  return "";
}
