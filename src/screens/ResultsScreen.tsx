import React, { useState } from "react";
import {
  Image,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// Services
import { saveMealLog } from "../services/storage";
import { logEvent } from "../services/logger";

// Components
import FadeIn from "../components/FadeIn";
import PressScale from "../components/PressScale";

// Types
import type { RootStackParamList } from "../types";
import { CanonicalFood, MatchedFoodItem } from "../types";
type Props = NativeStackScreenProps<RootStackParamList, "Results">;

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Variables
const CONFIDENCE_COLORS: Record<string, string> = {
  high: "#4ADE80",
  medium: "#FACC15",
  low: "#F87171",
};

const EASE_LAYOUT = LayoutAnimation.create(
  220,
  LayoutAnimation.Types.easeInEaseOut,
  LayoutAnimation.Properties.opacity,
);

function recalc(
  item: MatchedFoodItem,
  newFood: CanonicalFood,
): MatchedFoodItem {
  const grams = newFood.gramsPerUnit; // reassignment always resets to one default serving
  return {
    ...item,
    matchedFood: newFood,
    matchScore: 1, // user-confirmed => treat as ground truth going forward
    confidence: "high",
    estimatedGrams: grams,
    nutrition: {
      kcal: Math.round((newFood.nutritionPer100g.kcal * grams) / 100),
      proteinG: Math.round((newFood.nutritionPer100g.proteinG * grams) / 100),
      carbsG: Math.round((newFood.nutritionPer100g.carbsG * grams) / 100),
      fatG: Math.round((newFood.nutritionPer100g.fatG * grams) / 100),
    },
    needsUserConfirmation: false,
  };
}

export default function ResultsScreen({ route, navigation }: Props) {
  const [entry, setEntry] = useState(route.params.entry);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleExpanded(idx: number) {
    LayoutAnimation.configureNext(EASE_LAYOUT);
    setExpandedIdx(expandedIdx === idx ? null : idx);
  }

  function handleCorrect(itemIdx: number, newFood: CanonicalFood) {
    const updatedItems = entry.items.map((it, i) =>
      i === itemIdx ? recalc(it, newFood) : it,
    );
    const total = updatedItems.reduce(
      (acc, it) => ({
        kcal: acc.kcal + (it.nutrition?.kcal ?? 0),
        proteinG: acc.proteinG + (it.nutrition?.proteinG ?? 0),
        carbsG: acc.carbsG + (it.nutrition?.carbsG ?? 0),
        fatG: acc.fatG + (it.nutrition?.fatG ?? 0),
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    );
    logEvent({
      traceId: entry.traceId,
      stage: "user_correction",
      payload: {
        originalGuess: entry.items[itemIdx].extracted.foodGuess,
        correctedTo: newFood.canonicalName,
        previousConfidence: entry.items[itemIdx].confidence,
      },
    });
    LayoutAnimation.configureNext(EASE_LAYOUT);
    setEntry({
      ...entry,
      items: updatedItems,
      totalNutrition: total,
      userCorrected: true,
    });
    setExpandedIdx(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveMealLog(entry);
      navigation.navigate("History");
    } finally {
      setSaving(false);
    }
  }

  const baseDelay = entry.source === "photo" ? 150 : 80;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 24, paddingTop: 64 }}
    >
      <PressScale
        style={styles.backButton}
        scaleTo={0.94}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </PressScale>

      {entry.source === "photo" && entry.imageUri && (
        <FadeIn delay={0} distance={20}>
          <Image source={{ uri: entry.imageUri }} style={styles.photo} />
        </FadeIn>
      )}

      <FadeIn delay={entry.source === "photo" ? 70 : 0}>
        <Text style={styles.title}>Here's what I found</Text>
        {entry.source === "photo" ? (
          <Text style={styles.aiDescription}>{entry.aiDescription}</Text>
        ) : (
          <Text style={styles.rawInput}>"{entry.rawInput}"</Text>
        )}
      </FadeIn>

      {entry.items.length === 0 && (
        <FadeIn delay={baseDelay}>
          <Text style={styles.empty}>
            No food items detected. Try describing your meal differently.
          </Text>
        </FadeIn>
      )}

      {entry.items.map((item, idx) => (
        <FadeIn key={idx} delay={baseDelay + idx * 90} distance={20}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.foodName}>
                {item.matchedFood?.canonicalName ??
                  `Unmatched: "${item.extracted.foodGuess}"`}
              </Text>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: CONFIDENCE_COLORS[item.confidence] },
                ]}
              >
                <Text style={styles.badgeText}>{item.confidence}</Text>
              </View>
            </View>
            <Text style={styles.sourcePhrase}>
              from: "{item.extracted.rawPhrase}"
            </Text>

            {item.nutrition && (
              <Text style={styles.nutritionLine}>
                ~{item.estimatedGrams}g · {item.nutrition.kcal} kcal · P
                {item.nutrition.proteinG} C{item.nutrition.carbsG} F
                {item.nutrition.fatG}
              </Text>
            )}

            {item.needsUserConfirmation && (
              <>
                <PressScale
                  style={styles.confirmPrompt}
                  scaleTo={0.97}
                  onPress={() => toggleExpanded(idx)}
                >
                  <Text style={styles.confirmPromptText}>
                    {expandedIdx === idx
                      ? "Cancel"
                      : "Not right? Tap to pick the correct food →"}
                  </Text>
                </PressScale>
                {expandedIdx === idx && (
                  <View style={styles.alternatives}>
                    {item.candidateAlternatives.map((alt) => (
                      <PressScale
                        key={alt.food.id}
                        style={styles.altRow}
                        scaleTo={0.97}
                        onPress={() => handleCorrect(idx, alt.food)}
                      >
                        <Text style={styles.altName}>
                          {alt.food.canonicalName}
                        </Text>
                        <Text style={styles.altScore}>
                          {Math.round(alt.score * 100)}%
                        </Text>
                      </PressScale>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        </FadeIn>
      ))}

      {entry.items.length > 0 && (
        <FadeIn delay={baseDelay + entry.items.length * 90} distance={20}>
          <View style={styles.totalCard}>
            <Text style={styles.totalTitle}>Total</Text>
            <Text style={styles.totalLine}>
              {entry.totalNutrition.kcal} kcal · P
              {entry.totalNutrition.proteinG}g C{entry.totalNutrition.carbsG}g F
              {entry.totalNutrition.fatG}g
            </Text>
          </View>
        </FadeIn>
      )}

      <PressScale
        style={styles.saveButton}
        scaleTo={0.97}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.saveButtonText}>
          {saving ? "Saving..." : "Save Meal"}
        </Text>
      </PressScale>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  backButton: { marginBottom: 12, alignSelf: "flex-start" },
  backButtonText: { color: "#38BDF8", fontSize: 15, fontWeight: "600" },
  title: { color: "#F8FAFC", fontSize: 24, fontWeight: "700" },
  rawInput: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 20,
    fontStyle: "italic",
  },
  empty: { color: "#94A3B8", fontSize: 15, marginTop: 20 },
  photo: {
    width: "100%",
    height: 220,
    borderRadius: 16,
    marginBottom: 16,
    backgroundColor: "#1E293B",
  },
  aiDescription: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 20,
  },
  card: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  foodName: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  sourcePhrase: { color: "#64748B", fontSize: 12, marginTop: 4 },
  nutritionLine: { color: "#CBD5E1", fontSize: 13, marginTop: 8 },
  confirmPrompt: { marginTop: 10 },
  confirmPromptText: { color: "#38BDF8", fontSize: 13 },
  alternatives: { marginTop: 8, gap: 6 },
  altRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#0F172A",
    borderRadius: 10,
    padding: 10,
  },
  altName: { color: "#F8FAFC", fontSize: 14 },
  altScore: { color: "#64748B", fontSize: 13 },
  totalCard: {
    backgroundColor: "#1E293B",
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    marginBottom: 24,
  },
  totalTitle: { color: "#94A3B8", fontSize: 13, marginBottom: 4 },
  totalLine: { color: "#F8FAFC", fontSize: 18, fontWeight: "700" },
  saveButton: {
    backgroundColor: "#4ADE80",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveButtonText: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
});
