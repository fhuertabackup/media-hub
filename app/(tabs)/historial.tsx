import React, { useCallback, useState } from 'react';
import {
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
import { useFocusEffect } from 'expo-router';
import { SectionHeaderBanner } from '../../src/components/SectionHeaderBanner';
import { SoftScreenGradient } from '../../src/components/SoftScreenGradient';
import { getAllMedia } from '../../src/lib/media-store';
import { AudioItem, MediaItem } from '../../src/types/media';
import { formatDate, formatDuration } from '../../src/utils/format';

export default function HistorialScreen() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selected, setSelected] = useState<MediaItem | null>(null);

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
      <SoftScreenGradient color="#F59E0B" />
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        <View style={styles.headerWrap}>
          <SectionHeaderBanner
            title="Historial"
            subtitle={`${items.length} elemento${items.length !== 1 ? 's' : ''} en total`}
            icon="time"
            color="#312E81"
          />
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
                  <View style={[styles.dot, item.type === 'photo' ? styles.dotPhoto : styles.dotAudio]}>
                    <Ionicons
                      name={item.type === 'photo' ? 'image' : 'mic'}
                      size={14}
                      color="#FFFFFF"
                    />
                  </View>
                  {index < items.length - 1 && <View style={styles.line} />}
                </View>

                <Pressable style={styles.timelineCard} onPress={() => setSelected(item)}>
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
                          item.type === 'photo' ? styles.badgePhotoText : styles.badgeAudioText,
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
                      DUR. {formatDuration((item as AudioItem).durationMillis)}
                    </Text>
                  )}
                  <Text style={styles.viewHint}>Toca para ver detalle</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={selected !== null} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <SafeAreaView style={styles.modalSafe}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={2}>
                {selected?.title}
              </Text>
              <Pressable style={styles.closeButton} onPress={() => setSelected(null)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.modalCard}>
              <ScrollView contentContainerStyle={styles.modalContent}>
                <Text style={styles.modalMeta}>{selected ? formatDate(selected.createdAt) : ''}</Text>
                {selected?.type === 'audio' ? (
                  <>
                    <Text style={styles.detailLabel}>Duración</Text>
                    <Text style={styles.detailValue}>{formatDuration(selected.durationMillis)}</Text>

                    {selected.aiSummary ? (
                      <>
                        <Text style={styles.detailLabel}>Resumen</Text>
                        <Text style={styles.detailBlock}>{selected.aiSummary}</Text>
                      </>
                    ) : null}

                    <Text style={styles.detailLabel}>Transcripción</Text>
                    <Text style={styles.detailBlock}>{selected.transcript || 'Sin transcripción.'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.detailLabel}>Texto extraído</Text>
                    <Text style={styles.detailBlock}>{selected?.ocrText || '[SIN_TEXTO]'}</Text>
                  </>
                )}
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
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 120 },
  headerWrap: {
    paddingTop: 10,
    marginBottom: 20,
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
  viewHint: {
    color: '#6366F1',
    marginTop: 8,
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.92)',
  },
  modalSafe: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    flex: 1,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    flex: 1,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalContent: {
    padding: 16,
    paddingBottom: 120,
  },
  modalMeta: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  detailLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 8,
  },
  detailValue: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  detailBlock: {
    color: '#0F172A',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '500',
  },
});
