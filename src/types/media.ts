import { PhotoPrescriptionParsed } from './ocr';

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
