import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';

import { AudioCard } from '../../src/components/AudioCard';
import { PhotoCard } from '../../src/components/PhotoCard';
import {
  addMediaItem,
  copyAudioToAppStorage,
  copyPhotoToAppStorage,
  deleteMediaItem,
  ensureStorage,
  getAllMedia,
} from '../../src/lib/media-store';
import { AudioItem, MediaFilter, MediaItem, PhotoItem } from '../../src/types/media';
import { formatDate, formatDuration, generateId } from '../../src/utils/format';

export default function HomeScreen() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [loading, setLoading] = useState(true);
  const [takingPhoto, setTakingPhoto] = useState(false);

  const [cameraVisible, setCameraVisible] = useState(false);
  const [recordVisible, setRecordVisible] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back');

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      await ensureStorage();
      const data = await getAllMedia();
      setItems(data);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No fue posible cargar el contenido guardado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems])
  );

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((item) => item.type === filter);
  }, [items, filter]);

  const photoCount = items.filter((i) => i.type === 'photo').length;
  const audioCount = items.filter((i) => i.type === 'audio').length;

  const openCamera = async () => {
    if (!cameraPermission?.granted) {
      const response = await requestCameraPermission();
      if (!response.granted) {
        Alert.alert('Permiso requerido', 'Necesitas permitir acceso a la cámara.');
        return;
      }
    }

    setFabOpen(false);
    setCameraVisible(true);
  };

  const openRecorder = async () => {
    const permission = await requestRecordingPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitas permitir acceso al micrófono.');
      return;
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });

    setFabOpen(false);
    setRecordVisible(true);
  };

  const closeRecorder = async () => {
    if (recorderState.isRecording) {
      await recorder.stop();
    }

    setRecordVisible(false);
  };

  const handleTakePhoto = async () => {
    if (!cameraRef.current || takingPhoto) return;

    try {
      setTakingPhoto(true);

      const result = await cameraRef.current.takePictureAsync({
        quality: 0.85,
      });

      if (!result?.uri) {
        throw new Error('No se pudo obtener la foto');
      }

      const id = generateId();
      const fileName = `photo-${id}.jpg`;
      const storedUri = await copyPhotoToAppStorage(result.uri, fileName);

      const newItem: PhotoItem = {
        id,
        type: 'photo',
        title: `Foto ${photoCount + 1}`,
        uri: storedUri,
        createdAt: new Date().toISOString(),
      };

      await addMediaItem(newItem);
      await loadItems();
      setCameraVisible(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar la foto.');
    } finally {
      setTakingPhoto(false);
    }
  };

  const startRecording = async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recorder.record();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo iniciar la grabación.');
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();

      if (!recorder.uri) {
        throw new Error('No se generó archivo de audio');
      }

      const id = generateId();
      const fileName = `audio-${id}.m4a`;
      const storedUri = await copyAudioToAppStorage(recorder.uri, fileName);

      const newItem: AudioItem = {
        id,
        type: 'audio',
        title: `Grabación ${audioCount + 1}`,
        uri: storedUri,
        durationMillis: recorderState.durationMillis ?? 0,
        createdAt: new Date().toISOString(),
      };

      await addMediaItem(newItem);
      await loadItems();
      setRecordVisible(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar la grabación.');
    }
  };

  const handleDelete = async (item: MediaItem) => {
    try {
      await deleteMediaItem(item);
      await loadItems();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo eliminar el archivo.');
    }
  };

  const renderItem = ({ item }: { item: MediaItem }) => {
    if (item.type === 'photo') {
      return (
        <PhotoCard
          item={item}
          onDelete={() => handleDelete(item)}
          onPress={() => setPreviewPhoto(item)}
        />
      );
    }

    return <AudioCard item={item} onDelete={() => handleDelete(item)} />;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.screen}>
        <View style={styles.headerBanner}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.eyebrow}>MEDIA HUB</Text>
              <Text style={styles.title}>Mis archivos</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBubble}>
                <Ionicons name="image" size={14} color="#10B981" />
                <Text style={styles.statText}>{photoCount}</Text>
              </View>
              <View style={styles.statBubble}>
                <Ionicons name="mic" size={14} color="#A78BFA" />
                <Text style={styles.statText}>{audioCount}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.segmented}>
          <FilterChip
            active={filter === 'all'}
            label="Todo"
            color="#6D28D9"
            onPress={() => setFilter('all')}
          />
          <FilterChip
            active={filter === 'photo'}
            label="Fotos"
            color="#10B981"
            onPress={() => setFilter('photo')}
          />
          <FilterChip
            active={filter === 'audio'}
            label="Audios"
            color="#6D28D9"
            onPress={() => setFilter('audio')}
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#6D28D9" />
            <Text style={styles.centerText}>Cargando contenido…</Text>
          </View>
        ) : (
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="sparkles" size={28} color="#6D28D9" />
                </View>
                <Text style={styles.emptyTitle}>Empieza a crear</Text>
                <Text style={styles.emptyText}>
                  Toca el botón "+" para capturar una foto o grabar un audio.
                </Text>
              </View>
            }
          />
        )}

        {fabOpen && (
          <View style={styles.fabMenu}>
            <Pressable style={styles.fabAction} onPress={openCamera}>
              <View style={[styles.fabActionIcon, { backgroundColor: '#D1FAE5' }]}>
                <Ionicons name="camera" size={18} color="#059669" />
              </View>
              <Text style={styles.fabActionText}>Nueva foto</Text>
            </Pressable>

            <Pressable style={styles.fabAction} onPress={openRecorder}>
              <View style={[styles.fabActionIcon, { backgroundColor: '#EDE9FE' }]}>
                <Ionicons name="mic" size={18} color="#6D28D9" />
              </View>
              <Text style={styles.fabActionText}>Nuevo audio</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[styles.fab, fabOpen && styles.fabOpen]}
          onPress={() => setFabOpen((prev) => !prev)}
        >
          <Ionicons name={fabOpen ? 'close' : 'add'} size={30} color="#FFFFFF" />
        </Pressable>
      </View>

      <Modal visible={cameraVisible} animationType="slide">
        <View style={styles.modalScreen}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing={cameraFacing}
          />

          <SafeAreaView style={styles.cameraOverlay}>
            <View style={styles.cameraTopRow}>
              <Pressable style={styles.circleGhost} onPress={() => setCameraVisible(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>

              <Pressable
                style={styles.circleGhost}
                onPress={() =>
                  setCameraFacing((prev) => (prev === 'back' ? 'front' : 'back'))
                }
              >
                <Ionicons name="camera-reverse-outline" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.cameraBottomRow}>
              <Pressable
                style={[styles.shutterOuter, takingPhoto && { opacity: 0.6 }]}
                onPress={handleTakePhoto}
                disabled={takingPhoto}
              >
                <View style={styles.shutterInner} />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={recordVisible} animationType="slide" transparent>
        <View style={styles.recordBackdrop}>
          <View style={styles.recordSheet}>
            <View style={styles.recordHandle} />

            <Text style={styles.recordSheetTitle}>Nueva grabación</Text>
            <Text style={styles.recordSheetSubtitle}>
              Guarda notas de voz en el almacenamiento local.
            </Text>

            <View style={styles.recordCircle}>
              <Ionicons
                name={recorderState.isRecording ? 'radio-button-on' : 'mic'}
                size={42}
                color="#FFFFFF"
              />
            </View>

            <Text style={styles.recordTime}>
              {formatDuration(recorderState.durationMillis ?? 0)}
            </Text>

            <View style={styles.recordActions}>
              <Pressable style={styles.secondaryButton} onPress={closeRecorder}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>

              {!recorderState.isRecording ? (
                <Pressable style={styles.primaryButton} onPress={startRecording}>
                  <Ionicons name="mic" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Comenzar</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.stopButton} onPress={stopRecording}>
                  <Ionicons name="stop" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>Guardar</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

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
                  onPress={async () => {
                    if (!previewPhoto) return;
                    const available = await Sharing.isAvailableAsync();
                    if (!available) {
                      Alert.alert('Error', 'Compartir no está disponible.');
                      return;
                    }
                    await Sharing.shareAsync(previewPhoto.uri);
                  }}
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

function FilterChip({
  active,
  label,
  color,
  onPress,
}: {
  active: boolean;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.chip,
        active && { backgroundColor: color },
      ]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#1E1B4B',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  headerBanner: {
    backgroundColor: '#1E1B4B',
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  eyebrow: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
  },
  statText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  segmented: {
    marginTop: 18,
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 10,
  },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
  },
  chipText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 32,
    alignItems: 'center',
    marginTop: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3E8FF',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  fabMenu: {
    position: 'absolute',
    right: 24,
    bottom: 160,
    gap: 10,
    alignItems: 'flex-end',
  },
  fabAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingLeft: 6,
    paddingRight: 16,
    paddingVertical: 8,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  fabActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabActionText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 100,
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6D28D9',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  fabOpen: {
    backgroundColor: '#0F172A',
  },
  modalScreen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 18,
  },
  cameraTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circleGhost: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBottomRow: {
    alignItems: 'center',
  },
  shutterOuter: {
    width: 86,
    height: 86,
    borderRadius: 999,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterInner: {
    width: 66,
    height: 66,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  recordBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.55)',
    justifyContent: 'flex-end',
  },
  recordSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 32,
    alignItems: 'center',
  },
  recordHandle: {
    width: 56,
    height: 6,
    borderRadius: 99,
    backgroundColor: '#CBD5E1',
    marginBottom: 18,
  },
  recordSheetTitle: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '900',
  },
  recordSheetSubtitle: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  recordCircle: {
    width: 108,
    height: 108,
    borderRadius: 999,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordTime: {
    color: '#0F172A',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 18,
  },
  recordActions: {
    marginTop: 28,
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButton: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  stopButton: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
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
