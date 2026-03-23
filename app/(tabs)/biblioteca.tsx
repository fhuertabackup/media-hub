import React, { useCallback, useState } from 'react';
import {
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { getAllMedia } from '../../src/lib/media-store';
import { AudioItem, PhotoItem } from '../../src/types/media';
import { formatDate, formatDuration } from '../../src/utils/format';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GAP = 10;
const PADDING = 20;
const COLUMNS = 2;
const TILE_SIZE = (SCREEN_WIDTH - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

export default function BibliotecaScreen() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const all = await getAllMedia();
        setPhotos(all.filter((i): i is PhotoItem => i.type === 'photo'));
        setAudios(all.filter((i): i is AudioItem => i.type === 'audio'));
      })();
    }, [])
  );

  const shareFile = async (uri: string) => {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Error', 'Compartir no está disponible en este dispositivo.');
      return;
    }
    await Sharing.shareAsync(uri);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headerBanner}>
          <View style={styles.headerIcon}>
            <Ionicons name="images" size={28} color="#FFFFFF" />
          </View>
          <Text style={styles.headerTitle}>Biblioteca</Text>
          <Text style={styles.headerSub}>
            {photos.length} foto{photos.length !== 1 ? 's' : ''} · {audios.length} audio{audios.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* --- FOTOS --- */}
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: '#10B981' }]} />
          <Text style={styles.sectionTitle}>Fotos</Text>
          <Text style={styles.sectionCount}>{photos.length}</Text>
        </View>

        {photos.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={[styles.emptyIcon, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="camera-outline" size={28} color="#059669" />
            </View>
            <Text style={styles.emptyTitle}>Sin fotos aún</Text>
            <Text style={styles.emptyText}>
              Las fotos que captures aparecerán aquí.
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {photos.map((photo) => (
              <Pressable key={photo.id} style={styles.tile} onPress={() => setPreviewPhoto(photo)}>
                <Image source={{ uri: photo.uri }} style={styles.tileImage} />
                <View style={styles.tileOverlay}>
                  <Pressable style={styles.tileShareBtn} onPress={() => shareFile(photo.uri)}>
                    <Ionicons name="share-outline" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>{formatDate(photo.createdAt)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* --- AUDIOS --- */}
        <View style={[styles.sectionHeader, { marginTop: 32 }]}>
          <View style={[styles.sectionDot, { backgroundColor: '#6D28D9' }]} />
          <Text style={styles.sectionTitle}>Audios</Text>
          <Text style={styles.sectionCount}>{audios.length}</Text>
        </View>

        {audios.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={[styles.emptyIcon, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="mic-outline" size={28} color="#6D28D9" />
            </View>
            <Text style={styles.emptyTitle}>Sin audios aún</Text>
            <Text style={styles.emptyText}>
              Las grabaciones que realices aparecerán aquí.
            </Text>
          </View>
        ) : (
          <View style={styles.audioList}>
            {audios.map((audio) => (
              <View key={audio.id} style={styles.audioRow}>
                <View style={styles.audioIconWrap}>
                  <Ionicons name="musical-note" size={20} color="#6D28D9" />
                </View>
                <View style={styles.audioInfo}>
                  <Text style={styles.audioTitle} numberOfLines={1}>{audio.title}</Text>
                  <Text style={styles.audioMeta}>
                    {formatDuration(audio.durationMillis)} · {formatDate(audio.createdAt)}
                  </Text>
                </View>
                <Pressable style={styles.audioShareBtn} onPress={() => shareFile(audio.uri)}>
                  <Ionicons name="share-outline" size={18} color="#6D28D9" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={previewPhoto !== null} animationType="fade" transparent>
        <View style={styles.previewBackdrop}>
          <SafeAreaView style={styles.previewSafe}>
            <View style={styles.previewTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={1}>
                  {previewPhoto?.title}
                </Text>
                <Text style={styles.previewDate}>
                  {previewPhoto ? formatDate(previewPhoto.createdAt) : ''}
                </Text>
              </View>
              <View style={styles.previewActions}>
                <Pressable
                  style={styles.previewButton}
                  onPress={() => previewPhoto && shareFile(previewPhoto.uri)}
                >
                  <Ionicons name="share-outline" size={22} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  style={styles.previewButton}
                  onPress={() => setPreviewPhoto(null)}
                >
                  <Ionicons name="close" size={24} color="#FFFFFF" />
                </Pressable>
              </View>
            </View>

            <View style={styles.previewImageWrap}>
              {previewPhoto && (
                <Image
                  source={{ uri: previewPhoto.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              )}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FAF5FF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: PADDING, paddingTop: 10, paddingBottom: 120 },
  headerBanner: {
    backgroundColor: '#7C3AED',
    borderRadius: 24,
    padding: 24,
    paddingTop: 32,
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 44,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
  },
  headerSub: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  sectionDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
    flex: 1,
  },
  sectionCount: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 28,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#E9D5FF',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  tileShareBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tileBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  audioList: {
    gap: 10,
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 14,
    gap: 12,
  },
  audioIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioInfo: {
    flex: 1,
  },
  audioTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
  },
  audioMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  audioShareBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  previewSafe: {
    flex: 1,
    justifyContent: 'space-between',
  },
  previewTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  previewTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  previewDate: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  previewActions: {
    flexDirection: 'row',
    gap: 10,
  },
  previewButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
});
