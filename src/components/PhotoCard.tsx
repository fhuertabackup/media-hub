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
      <Image source={{ uri: item.uri }} style={styles.image} />

      <View style={styles.overlayTop}>
        <View style={styles.badge}>
          <Ionicons name="image" size={14} color="#059669" />
          <Text style={styles.badgeText}>Foto</Text>
        </View>

        <View style={styles.overlayActions}>
          <Pressable style={styles.overlayButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={18} color="#FFFFFF" />
          </Pressable>
          <Pressable style={styles.overlayButton} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.subtitle}>{formatDate(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  image: {
    width: '100%',
    height: 208,
    backgroundColor: '#E2E8F0',
  },
  overlayTop: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(209,250,229,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  badgeText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '700',
  },
  overlayActions: {
    flexDirection: 'row',
    gap: 8,
  },
  overlayButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
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
});
