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
}

export interface AudioItem extends BaseMediaItem {
  type: 'audio';
  durationMillis: number;
}

export type MediaItem = PhotoItem | AudioItem;
