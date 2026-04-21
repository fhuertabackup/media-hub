import { Platform } from 'react-native';

interface AudioAiQueryArgs {
  uri: string;
  prompt: string;
  durationMillis?: number;
}

interface AudioAiQueryResult {
  answer: string;
  model: string;
}

const PRODUCTION_API_URL = 'https://media-hub-production.up.railway.app';
const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL || PRODUCTION_API_URL;
const audioAiEnabled = process.env.EXPO_PUBLIC_AUDIO_AI_ENABLED === 'true';

export function isAudioAiEnabledOnClient() {
  return audioAiEnabled;
}

export async function queryAudioWithAi({
  uri,
  prompt,
  durationMillis,
}: AudioAiQueryArgs): Promise<AudioAiQueryResult> {
  if (!audioAiEnabled) {
    throw new Error('Audio AI feature is disabled.');
  }

  const formData = new FormData();
  const fileName = makeFileName(uri);
  const mimeType = inferMimeType(uri);

  formData.append(
    'audio',
    {
      uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob
  );
  formData.append('durationMillis', String(durationMillis ?? 0));
  formData.append('prompt', prompt);

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/audio-ai/query`, {
    method: 'POST',
    body: formData,
    headers: Platform.OS === 'web' ? { Accept: 'application/json' } : undefined,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Audio AI request failed.';
    throw new Error(message);
  }

  if (!data?.answer || typeof data.answer !== 'string') {
    throw new Error('Invalid Audio AI response.');
  }

  return {
    answer: data.answer,
    model: String(data.model ?? ''),
  };
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function makeFileName(uri: string) {
  const fromUri = uri.split('/').pop();
  if (fromUri && fromUri.includes('.')) return fromUri;
  return `recording-${Date.now()}.m4a`;
}

function inferMimeType(uri: string) {
  const ext = uri.split('.').pop()?.toLowerCase();
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  return 'audio/mp4';
}
