import React, { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";

// Services
import { getAllMealLogs, deleteMealLog } from "../services/storage";

// Components
import FadeIn from "../components/FadeIn";
import PressScale from "../components/PressScale";
import HistoryCard from "../components/HistoryCard";

// Types
import { MealLogEntry } from "../types";
type Props = NativeStackScreenProps<RootStackParamList, "History">;

export default function HistoryScreen({ navigation }: Props) {
  const [logs, setLogs] = useState<MealLogEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      getAllMealLogs().then(setLogs);
    }, []),
  );

  async function handleDelete(id: string) {
    await deleteMealLog(id);
    setLogs((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <View style={styles.container}>
      <FadeIn>
        <View style={styles.header}>
          <Text style={styles.title}>History</Text>
          <PressScale
            scaleTo={0.94}
            onPress={() => navigation.navigate("LogMeal")}
          >
            <Text style={styles.newLink}>+ New</Text>
          </PressScale>
        </View>
      </FadeIn>

      <FlatList
        contentContainerStyle={{ padding: 24, paddingTop: 8 }}
        data={logs}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <FadeIn delay={100}>
            <Text style={styles.empty}>No meals logged yet.</Text>
          </FadeIn>
        }
        renderItem={({ item, index }) => (
          <HistoryCard item={item} index={index} onDelete={handleDelete} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A", paddingTop: 64 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  title: { color: "#F8FAFC", fontSize: 24, fontWeight: "700" },
  newLink: { color: "#38BDF8", fontSize: 14, fontWeight: "600" },
  empty: { color: "#94A3B8", fontSize: 15, marginTop: 20 },
});
