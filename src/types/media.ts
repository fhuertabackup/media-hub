import { BonoParsed, PhotoPrescriptionParsed } from './ocr';

export type MediaType = 'photo' | 'audio';
export type MediaFilter = 'all' | 'photo' | 'audio';

export interface BaseMediaItem {
  id: string;
  type: MediaType;
  title: string;
  uri: string;
  createdAt: string;
}

export interface PhotoItem extends BaseMediaItem {
  type: 'photo';
  photoGroupId?: string;
  photoGroupTitle?: string;
  ocrText?: string;
  ocrParsed?: PhotoPrescriptionParsed;
  ocrStatus?: 'pending' | 'done' | 'error';
  ocrError?: string;
  bonoStatus?: 'pending' | 'done' | 'error';
  bonoParsed?: BonoParsed;
  bonoError?: string;
  priceLookupCache?: {
    provider: 'fonasa';
    updatedAt: string;
    latitud: number;
    longitud: number;
    results: Array<{
      query: string;
      bestPrice: number | null;
      itemCount: number;
      items: Array<{
        id?: number;
        nombreMedicamento: string;
        principioActivo1?: string;
        registroSanitario?: string;
        presentacion?: string;
        formaFarmaceutica?: string;
        laboratorio?: string;
        ofertaFonasa?: number;
      }>;
    }>;
  };
}

export interface AudioItem extends BaseMediaItem {
  type: 'audio';
  durationMillis: number;
  transcriptionElapsedMs?: number;
  transcript?: string;
  transcriptStatus?: 'pending' | 'done' | 'error';
  transcriptError?: string;
  aiTitle?: string;
  aiSummary?: string;
  aiStatus?: 'pending' | 'done' | 'error';
  aiError?: string;
}

export type MediaItem = PhotoItem | AudioItem;
