import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

// Components
import {
  runMealLoggingPipeline,
  runPhotoMealLoggingPipeline,
} from "../services/pipeline";
import FadeIn from "../components/FadeIn";
import PressScale from "../components/PressScale";

// Types
import type { RootStackParamList } from "../types";
type Props = NativeStackScreenProps<RootStackParamList, "LogMeal">;

// Variables
const EXAMPLES = [
  "bir tabak pirinç, tavuk şiş ve çoban salatası",
  "2 eggs and a slice of normal ekmeği",
  "mercimek çorbası and a glass of tea",
];

export default function LogMealScreen({ navigation }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = loading || photoLoading;

  async function handleSubmit() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const entry = await runMealLoggingPipeline(text.trim());
      navigation.navigate("Results", { entry });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleTakePhoto() {
    setError(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      setError("Camera permission is needed to take a photo of your meal.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.6,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      setError("Couldn't read that photo. Please try again.");
      return;
    }

    setPhotoLoading(true);
    try {
      const mimeType = asset.mimeType ?? "image/jpeg";
      const entry = await runPhotoMealLoggingPipeline(
        asset.base64,
        mimeType,
        asset.uri,
      );
      navigation.navigate("Results", { entry });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong analyzing that photo. Please try again.",
      );
    } finally {
      setPhotoLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FadeIn delay={0}>
        <Text style={styles.title}>What did you eat?</Text>
      </FadeIn>
      <FadeIn delay={80}>
        <Text style={styles.subtitle}>
          Describe your meal in your own words — Turkish or English.
        </Text>
      </FadeIn>

      <FadeIn delay={160}>
        <TextInput
          style={styles.input}
          multiline
          placeholder="e.g. bir tabak pirinç, tavuk şiş..."
          placeholderTextColor="#64748B"
          value={text}
          onChangeText={setText}
        />
      </FadeIn>

      <FadeIn delay={240}>
        <View style={styles.examplesRow}>
          {EXAMPLES.map((ex) => (
            <PressScale
              key={ex}
              style={styles.chip}
              scaleTo={0.95}
              onPress={() => setText(ex)}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {ex}
              </Text>
            </PressScale>
          ))}
        </View>
      </FadeIn>

      {error && (
        <FadeIn duration={220} distance={6}>
          <Text style={styles.error}>{error}</Text>
        </FadeIn>
      )}

      <FadeIn delay={300}>
        <PressScale
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={busy}
          scaleTo={0.97}
        >
          {loading ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <Text style={styles.buttonText}>Log Meal</Text>
          )}
        </PressScale>
      </FadeIn>

      <FadeIn delay={340}>
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>
      </FadeIn>

      <FadeIn delay={380}>
        <PressScale
          style={[styles.photoButton, busy && styles.buttonDisabled]}
          onPress={handleTakePhoto}
          disabled={busy}
          scaleTo={0.97}
        >
          {photoLoading ? (
            <>
              <ActivityIndicator color="#4ADE80" />
              <Text style={styles.photoButtonText}>Analyzing photo...</Text>
            </>
          ) : (
            <Text style={styles.photoButtonText}>📷 Take a photo instead</Text>
          )}
        </PressScale>
      </FadeIn>

      <FadeIn delay={440}>
        <PressScale
          style={styles.historyLink}
          scaleTo={0.95}
          onPress={() => navigation.navigate("History")}
        >
          <Text style={styles.historyLinkText}>View history →</Text>
        </PressScale>
      </FadeIn>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    padding: 24,
    paddingTop: 72,
  },
  title: { color: "#F8FAFC", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#94A3B8", fontSize: 15, marginTop: 6, marginBottom: 24 },
  input: {
    backgroundColor: "#1E293B",
    color: "#F8FAFC",
    borderRadius: 16,
    padding: 16,
    minHeight: 120,
    fontSize: 16,
    textAlignVertical: "top",
  },
  examplesRow: { marginTop: 12, gap: 8 },
  chip: {
    backgroundColor: "#1E293B",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  chipText: { color: "#94A3B8", fontSize: 13 },
  error: { color: "#F87171", marginTop: 16 },
  button: {
    backgroundColor: "#4ADE80",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#1E293B" },
  dividerText: { color: "#64748B", fontSize: 12 },
  photoButton: {
    flexDirection: "row",
    backgroundColor: "transparent",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    borderWidth: 1.5,
    borderColor: "#4ADE80",
    gap: 10,
  },
  photoButtonText: { color: "#4ADE80", fontSize: 16, fontWeight: "700" },
  historyLink: { alignItems: "center", marginTop: 20 },
  historyLinkText: { color: "#38BDF8", fontSize: 14 },
});
