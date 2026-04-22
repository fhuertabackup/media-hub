import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface LimitErrorState {
  visible: boolean;
  message: string;
  action?: string;
}

interface LimitErrorContextType {
  showLimitError: (message: string, action?: string) => void;
  hideLimitError: () => void;
}

const LimitErrorContext = createContext<LimitErrorContextType | undefined>(undefined);

export function LimitErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<LimitErrorState>({ visible: false, message: '' });

  const showLimitError = (message: string, action?: string) => {
    setError({ visible: true, message, action });
  };

  const hideLimitError = () => {
    setError({ visible: false, message: '' });
  };

  return (
    <LimitErrorContext.Provider value={{ showLimitError, hideLimitError }}>
      {children}
      <Modal
        visible={error.visible}
        transparent
        animationType="fade"
        onRequestClose={hideLimitError}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <View style={styles.iconWrap}>
              <Ionicons name="warning" size={48} color="#DC2626" />
            </View>
            <Text style={styles.title}>Límite Alcanzado</Text>
            <Text style={styles.message}>{error.message}</Text>
            {error.action && (
              <Text style={styles.action}>{error.action}</Text>
            )}
            <Pressable style={styles.button} onPress={hideLimitError}>
              <Text style={styles.buttonText}>Entendido</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </LimitErrorContext.Provider>
  );
}

export function useLimitError() {
  const context = useContext(LimitErrorContext);
  if (!context) {
    throw new Error('useLimitError must be used within LimitErrorProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  action: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#1E3A8A',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
