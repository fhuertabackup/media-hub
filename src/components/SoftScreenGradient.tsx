import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  color: string;
}

export function SoftScreenGradient({ color }: Props) {
  const strong = hexToRgba(color, 0.24);
  const medium = hexToRgba(color, 0.12);
  const soft = hexToRgba(color, 0.04);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <LinearGradient
        colors={[strong, medium, soft, 'rgba(255,255,255,1)']}
        locations={[0, 0.32, 0.58, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.shapeCircleA} />
      <View style={styles.shapeCircleB} />
      <View style={styles.shapeCapsuleA} />
      <View style={styles.shapeCapsuleB} />
      <View style={styles.shapeRing} />
    </View>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const cleaned = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `rgba(99,102,241,${alpha})`;
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  shapeCircleA: {
    position: 'absolute',
    top: 84,
    left: -34,
    width: 110,
    height: 110,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  shapeCircleB: {
    position: 'absolute',
    top: 24,
    right: -24,
    width: 92,
    height: 92,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  shapeCapsuleA: {
    position: 'absolute',
    top: 152,
    right: 36,
    width: 94,
    height: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
    transform: [{ rotate: '-22deg' }],
  },
  shapeCapsuleB: {
    position: 'absolute',
    top: 218,
    left: 40,
    width: 70,
    height: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    transform: [{ rotate: '16deg' }],
  },
  shapeRing: {
    position: 'absolute',
    top: 286,
    right: 14,
    width: 58,
    height: 58,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.26)',
  },
});
