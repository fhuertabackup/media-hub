import * as FileSystem from 'expo-file-system/legacy';
import { AppSettings, DEFAULT_APP_SETTINGS } from '../types/app-settings';

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
    return {
      personName: parsed.personName ?? '',
      personInfo: parsed.personInfo ?? '',
      emergencyContactName: parsed.emergencyContactName ?? '',
      emergencyEmail: parsed.emergencyEmail ?? '',
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export async function saveAppSettings(settings: AppSettings) {
  await ensureSettingsFile();
  await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}
