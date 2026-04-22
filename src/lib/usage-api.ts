import { getDeviceId } from './settings-store';

export interface UsageMetric {
  used: number;
  max: number;
}

export interface UsageStats {
  plan: string;
  usage: {
    receta: UsageMetric;
    bono: UsageMetric;
    transcripcion: UsageMetric;
  };
}

const PRODUCTION_API_URL = 'https://media-hub-production.up.railway.app';
const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL || PRODUCTION_API_URL;

export async function fetchUsageStats(): Promise<UsageStats> {
  const deviceId = await getDeviceId();
  const url = `${normalizeBaseUrl(apiBaseUrl)}/api/usage/stats`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-device-id': deviceId,
      'Accept': 'application/json',
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? 'Failed to fetch usage stats');
  }

  return data as UsageStats;
}

export async function checkUsageLimit(action: keyof UsageStats['usage']): Promise<boolean> {
  try {
    const stats = await fetchUsageStats();
    const metric = stats.usage[action];
    return metric.used < metric.max;
  } catch (err) {
    console.warn('[usage-api] Error checking limits, allowing as fallback:', err);
    return true; // Allow if server is down (let the main call handle it)
  }
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
