import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import * as Updates from 'expo-updates';

export function UpdateBanner() {
  const { isChecking, isDownloading, downloadedUpdate } = Updates.useUpdates();
  const opacity = useRef(new Animated.Value(0)).current;

  const visible = isChecking || isDownloading || !!downloadedUpdate;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  useEffect(() => {
    if (downloadedUpdate) {
      const timer = setTimeout(() => {
        Updates.reloadAsync();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [downloadedUpdate]);

  const label = downloadedUpdate
    ? 'Nueva versión lista, actualizando...'
    : isDownloading
    ? 'Descargando actualización...'
    : 'Buscando actualizaciones...';

  const bgColor = downloadedUpdate ? '#059669' : '#6D28D9';

  return (
    <Animated.View style={[styles.banner, { opacity, backgroundColor: bgColor }]}>
      <Text style={styles.text}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    bottom: 96,
    left: 16,
    right: 16,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 999,
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
