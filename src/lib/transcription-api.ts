import { Platform } from 'react-native';

interface TranscribeArgs {
  uri: string;
  durationMillis?: number;
}

interface TranscribeResult {
  transcript: string;
  model: string;
}

interface EnrichResult {
  title: string;
  summary: string;
  model: string;
}

const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL;

export async function transcribeAudio({ uri, durationMillis }: TranscribeArgs): Promise<TranscribeResult> {
  if (!apiBaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_TRANSCRIBE_API_URL.');
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

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/transcriptions`, {
    method: 'POST',
    body: formData,
    headers: Platform.OS === 'web' ? { Accept: 'application/json' } : undefined,
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Transcription request failed.';
    throw new Error(message);
  }

  if (!data?.transcript || typeof data.transcript !== 'string') {
    throw new Error('Invalid transcription response.');
  }

  return {
    transcript: data.transcript,
    model: String(data.model ?? ''),
  };
}

export async function enrichTranscript(transcript: string): Promise<EnrichResult> {
  if (!apiBaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_TRANSCRIBE_API_URL.');
  }
  if (!transcript.trim()) {
    throw new Error('Transcript is empty.');
  }

  const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/transcriptions/enrich`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
    },
    body: JSON.stringify({ transcript }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error ?? 'Transcript enrich request failed.';
    throw new Error(message);
  }

  if (!data?.title || !data?.summary) {
    throw new Error('Invalid enrich response.');
  }

  return {
    title: String(data.title),
    summary: String(data.summary),
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
