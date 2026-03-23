import React, { useCallback, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { getAllMedia } from '../../src/lib/media-store';
import { MediaItem } from '../../src/types/media';
import { formatDate, formatDuration } from '../../src/utils/format';

export default function HistorialScreen() {
  const [items, setItems] = useState<MediaItem[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const all = await getAllMedia();
        setItems(all);
      })();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headerBanner}>
          <View style={styles.headerIcon}>
            <Ionicons name="time" size={28} color="#FFFFFF" />
          </View>
          <Text style={styles.headerTitle}>Historial</Text>
          <Text style={styles.headerSub}>
            {items.length} elemento{items.length !== 1 ? 's' : ''} en total
          </Text>
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="hourglass-outline" size={32} color="#F59E0B" />
            </View>
            <Text style={styles.emptyTitle}>Historial vacío</Text>
            <Text style={styles.emptyText}>
              Cada foto o grabación que crees aparecerá aquí en orden cronológico.
            </Text>
          </View>
        ) : (
          <View style={styles.timeline}>
            {items.map((item, index) => (
              <View key={item.id} style={styles.timelineRow}>
                <View style={styles.timelineDotCol}>
                  <View
                    style={[
                      styles.dot,
                      item.type === 'photo' ? styles.dotPhoto : styles.dotAudio,
                    ]}
                  >
                    <Ionicons
                      name={item.type === 'photo' ? 'image' : 'mic'}
                      size={14}
                      color="#FFFFFF"
                    />
                  </View>
                  {index < items.length - 1 && <View style={styles.line} />}
                </View>

                <View style={styles.timelineCard}>
                  <View style={styles.cardRow}>
                    <View
                      style={[
                        styles.typeBadge,
                        item.type === 'photo' ? styles.badgePhoto : styles.badgeAudio,
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeBadgeText,
                          item.type === 'photo'
                            ? styles.badgePhotoText
                            : styles.badgeAudioText,
                        ]}
                      >
                        {item.type === 'photo' ? 'Foto' : 'Audio'}
                      </Text>
                    </View>
                    <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
                  </View>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.type === 'audio' && (
                    <Text style={styles.cardDuration}>
                      Duración: {formatDuration(item.durationMillis)}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFBEB' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 120 },
  headerBanner: {
    backgroundColor: '#D97706',
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
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 32,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  timeline: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 14,
  },
  timelineDotCol: {
    alignItems: 'center',
    width: 32,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPhoto: { backgroundColor: '#10B981' },
  dotAudio: { backgroundColor: '#6D28D9' },
  line: {
    width: 3,
    flex: 1,
    backgroundColor: '#E2E8F0',
    borderRadius: 99,
    marginVertical: 4,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgePhoto: { backgroundColor: '#D1FAE5' },
  badgeAudio: { backgroundColor: '#EDE9FE' },
  typeBadgeText: { fontSize: 12, fontWeight: '800' },
  badgePhotoText: { color: '#059669' },
  badgeAudioText: { color: '#6D28D9' },
  cardDate: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  cardTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  cardDuration: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 4,
  },
});
