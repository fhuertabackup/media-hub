import React, { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import { AudioItem } from '../types/media';
import { formatDate, formatDuration } from '../utils/format';

interface Props {
  item: AudioItem;
  onDelete: () => void;
}

export function AudioCard({ item, onDelete }: Props) {
  const player = useAudioPlayer(item.uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const bars = useMemo(
    () => [14, 24, 10, 20, 28, 16, 12, 25, 18, 30, 12, 22, 15, 26, 11, 20],
    []
  );

  const isPlaying = Boolean(status?.playing);

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

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <Pressable style={styles.playButton} onPress={togglePlay}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={28}
            color="#FFFFFF"
            style={!isPlaying ? { marginLeft: 2 } : undefined}
          />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.subtitle}>{formatDate(item.createdAt)}</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.actionButton} onPress={handleShare}>
              <Ionicons name="share-outline" size={16} color="#6D28D9" />
            </Pressable>
            <Pressable style={styles.actionButton} onPress={confirmDelete}>
              <Ionicons name="trash-outline" size={16} color="#475569" />
            </Pressable>
          </View>
        </View>

        <View style={styles.waveRow}>
          {bars.map((height, index) => (
            <View key={`${item.id}-${index}`} style={[styles.bar, { height }]} />
          ))}
        </View>

        <View style={styles.bottomRow}>
          <View style={styles.badge}>
            <Ionicons name="mic-outline" size={14} color="#6D28D9" />
            <Text style={styles.badgeText}>Audio</Text>
          </View>

          <Text style={styles.duration}>
            {status?.playing
              ? `${formatDuration((status.currentTime ?? 0) * 1000)} / ${formatDuration(
                  item.durationMillis
                )}`
              : formatDuration(item.durationMillis)}
          </Text>
        </View>
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
    flexDirection: 'row',
    gap: 14,
  },
  left: {
    justifyContent: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
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
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  title: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    height: 32,
  },
  bar: {
    width: 6,
    borderRadius: 99,
    backgroundColor: '#C4B5FD',
  },
  bottomRow: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  badgeText: {
    color: '#6D28D9',
    fontSize: 12,
    fontWeight: '800',
  },
  duration: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
});
