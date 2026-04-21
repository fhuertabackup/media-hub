import { Platform } from 'react-native';
import { PhotoPrescriptionParsed } from '../types/ocr';
import { getDeviceId } from './settings-store';

interface OcrPhotoArgs {
  uri: string;
}

interface OcrPhotoResult {
  text: string;
  model: string;
  parsed?: PhotoPrescriptionParsed;
}

interface PhotoTitleResult {
  title: string;
  model: string;
}

const PRODUCTION_API_URL = 'https://media-hub-production.up.railway.app';
const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL || PRODUCTION_API_URL;

export async function ocrPhoto({ uri }: OcrPhotoArgs): Promise<OcrPhotoResult> {
  const deviceId = await getDeviceId();
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

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/photos/ocr`, {
    method: 'POST',
    body: formData,
    headers: {
      'x-device-id': deviceId,
      ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Photo OCR request failed.';
    throw new Error(message);
  }

  if (!data?.text || typeof data.text !== 'string') {
    throw new Error('Invalid OCR response.');
  }

  return {
    text: data.text,
    model: String(data.model ?? ''),
    parsed: data?.parsed ? (data.parsed as PhotoPrescriptionParsed) : undefined,
  };
}

export async function generatePhotoGroupTitle(text: string): Promise<PhotoTitleResult> {
  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/photos/title`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
    },
    body: JSON.stringify({ text }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Photo title request failed.';
    throw new Error(message);
  }

  if (!data?.title || typeof data.title !== 'string') {
    throw new Error('Invalid photo title response.');
  }

  return {
    title: data.title,
    model: String(data.model ?? ''),
  };
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function makeFileName(uri: string) {
  const fromUri = uri.split('/').pop();
  if (fromUri && fromUri.includes('.')) return fromUri;
  return `photo-${Date.now()}.jpg`;
}

function inferMimeType(uri: string) {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}
