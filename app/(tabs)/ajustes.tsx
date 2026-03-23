import React, { useCallback, useState } from 'react';
import {
  Alert,
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
import { getAllMedia } from '../../src/lib/media-store';

export default function AjustesScreen() {
  const [photoCount, setPhotoCount] = useState(0);
  const [audioCount, setAudioCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const all = await getAllMedia();
        setPhotoCount(all.filter((i) => i.type === 'photo').length);
        setAudioCount(all.filter((i) => i.type === 'audio').length);
      })();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headerBanner}>
          <View style={styles.headerIcon}>
            <Ionicons name="settings" size={28} color="#FFFFFF" />
          </View>
          <Text style={styles.headerTitle}>Ajustes</Text>
          <Text style={styles.headerSub}>Configuración de Media Hub</Text>
        </View>

        <Text style={styles.sectionTitle}>Almacenamiento</Text>
        <View style={styles.card}>
          <SettingsRow
            icon="image"
            iconColor="#10B981"
            iconBg="#D1FAE5"
            label="Fotos guardadas"
            value={`${photoCount}`}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="mic"
            iconColor="#6D28D9"
            iconBg="#EDE9FE"
            label="Audios guardados"
            value={`${audioCount}`}
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="folder"
            iconColor="#D97706"
            iconBg="#FEF3C7"
            label="Total de archivos"
            value={`${photoCount + audioCount}`}
          />
        </View>

        <Text style={styles.sectionTitle}>Acerca de</Text>
        <View style={styles.card}>
          <SettingsRow
            icon="information-circle"
            iconColor="#3B82F6"
            iconBg="#DBEAFE"
            label="Versión"
            value="1.0.0"
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="code-slash"
            iconColor="#EC4899"
            iconBg="#FCE7F3"
            label="Framework"
            value="Expo + React Native"
          />
          <View style={styles.divider} />
          <SettingsRow
            icon="server"
            iconColor="#6366F1"
            iconBg="#E0E7FF"
            label="Storage"
            value="Local (sandbox)"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F0F9FF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 120 },
  headerBanner: {
    backgroundColor: '#0EA5E9',
    borderRadius: 24,
    padding: 24,
    paddingTop: 32,
    alignItems: 'center',
    marginBottom: 28,
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
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 6,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '600',
  },
  rowValue: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 12,
  },
});
