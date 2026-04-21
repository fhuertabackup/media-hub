import { Platform } from 'react-native';

interface LookupArgs {
  latitud: number;
  longitud: number;
  medications: string[];
}

export interface FonasaPriceItem {
  id?: number;
  nombreMedicamento: string;
  principioActivo1?: string;
  registroSanitario?: string;
  presentacion?: string;
  formaFarmaceutica?: string;
  laboratorio?: string;
  ofertaFonasa?: number;
}

export interface FonasaLookupResult {
  query: string;
  bestPrice: number | null;
  itemCount: number;
  items: FonasaPriceItem[];
}

interface LookupResponse {
  provider: 'fonasa';
  results: FonasaLookupResult[];
}

interface DetailArgs {
  latitud: number;
  longitud: number;
  nombreMedicamento: string;
  registroSanitario: string;
  presentacion: string;
  laboratorio: string;
}

export interface FonasaPharmacyDetail {
  farmacia: string;
  nombreSucursal: string;
  direccion: string;
  comuna: string;
  ciudad: string;
  region: string;
  distancia?: number;
  latitud?: number;
  longitud?: number;
  ofertaFonasa?: number;
  precioNormal?: number;
  ahorro?: number;
}

const PRODUCTION_API_URL = 'https://media-hub-production.up.railway.app';
const apiBaseUrl = process.env.EXPO_PUBLIC_TRANSCRIBE_API_URL || PRODUCTION_API_URL;

export async function lookupFonasaPrices({
  latitud,
  longitud,
  medications,
}: LookupArgs): Promise<LookupResponse> {
  const fallback = () => lookupFonasaPricesDirect({ latitud, longitud, medications });

  try {
    const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/prices/fonasa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
      },
      body: JSON.stringify({ latitud, longitud, medications }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return fallback();
    }

    if (!data?.results || !Array.isArray(data.results)) {
      return fallback();
    }

    return {
      provider: 'fonasa',
      results: data.results as FonasaLookupResult[],
    };
  } catch {
    return fallback();
  }
}

