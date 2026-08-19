import AsyncStorage from "@react-native-async-storage/async-storage";
import { MealLogEntry } from "../types";

const STORAGE_KEY = "eatbetter:mealLogs:v1";

export async function saveMealLog(entry: MealLogEntry): Promise<void> {
  const existing = await getAllMealLogs();
  const withoutDup = existing.filter((e) => e.id !== entry.id);
  const updated = [entry, ...withoutDup];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export async function getAllMealLogs(): Promise<MealLogEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MealLogEntry[];
  } catch {
    return [];
  }
}

export async function deleteMealLog(id: string): Promise<void> {
  const existing = await getAllMealLogs();
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(existing.filter((e) => e.id !== id)),
  );
}
