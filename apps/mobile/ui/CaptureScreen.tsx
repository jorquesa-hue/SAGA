// React Native capture screen. Built with the RN toolchain (Metro), not the
// repo's tsc/eslint — see apps/mobile/README.md. It binds a dumb UI to the
// tested CaptureController; all offline/never-lose logic lives in the engine.
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Button, FlatList, StyleSheet } from "react-native";
import type { CaptureController, QueueStatus } from "../src/index.js";
import { theme } from "../src/theme.js";

export function CaptureScreen({
  controller,
}: {
  controller: CaptureController;
}): React.ReactElement {
  const [rfid, setRfid] = useState("");
  const [weight, setWeight] = useState("");
  const [status, setStatus] = useState<QueueStatus>({
    pending: 0,
    synced: 0,
    rejected: 0,
  });
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
        <Text style={[styles.badge, styles.synced]}>enviadas: {status.synced}</Text>
        {status.rejected > 0 && (
          <Text style={[styles.badge, styles.warn]}>revisar: {status.rejected}</Text>
        )}
      </View>
      <TextInput
        style={styles.input}
        placeholder="RFID"
        value={rfid}
        onChangeText={setRfid}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Peso (kg)"
        value={weight}
        onChangeText={setWeight}
        keyboardType="numeric"
      />
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

// Every value comes from ../src/theme.ts, which derives from @jk/brand.
// Never hard-code a colour here: the console and the field app share one
// source of truth (docs/brand §3.2).
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.space.lg,
    gap: theme.space.md,
    backgroundColor: theme.color.ground,
  },
  h1: {
    fontSize: theme.fontSize.title,
    fontWeight: "700",
    color: theme.color.text,
  },
  badges: { flexDirection: "row", gap: theme.space.sm, flexWrap: "wrap" },
  // Chips are labelled as well as coloured, so state survives sun glare and
  // colour-blindness (docs/brand §4.1).
  badge: {
    backgroundColor: theme.color.pendingWash,
    color: theme.color.text,
    fontSize: theme.fontSize.caption,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    borderRadius: theme.radius.chip,
    overflow: "hidden",
  },
  synced: { backgroundColor: theme.color.positiveWash },
  warn: { backgroundColor: theme.color.attentionWash },
  input: {
    borderWidth: 1,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.control,
    padding: theme.space.md,
    minHeight: theme.hitSize,
    fontSize: theme.fontSize.data,
    fontFamily: theme.fontFamily.data,
    backgroundColor: theme.color.surface,
    color: theme.color.text,
  },
  sync: { marginTop: theme.space.xs },
  row: {
    paddingVertical: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.rule,
    fontFamily: theme.fontFamily.data,
    fontSize: theme.fontSize.body,
    color: theme.color.text,
  },
});
