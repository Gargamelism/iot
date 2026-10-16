"use server";
// Every write the UI makes. localhost-only, single user: no auth by design.
import { refresh } from "next/cache";
import { store } from "@/lib/db";

export async function toggleMilestone(moduleId: string, milestoneId: string, checked: boolean) {
  store.setMilestone(moduleId, milestoneId, checked);
  refresh();
}

export async function saveNote(moduleId: string, slot: string, body: string) {
  store.saveNote(moduleId, slot, body);
}

export async function savePreset(playgroundId: string, name: string, json: string) {
  store.savePreset(playgroundId, name, json);
  return store.presets(playgroundId);
}

export async function deletePreset(playgroundId: string, name: string) {
  store.deletePreset(playgroundId, name);
  return store.presets(playgroundId);
}

export async function setStartDate(formData: FormData) {
  const date = String(formData.get("startDate") ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) store.setSetting("startDate", date);
  refresh();
}
