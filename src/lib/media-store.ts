import * as FileSystem from 'expo-file-system/legacy';
import { MediaItem } from '../types/media';

const APP_DIR = `${FileSystem.documentDirectory}media-hub/`;
const PHOTOS_DIR = `${APP_DIR}photos/`;
const AUDIOS_DIR = `${APP_DIR}audios/`;
const DB_FILE = `${APP_DIR}media-items.json`;

async function ensureDir(path: string) {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

export async function ensureStorage() {
  await ensureDir(APP_DIR);
  await ensureDir(PHOTOS_DIR);
  await ensureDir(AUDIOS_DIR);

  const dbInfo = await FileSystem.getInfoAsync(DB_FILE);
  if (!dbInfo.exists) {
    await FileSystem.writeAsStringAsync(DB_FILE, JSON.stringify([]));
  }
}

export async function getAllMedia(): Promise<MediaItem[]> {
  await ensureStorage();

  const raw = await FileSystem.readAsStringAsync(DB_FILE);
  const items = safeParseMedia(raw);

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function saveAllMedia(items: MediaItem[]) {
  await ensureStorage();
  await FileSystem.writeAsStringAsync(DB_FILE, JSON.stringify(items, null, 2));
}

export async function addMediaItem(item: MediaItem) {
  const items = await getAllMedia();
  const next = [item, ...items];
  await saveAllMedia(next);
}

export async function updateMediaItem(itemId: string, updates: Partial<MediaItem>) {
  const items = await getAllMedia();
  const next = items.map((item) =>
    item.id === itemId ? ({ ...item, ...updates } as MediaItem) : item
  );
  await saveAllMedia(next);
}

export async function deleteMediaItem(itemOrId: MediaItem | string) {
  try {
    const items = await getAllMedia();
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    const targetItem = typeof itemOrId === 'string' ? items.find((i) => i.id === id) : itemOrId;

    const next = items.filter((current) => current.id !== id);
    await saveAllMedia(next);

    if (targetItem && 'uri' in targetItem && targetItem.uri) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(targetItem.uri);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(targetItem.uri, { idempotent: true });
        }
      } catch (e) {
        console.warn('[media-store] Could not delete physical file:', targetItem.uri, e);
      }
    }
  } catch (err) {
    console.error('[media-store] Error in deleteMediaItem:', err);
    throw err;
  }
}


export async function copyPhotoToAppStorage(sourceUri: string, fileName: string) {
  await ensureStorage();
  const destination = `${PHOTOS_DIR}${fileName}`;
  await FileSystem.copyAsync({
    from: sourceUri,
    to: destination,
  });
  return destination;
}

export async function copyAudioToAppStorage(sourceUri: string, fileName: string) {
  await ensureStorage();
  const destination = `${AUDIOS_DIR}${fileName}`;
  await FileSystem.copyAsync({
    from: sourceUri,
    to: destination,
  });
  return destination;
}

function safeParseMedia(raw: string): MediaItem[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MediaItem[]) : [];
  } catch {
    return [];
  }
}
