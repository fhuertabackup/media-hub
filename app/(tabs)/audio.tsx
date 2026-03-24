import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from 'expo-audio';
import { useFocusEffect } from 'expo-router';

import { AudioCard } from '../../src/components/AudioCard';
import { SectionHeaderBanner } from '../../src/components/SectionHeaderBanner';
import { SoftScreenGradient } from '../../src/components/SoftScreenGradient';
import {
  addMediaItem,
  copyAudioToAppStorage,
  deleteMediaItem,
  getAllMedia,
  updateMediaItem,
} from '../../src/lib/media-store';
import {
  enrichTranscript,
  transcribeAudio,
} from '../../src/lib/transcription-api';
import { AudioItem } from '../../src/types/media';
import { formatDate, formatDuration, generateId } from '../../src/utils/format';

export default function AudioScreen() {
  const [items, setItems] = useState<AudioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recordVisible, setRecordVisible] = useState(false);
  const [transcribingIds, setTranscribingIds] = useState<Record<string, boolean>>({});
  const [previewTranscript, setPreviewTranscript] = useState<AudioItem | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const loadItems = useCallback(async (options?: { showLoader?: boolean }) => {
    const showLoader = options?.showLoader ?? true;
    try {
      if (showLoader) setLoading(true);
      const all = await getAllMedia();
      setItems(all.filter((item): item is AudioItem => item.type === 'audio'));
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No fue posible cargar audios.');
    } finally {
      if (showLoader) setLoading(false);
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

  const totalDurationMs = useMemo(
    () => items.reduce((sum, item) => sum + item.durationMillis, 0),
    [items]
  );

  const openRecorder = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permiso requerido', 'Necesitas permitir acceso al micrófono.');
      return;
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setRecordVisible(true);
  };

  const closeRecorder = async () => {
    if (recorderState.isRecording) {
      await recorder.stop();
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    setRecordVisible(false);
  };

  const startRecording = async () => {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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
      const storedUri = await copyAudioToAppStorage(recorder.uri, `audio-${id}.m4a`);
      const item: AudioItem = {
        id,
        type: 'audio',
        title: `Grabación ${items.length + 1}`,
        uri: storedUri,
        durationMillis: recorderState.durationMillis ?? 0,
        createdAt: new Date().toISOString(),
      };

      await addMediaItem(item);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      setRecordVisible(false);
      await loadItems({ showLoader: false });
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar la grabación.');
    }
  };

  const handleDelete = async (item: AudioItem) => {
    try {
      await deleteMediaItem(item);
      await loadItems({ showLoader: false });
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo eliminar el audio.');
    }
  };

  const handleGenerateInsights = async (itemId: string, transcriptOverride?: string) => {
    try {
      const currentItem = items.find((current) => current.id === itemId);
      const transcript = (transcriptOverride ?? currentItem?.transcript ?? '').trim();
      if (!transcript || transcript === '[SIN_VOZ]') return;

      await updateMediaItem(itemId, { aiStatus: 'pending', aiError: '' });

      const enrich = await enrichTranscript(transcript);
      await updateMediaItem(itemId, {
        title: enrich.title,
        aiTitle: enrich.title,
        aiSummary: enrich.summary,
        aiStatus: 'done',
        aiError: '',
      });

      await loadItems({ showLoader: false });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'No se pudo generar título/resumen.';
      await updateMediaItem(itemId, { aiStatus: 'error', aiError: message });
      await loadItems({ showLoader: false });
    }
  };

  const handleTranscribe = async (item: AudioItem) => {
    const startedAt = Date.now();
    try {
      setTranscribingIds((prev) => ({ ...prev, [item.id]: true }));
      await updateMediaItem(item.id, {
        transcriptStatus: 'pending',
        transcriptError: '',
        transcriptionElapsedMs: undefined,
      });
      await loadItems({ showLoader: false });

      const result = await transcribeAudio({ uri: item.uri, durationMillis: item.durationMillis });
      await updateMediaItem(item.id, {
        transcript: result.transcript,
        transcriptStatus: 'done',
        transcriptError: '',
      });

      await handleGenerateInsights(item.id, result.transcript);
      const elapsed = Date.now() - startedAt;
      await updateMediaItem(item.id, { transcriptionElapsedMs: elapsed });
      await loadItems({ showLoader: false });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'No se pudo transcribir el audio.';
      const elapsed = Date.now() - startedAt;
      await updateMediaItem(item.id, {
        transcriptStatus: 'error',
        transcriptError: message,
        transcriptionElapsedMs: elapsed,
      });
      await loadItems({ showLoader: false });
      Alert.alert('Transcripción fallida', message);
    } finally {
      setTranscribingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleClearTranscript = async (item: AudioItem) => {
    try {
      await updateMediaItem(item.id, {
        transcript: '',
        transcriptStatus: undefined,
        transcriptError: '',
        aiTitle: '',
        aiSummary: '',
        aiStatus: undefined,
        aiError: '',
        transcriptionElapsedMs: undefined,
      });
      await loadItems({ showLoader: false });
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo eliminar la transcripción.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <SoftScreenGradient color="#6366F1" />
      <StatusBar barStyle="dark-content" />
      <View style={styles.screen}>
        <View style={styles.headerWrap}>
          <SectionHeaderBanner
            title="Audio"
            subtitle={`${items.length} grabación(es) · ${formatDuration(totalDurationMs)} total`}
            icon="mic"
            color="#312E81"
            actionLabel="Grabar"
            actionIcon="mic"
            actionIconOnly
            onPressAction={openRecorder}
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#6D28D9" />
            <Text style={styles.centerText}>Cargando audios...</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <AudioCard
                item={item}
                onDelete={() => handleDelete(item)}
                onTranscribe={() => handleTranscribe(item)}
                onClearTranscript={() => handleClearTranscript(item)}
                onViewTranscript={() => setPreviewTranscript(item)}
                transcribing={Boolean(transcribingIds[item.id])}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Ionicons name="mic-outline" size={42} color="#6D28D9" />
                <Text style={styles.emptyTitle}>Sin grabaciones todavía</Text>
                <Text style={styles.emptyText}>Usa el botón + para crear tu primer audio.</Text>
              </View>
            }
          />
        )}
      </View>

      <Modal visible={recordVisible} animationType="slide" transparent>
        <View style={styles.recordBackdrop}>
          <View style={styles.recordSheet}>
            <View style={styles.recordHandle} />
            <Text style={styles.recordSheetTitle}>Nueva grabación</Text>
            <Text style={styles.recordSheetSubtitle}>Habla y guarda tu nota de voz.</Text>

            <View style={styles.recordCircle}>
              <Ionicons
                name={recorderState.isRecording ? 'radio-button-on' : 'mic'}
                size={42}
                color="#FFFFFF"
              />
            </View>

            <Text style={styles.recordTime}>{formatDuration(recorderState.durationMillis ?? 0)}</Text>

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

      <Modal visible={previewTranscript !== null} animationType="slide" transparent>
        <View style={styles.previewBackdrop}>
          <SafeAreaView style={styles.previewSafe}>
            <View style={styles.previewTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={2}>
                  {previewTranscript?.aiTitle || previewTranscript?.title}
                </Text>
                <Text style={styles.previewDate}>
                  {previewTranscript ? formatDate(previewTranscript.createdAt) : ''}
                </Text>
              </View>
              <Pressable style={styles.previewButton} onPress={() => setPreviewTranscript(null)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.transcriptModalCard}>
              <ScrollView contentContainerStyle={styles.transcriptModalContent}>
                {previewTranscript?.aiSummary ? (
                  <>
                    <Text style={styles.transcriptModalLabel}>Resumen</Text>
                    <Text style={styles.transcriptModalSummary}>{previewTranscript.aiSummary}</Text>
                  </>
                ) : null}
                <Text style={styles.transcriptModalLabel}>Transcripción completa</Text>
                <Text style={styles.transcriptModalText}>
                  {previewTranscript?.transcript || 'Sin transcripción.'}
                </Text>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  screen: { flex: 1, backgroundColor: 'transparent' },
  headerWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
    marginBottom: 20,
  },
  listContent: {
    paddingTop: 0,
    paddingHorizontal: 18,
    paddingBottom: 130,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  centerText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    padding: 30,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 21,
    fontWeight: '900',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
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
    backgroundColor: '#4F46E5',
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
    backgroundColor: '#4F46E5',
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
    gap: 10,
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
  previewButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcriptModalCard: {
    flex: 1,
    marginTop: 14,
    marginHorizontal: 14,
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  transcriptModalContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  transcriptModalLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  transcriptModalSummary: {
    color: '#0F172A',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  transcriptModalText: {
    color: '#0F172A',
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '500',
  },
});
