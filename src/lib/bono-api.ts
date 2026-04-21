import { Platform } from 'react-native';
import { BonoParsed } from '../types/ocr';

interface BonoPhotoArgs {
  uri: string;
}

interface BonoPhotoResult {
  text: string;
  model: string;
  parsed?: BonoParsed;
}

const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL;

export async function analyzeBonoPhoto({ uri }: BonoPhotoArgs): Promise<BonoPhotoResult> {
  if (!apiBaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_TRANSCRIBE_API_URL.');
  }

  const formData = new FormData();
  const fileName = makeFileName(uri);
  const mimeType = inferMimeType(uri);

  formData.append(
    'photo',
    {
      uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob
  );

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/bonos/analyze`, {
    method: 'POST',
    body: formData,
    headers: Platform.OS === 'web' ? { Accept: 'application/json' } : undefined,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Bono analyze request failed.';
    throw new Error(message);
  }

  return {
    text: String(data?.text ?? ''),
    model: String(data?.model ?? ''),
    parsed: data?.parsed ? (data.parsed as BonoParsed) : undefined,
  };
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function makeFileName(uri: string) {
  const fromUri = uri.split('/').pop();
  if (fromUri && fromUri.includes('.')) return fromUri;
  return `bono-${Date.now()}.jpg`;
}

function inferMimeType(uri: string) {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}
