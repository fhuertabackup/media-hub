import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { PhotoItem } from '../types/media';
import { formatDate } from '../utils/format';

interface Props {
  item: PhotoItem;
  onDelete: () => void;
  onPress: () => void;
}

export function PhotoCard({ item, onDelete, onPress }: Props) {
  const patientName =
    item.bonoParsed?.beneficiario_nombre ||
    item.ocrParsed?.patientName ||
    'Paciente desconocido';

  const doctorName =
    item.bonoParsed?.profesional_nombre ||
    item.ocrParsed?.doctorName ||
    '';

  const center =
    item.bonoParsed?.prestador_nombre ||
    item.ocrParsed?.institution ||
    '';

  const date =
    item.bonoParsed?.fecha_atencion ||
    item.bonoParsed?.fecha_emision ||
    item.ocrParsed?.date ||
    '';

  const hasReceta = item.ocrStatus === 'done';
  const hasBono = item.bonoStatus === 'done';
  const recetaPending = item.ocrStatus === 'pending';
  const bonoPending = item.bonoStatus === 'pending';

  const confirmDelete = () => {
    Alert.alert(
      'Eliminar foto',
      '¿Quieres eliminar esta foto del almacenamiento local?',
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
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <Image source={{ uri: item.uri }} style={styles.thumbnail} />

        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.patientName} numberOfLines={1}>
              {patientName}
            </Text>
            <View style={styles.actions}>
              <Pressable style={styles.actionBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={16} color="#64748B" />
              </Pressable>
              <Pressable style={styles.actionBtn} onPress={confirmDelete}>
                <Ionicons name="trash-outline" size={16} color="#64748B" />
              </Pressable>
            </View>
          </View>

          {doctorName ? (
            <Text style={styles.doctorName} numberOfLines={1}>
              {doctorName}
            </Text>
          ) : null}

          <View style={styles.metaRow}>
            {date ? (
              <View style={styles.metaItem}>
                <Ionicons name="calendar-outline" size={13} color="#94A3B8" />
                <Text style={styles.metaText}>{date}</Text>
              </View>
            ) : null}
            {center ? (
              <View style={styles.metaItem}>
                <Ionicons name="business-outline" size={13} color="#94A3B8" />
                <Text style={styles.metaText} numberOfLines={1}>{center}</Text>
              </View>
            ) : null}
            {!date && !center ? (
              <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
            ) : null}
          </View>

          <View style={styles.pillsRow}>
            <ScanPill
              label="Receta"
              scanned={hasReceta}
              pending={recetaPending}
              icon="document-text-outline"
              color="#10B981"
            />
            <ScanPill
              label="Bono"
              scanned={hasBono}
              pending={bonoPending}
              icon="receipt-outline"
              color="#6366F1"
            />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

interface ScanPillProps {
  label: string;
  scanned: boolean;
  pending: boolean;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}

function ScanPill({ label, scanned, pending, icon, color }: ScanPillProps) {
  if (pending) {
    return (
      <View style={[styles.pill, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}>
        <Ionicons name="time-outline" size={12} color="#94A3B8" />
        <Text style={[styles.pillText, { color: '#94A3B8' }]}>{label}</Text>
      </View>
    );
  }

  if (scanned) {
    return (
      <View style={[styles.pill, { backgroundColor: color + '18', borderColor: color + '40' }]}>
        <Ionicons name={icon} size={12} color={color} />
        <Text style={[styles.pillText, { color }]}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.pill, { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }]}>
      <Ionicons name="lock-closed-outline" size={12} color="#CBD5E1" />
      <Text style={[styles.pillText, { color: '#CBD5E1' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  patientName: {
    flex: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    marginRight: 8,
  },
  doctorName: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
