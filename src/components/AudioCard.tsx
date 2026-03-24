import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import { AudioItem } from '../types/media';
import { formatDate, formatDuration } from '../utils/format';

interface Props {
  item: AudioItem;
  onDelete: () => void;
  onTranscribe: () => void;
  onClearTranscript: () => void;
  onViewTranscript: () => void;
  transcribing?: boolean;
}

export function AudioCard({
  item,
  onDelete,
  onTranscribe,
  onClearTranscript,
  onViewTranscript,
  transcribing = false,
}: Props) {
  const player = useAudioPlayer(item.uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const isPlaying = Boolean(status?.playing);
  const isProcessed = item.transcriptStatus === 'done' && item.aiStatus === 'done';

  const togglePlay = async () => {
    if (isPlaying) {
      player.pause();
      return;
    }

    if ((status?.currentTime ?? 0) >= (status?.duration ?? 0) && (status?.duration ?? 0) > 0) {
      player.seekTo(0);
    }

    player.play();
  };

  const confirmDelete = () => {
    Alert.alert(
      'Eliminar audio',
      '¿Quieres eliminar esta grabación del almacenamiento local?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  const handleShare = async () => {
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('Error', 'Compartir no está disponible en este dispositivo.');
      return;
    }
    await Sharing.shareAsync(item.uri);
  };

  // TTS disabled for now by product decision.
  // To re-enable:
  // 1) Restore `import * as Speech from 'expo-speech';`
  // 2) Restore `speaking` state and `toggleSpeakTranscript` function.
  // 3) Restore TTS button in transcript section.
  //
  // const [speaking, setSpeaking] = useState(false);
  // const toggleSpeakTranscript = async () => {
  //   if (!item.transcript) return;
  //   if (speaking) {
  //     await Speech.stop();
  //     setSpeaking(false);
  //     return;
  //   }
  //   setSpeaking(true);
  //   Speech.speak(item.transcript, {
  //     language: 'es-CL',
  //     rate: 0.9,
  //     pitch: 1,
  //     onDone: () => setSpeaking(false),
  //     onStopped: () => setSpeaking(false),
  //     onError: () => setSpeaking(false),
  //   });
  // };

  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Pressable style={styles.playButton} onPress={togglePlay}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={32}
              color="#FFFFFF"
              style={!isPlaying ? { marginLeft: 2 } : undefined}
            />
          </Pressable>

          <View style={styles.topMain}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.subtitle}>{formatDate(item.createdAt)}</Text>
              <Text style={styles.durationMeta}>DUR. {formatDuration(item.durationMillis)}</Text>
              {item.transcriptionElapsedMs ? (
                <Text style={styles.processMeta}>
                  PROC. {(item.transcriptionElapsedMs / 1000).toFixed(1)}s
                </Text>
              ) : null}
            </View>

            <View style={styles.actionCol}>
              <View style={styles.actionRow}>
                <Pressable style={styles.actionButton} onPress={handleShare}>
                  <Ionicons name="share-outline" size={16} color="#6D28D9" />
                </Pressable>
                <Pressable style={styles.actionButton} onPress={confirmDelete}>
                  <Ionicons name="trash-outline" size={16} color="#475569" />
                </Pressable>
              </View>
              {isProcessed ? <Text style={styles.processedTag}>Procesado</Text> : null}
            </View>
          </View>
        </View>

        {!isProcessed ? (
          <View style={styles.transcriptionRow}>
            <Pressable
              style={[styles.transcribeButton, transcribing && styles.transcribeButtonDisabled]}
              onPress={onTranscribe}
              disabled={transcribing || item.transcriptStatus === 'pending'}
            >
              <Ionicons name="document-text-outline" size={16} color="#FFFFFF" />
              <Text style={styles.transcribeButtonText}>
                {transcribing || item.transcriptStatus === 'pending' ? 'Procesando...' : 'Procesar audio'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {item.transcriptStatus === 'error' && (
          <Text style={styles.transcriptError}>
            {item.transcriptError || 'No se pudo transcribir este audio.'}
          </Text>
        )}
        {item.aiStatus === 'error' && (
          <Text style={styles.transcriptError}>
            {item.aiError || 'No se pudo generar título/resumen.'}
          </Text>
        )}

        {item.transcriptStatus === 'done' && item.transcript ? (
          <>
            <Pressable style={styles.transcriptBox} onPress={onViewTranscript}>
            {item.aiTitle ? (
              <View style={styles.aiMetaBlock}>
                <Text style={styles.aiMetaTitle}>{item.aiTitle}</Text>
              </View>
            ) : null}
            {item.aiSummary ? (
              <View style={styles.aiMetaBlock}>
                <Text style={styles.aiMetaLabel}>Resumen</Text>
                <Text style={styles.aiMetaSummary}>{item.aiSummary}</Text>
              </View>
            ) : null}

            <Text style={styles.transcriptLabel}>Transcripción</Text>
            <Text style={styles.transcriptText} numberOfLines={4}>
              {item.transcript}
            </Text>
            {/* TTS disabled temporarily.
            <Pressable style={styles.ttsButton} onPress={toggleSpeakTranscript}>
              <Ionicons
                name={speaking ? 'stop-circle-outline' : 'volume-high-outline'}
                size={18}
                color="#065F46"
              />
              <Text style={styles.ttsButtonText}>{speaking ? 'Detener lectura' : 'Escuchar'}</Text>
            </Pressable>
            */}
            </Pressable>
            <Pressable style={styles.clearTranscriptButton} onPress={onClearTranscript}>
              <Ionicons name="trash-outline" size={14} color="#DC2626" />
              <Text style={styles.clearTranscriptText}>Eliminar transcripción</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: '#6D28D9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6D28D9',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  content: {
    width: '100%',
  },
  topRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  topMain: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  title: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  durationMeta: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
  processMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionCol: {
    alignItems: 'flex-end',
    gap: 4,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processedTag: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  transcriptionRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  transcribeButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    backgroundColor: '#4F46E5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  transcribeButtonDisabled: {
    opacity: 0.65,
  },
  transcribeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  transcriptBox: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: 12,
  },
  transcriptLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  aiMetaBlock: {
    marginBottom: 10,
  },
  aiMetaLabel: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  aiMetaTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  aiMetaSummary: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  transcriptText: {
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  clearTranscriptButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  clearTranscriptText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
  ttsButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#6EE7B7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  ttsButtonText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '800',
  },
  transcriptError: {
    marginTop: 10,
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
  },
});
