import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { MealLogEntry } from "../types";
import PressScale from "./PressScale";

type Props = {
  item: MealLogEntry;
  index: number;
  onDelete: (id: string) => void;
};

export default function HistoryCard({ item, index, onDelete }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay: Math.min(index, 8) * 60,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        delay: Math.min(index, 8) * 60,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDelete() {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 0.9,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => onDelete(item.id));
  }

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }, { scale }],
      }}
    >
      <PressScale style={styles.card} scaleTo={0.98} onPress={() => {}}>
        <View style={styles.row}>
          {item.source === "photo" && item.imageUri && (
            <Image source={{ uri: item.imageUri }} style={styles.thumb} />
          )}
          <View style={styles.rowText}>
            <Text style={styles.rawInput} numberOfLines={2}>
              {item.source === "photo" ? "📷 " : ""}
              {item.rawInput}
            </Text>
            <Text style={styles.meta}>
              {new Date(item.createdAt).toLocaleString()} · {item.totalNutrition.kcal} kcal
              {item.userCorrected ? " · corrected" : ""}
            </Text>
          </View>
        </View>
        <PressScale scaleTo={0.94} onPress={handleDelete}>
          <Text style={styles.delete}>Delete</Text>
        </PressScale>
      </PressScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#1E293B", borderRadius: 16, padding: 16, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1 },
  thumb: { width: 48, height: 48, borderRadius: 10, backgroundColor: "#0F172A" },
  rawInput: { color: "#F8FAFC", fontSize: 15 },
  meta: { color: "#94A3B8", fontSize: 12, marginTop: 6 },
  delete: { color: "#F87171", fontSize: 12, marginTop: 8 },
});