function normalizeBaseUrl(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function lookupFonasaDetail({
  latitud,
  longitud,
  nombreMedicamento,
  registroSanitario,
  presentacion,
  laboratorio,
}: DetailArgs): Promise<FonasaPharmacyDetail[]> {
  const fallback = () =>
    lookupFonasaDetailDirect({
      latitud,
      longitud,
      nombreMedicamento,
      registroSanitario,
      presentacion,
      laboratorio,
    });

  try {
    const response = await fetch(`${normalizeBaseUrl(apiBaseUrl)}/api/prices/fonasa/detail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(Platform.OS === 'web' ? { Accept: 'application/json' } : {}),
      },
      body: JSON.stringify({
        latitud,
        longitud,
        nombreMedicamento,
        registroSanitario,
        presentacion,
        laboratorio,
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.pharmacies)) {
      return fallback();
    }

    return data.pharmacies as FonasaPharmacyDetail[];
  } catch {
    return fallback();
  }
}

async function lookupFonasaPricesDirect({
  latitud,
  longitud,
  medications,
}: LookupArgs): Promise<LookupResponse> {
  const results = await Promise.all(
    medications.map((query) => lookupFonasaMedicationDirect({ latitud, longitud, query }))
  );

  return {
    provider: 'fonasa',
    results,
  };
}

async function lookupFonasaMedicationDirect({
  latitud,
  longitud,
  query,
}: {
  latitud: number;
  longitud: number;
  query: string;
}): Promise<FonasaLookupResult> {
  const response = await fetch('https://api.fonasa.cl/medicamentos/obtener', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitud: String(latitud),
      longitud: String(longitud),
      nombreMedicamento: query,
      principioActivo: null,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return { query, bestPrice: null, itemCount: 0, items: [] };
  }

  const items = normalizeFonasaItems(data);
  const priced = items.filter((item) => Number.isFinite(item.ofertaFonasa));
  const bestPrice = priced.length
    ? Math.min(...priced.map((item) => Number(item.ofertaFonasa)))
    : null;

  return {
    query,
    bestPrice,
    itemCount: items.length,
    items: items.slice(0, 8),
  };
}

function normalizeFonasaItems(data: any): FonasaPriceItem[] {
  const listado = Array.isArray(data?.listado) ? data.listado : [];
  const out: FonasaPriceItem[] = [];

  for (const registro of listado) {
    const presentaciones = Array.isArray(registro?.presentacionesExistentes)
      ? registro.presentacionesExistentes
      : [];
    for (const presentacion of presentaciones) {
      const productos = Array.isArray(presentacion?.productos) ? presentacion.productos : [];
      for (const producto of productos) {
        const price = Number(producto?.ofertaFonasa);
        out.push({
          id: Number(producto?.id) || undefined,
          nombreMedicamento: String(producto?.nombreMedicamento ?? '').trim(),
          principioActivo1: String(producto?.principioActivo1 ?? '').trim(),
          registroSanitario: String(producto?.registroSanitario ?? '').trim(),
          presentacion: String(producto?.presentacion ?? '').trim(),
          formaFarmaceutica: String(producto?.formaFarmaceutica ?? '').trim(),
          laboratorio: String(producto?.laboratorio ?? '').trim(),
          ofertaFonasa: Number.isFinite(price) ? price : undefined,
        });
      }
    }
  }

  return out.sort(
    (a, b) => (a.ofertaFonasa ?? Number.MAX_SAFE_INTEGER) - (b.ofertaFonasa ?? Number.MAX_SAFE_INTEGER)
  );
}

async function lookupFonasaDetailDirect({
  latitud,
  longitud,
  nombreMedicamento,
  registroSanitario,
  presentacion,
  laboratorio,
}: DetailArgs): Promise<FonasaPharmacyDetail[]> {
  const response = await fetch('https://api.fonasa.cl/medicamentos/detalle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitud,
      longitud,
      nombreMedicamento,
      registroSanitario,
      presentacion,
      laboratorio,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) return [];

  return normalizeFonasaDetail(data);
}

function normalizeFonasaDetail(data: any): FonasaPharmacyDetail[] {
  const groups = Array.isArray(data?.Farmacias) ? data.Farmacias : [];
  const out: FonasaPharmacyDetail[] = [];

  for (const group of groups) {
    const rows = Array.isArray(group?.data) ? group.data : [];
    for (const row of rows) {
      out.push({
        farmacia: String(row?.nombreFarmacia ?? row?.farmacia ?? '').trim(),
        nombreSucursal: String(row?.nombreSucursal ?? '').trim(),
        direccion: String(row?.direccion ?? '').trim(),
        comuna: String(row?.comuna ?? '').trim(),
        ciudad: String(row?.ciudad ?? '').trim(),
        region: String(row?.region ?? '').trim(),
        distancia: Number.isFinite(Number(row?.distancia)) ? Number(row.distancia) : undefined,
        latitud: Number.isFinite(Number(row?.latitud)) ? Number(row.latitud) : undefined,
        longitud: Number.isFinite(Number(row?.longitud)) ? Number(row.longitud) : undefined,
        ofertaFonasa: Number.isFinite(Number(row?.ofertaFonasa)) ? Number(row.ofertaFonasa) : undefined,
        precioNormal: Number.isFinite(Number(row?.precioNormal)) ? Number(row.precioNormal) : undefined,
        ahorro: Number.isFinite(Number(row?.ahorro)) ? Number(row.ahorro) : undefined,
      });
    }
  }

  return out.sort((a, b) => {
    const aFonasa = a.ofertaFonasa ?? Number.MAX_SAFE_INTEGER;
    const bFonasa = b.ofertaFonasa ?? Number.MAX_SAFE_INTEGER;
    if (aFonasa !== bFonasa) return aFonasa - bFonasa;

    const aDist = a.distancia ?? Number.MAX_SAFE_INTEGER;
    const bDist = b.distancia ?? Number.MAX_SAFE_INTEGER;
    return aDist - bDist;
  });
}
