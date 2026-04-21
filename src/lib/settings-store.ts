import * as FileSystem from 'expo-file-system/legacy';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../types/app-settings';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const APP_DIR = `${FileSystem.documentDirectory}media-hub/`;
const SETTINGS_FILE = `${APP_DIR}settings.json`;

async function ensureDir(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

async function ensureSettingsFile() {
  await ensureDir(APP_DIR);
  const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(DEFAULT_APP_SETTINGS, null, 2));
  }
}

export async function getAppSettings(): Promise<AppSettings> {
  await ensureSettingsFile();
  const raw = await FileSystem.readAsStringAsync(SETTINGS_FILE);

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const settings: AppSettings = {
      personName: parsed.personName ?? '',
      personInfo: parsed.personInfo ?? '',
      emergencyContactName: parsed.emergencyContactName ?? '',
      emergencyEmail: parsed.emergencyEmail ?? '',
      deviceId: parsed.deviceId || generateUUID(),
    };
    if (!parsed.deviceId) {
      await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    }
    return settings;
  } catch {
    const settings = { ...DEFAULT_APP_SETTINGS, deviceId: generateUUID() };
    await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(() => {});
    return settings;
  }
}

export async function saveAppSettings(settings: AppSettings) {
  await ensureSettingsFile();
  await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export async function getDeviceId(): Promise<string> {
  const settings = await getAppSettings();
  return settings.deviceId;
}
