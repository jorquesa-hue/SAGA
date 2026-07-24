// React Native capture screen. Built with the RN toolchain (Metro), not the
// repo's tsc/eslint — see apps/mobile/README.md. It binds a dumb UI to the
// tested CaptureController; all offline/never-lose logic lives in the engine.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Button, FlatList, StyleSheet } from "react-native";
import type { CaptureController, QueueStatus } from "../src/index.js";

export function CaptureScreen({ controller }: { controller: CaptureController }): React.ReactElement {
  const [rfid, setRfid] = useState("");
  const [weight, setWeight] = useState("");
  const [status, setStatus] = useState<QueueStatus>({ pending: 0, synced: 0, rejected: 0 });
  const [recent, setRecent] = useState<string[]>([]);

  const refresh = async (): Promise<void> => setStatus(await controller.status());
  useEffect(() => {
    void refresh();
  }, []);

  const capture = async (): Promise<void> => {
    const kg = Number(weight);
    if (!rfid || !Number.isFinite(kg)) return;
    const { id } = await controller.captureWeight({ rfid, weightKg: kg });
    setRecent((r) => [`${rfid} · ${kg} kg`, ...r].slice(0, 20));
    setWeight("");
    void refresh();
    void id;
  };

  const sync = async (): Promise<void> => {
    await controller.sync();
    void refresh();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Pesagem</Text>
      <View style={styles.badges}>
        <Text style={styles.badge}>fila: {status.pending}</Text>
        <Text style={styles.badge}>enviadas: {status.synced}</Text>
        {status.rejected > 0 && <Text style={[styles.badge, styles.warn]}>revisar: {status.rejected}</Text>}
      </View>
      <TextInput style={styles.input} placeholder="RFID" value={rfid} onChangeText={setRfid} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Peso (kg)" value={weight} onChangeText={setWeight} keyboardType="numeric" />
      <Button title="Capturar" onPress={capture} />
      <View style={styles.sync}>
        <Button title={`Sincronizar (${status.pending})`} onPress={sync} />
      </View>
      <FlatList
        data={recent}
        keyExtractor={(item, i) => `${i}-${item}`}
        renderItem={({ item }) => <Text style={styles.row}>{item}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 10 },
  h1: { fontSize: 22, fontWeight: "700" },
  badges: { flexDirection: "row", gap: 8 },
  badge: { backgroundColor: "#1e2b38", color: "#e6edf3", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  warn: { backgroundColor: "#6b2b2b" },
  input: { borderWidth: 1, borderColor: "#2b3947", borderRadius: 8, padding: 10 },
  sync: { marginTop: 4 },
  row: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#2b3947" },
});
