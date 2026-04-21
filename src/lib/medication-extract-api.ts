import { Platform } from 'react-native';

const PRODUCTION_API_URL = 'https://media-hub-production.up.railway.app';
const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL || PRODUCTION_API_URL;

export async function extractMedicationNames(text: string): Promise<string[]> {
  const clean = text.trim();
  if (!clean || clean === '[SIN_TEXTO]') return [];

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/medications/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
    },
    body: JSON.stringify({ text: clean }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return [];
  }
  if (!data?.medications || !Array.isArray(data.medications)) {
    return [];
  }

  return data.medications
    .map((item: unknown) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
