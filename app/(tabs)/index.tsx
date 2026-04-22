import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAppSettings, getDeviceId } from '../../src/lib/settings-store';
import { SoftScreenGradient } from '../../src/components/SoftScreenGradient';

const APP_VERSION = '1.1.0';

export default function HomeScreen() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [deviceId, setDeviceId] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const settings = await getAppSettings();
        setUserName(settings.personName.trim());
        setDeviceId(settings.deviceId || '');
      })();
    }, [])
  );

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 20) return 'Buenas tardes';
    return 'Buenas noches';
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <SoftScreenGradient color="#A78BFA" />
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <View style={styles.centerBlock}>
          <View style={styles.heroMedical}>
            <View style={styles.heroMedicalInner}>
              <Ionicons name="medical" size={56} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.userName} numberOfLines={1}>
            {userName || 'Usuario'}
          </Text>
          <Text style={styles.welcomeHint}>Selecciona una opción para comenzar</Text>

          <Text style={styles.versionText}>v{APP_VERSION}</Text>
          {deviceId ? (
            <Text style={styles.deviceIdText} numberOfLines={1}>
              ID: {deviceId}
            </Text>
          ) : null}

          <Pressable style={styles.mainButton} onPress={() => router.push('/(tabs)/biblioteca')}>
            <View style={[styles.iconWrap, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="images" size={34} color="#047857" />
            </View>
            <View style={styles.buttonTextWrap}>
              <Text style={styles.buttonTitle}>Fotos</Text>
              <Text style={styles.buttonSub}>Tomar recetas y extraer texto</Text>
            </View>
            <Ionicons name="chevron-forward" size={28} color="#94A3B8" />
          </Pressable>

          <Pressable style={styles.mainButton} onPress={() => router.push('/(tabs)/audio')}>
            <View style={[styles.iconWrap, { backgroundColor: '#EDE9FE' }]}>
              <Ionicons name="mic" size={34} color="#5B21B6" />
            </View>
            <View style={styles.buttonTextWrap}>
              <Text style={styles.buttonTitle}>Audio</Text>
              <Text style={styles.buttonSub}>Grabar, transcribir y resumir</Text>
            </View>
            <Ionicons name="chevron-forward" size={28} color="#94A3B8" />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    justifyContent: 'center',
  },
  centerBlock: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 0,
  },
  heroMedical: {
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroMedicalInner: {
    width: 82,
    height: 82,
    borderRadius: 999,
    backgroundColor: '#6366F1', // Indigo to match loading screen
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  welcomeTextWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  greeting: {
    color: '#334155',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  userName: {
    color: '#0F172A',
    fontSize: 38,
    fontWeight: '900',
    marginTop: 2,
    textAlign: 'center',
  },
  welcomeHint: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },
  mainButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    minHeight: 102,
    marginBottom: 12,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonTextWrap: {
    flex: 1,
  },
  buttonTitle: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '900',
  },
  buttonSub: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  versionText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  deviceIdText: {
    color: '#94A3B8',
    fontSize: 9,
    marginBottom: 16,
  },
});
