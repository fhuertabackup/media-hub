import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  actionLabel?: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  actionIconOnly?: boolean;
  onPressAction?: () => void;
}

export function SectionHeaderBanner({
  title,
  subtitle,
  icon,
  color: _color,
  actionLabel,
  actionIcon = 'camera',
  actionIconOnly = false,
  onPressAction,
}: Props) {
  return (
    <View style={styles.headerBanner}>
      <View style={styles.topRow}>
        <View style={styles.leftCol}>
          <View style={styles.headerIcon}>
            <Ionicons name={icon} size={22} color="#334155" />
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {onPressAction ? (
          <Pressable
            style={actionIconOnly ? styles.actionButtonRound : styles.actionButton}
            onPress={onPressAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel || 'Acción'}
          >
            <Ionicons name={actionIcon} size={actionIconOnly ? 26 : 20} color="#1E3A8A" />
            {!actionIconOnly && actionLabel ? (
              <Text style={styles.actionButtonText} numberOfLines={1}>
                {actionLabel}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.bottomRow}>
        <Text style={styles.headerSub} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBanner: {
    width: '100%',
    minHeight: 116,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    justifyContent: 'space-between',
  },
  topRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomRow: {
    paddingTop: 6,
    paddingBottom: 2,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 32,
    fontWeight: '900',
    marginTop: 6,
  },
  headerSub: {
    color: '#334155',
    fontSize: 15,
    fontWeight: '600',
  },
  actionButton: {
    minWidth: 94,
    maxWidth: 130,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.44)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionButtonRound: {
    width: 58,
    height: 58,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#1E3A8A',
    fontSize: 15,
    fontWeight: '800',
  },
});
