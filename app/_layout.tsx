import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  runOnJS 
} from 'react-native-reanimated';
import { LimitErrorProvider } from '../src/context/LimitErrorContext';
import { InitialLoadingScreen } from '../src/components/InitialLoadingScreen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { isChecking, isDownloading, downloadedUpdate, availableUpdate } = Updates.useUpdates();
  const [appReady, setAppReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [minTimeReady, setMinTimeReady] = useState(false);
  
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    async function prepare() {
      try {
        // Minimal wait for initial boot
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (e) {
        console.warn(e);
      } finally {
        setAppReady(true);
      }
    }
    prepare();
  }, []);

  // Update effect: Force minimum 6 seconds visibility if we enter update state
  // or a smaller minimum if just booting normally.
  useEffect(() => {
    if (isChecking || isDownloading) {
      setMinTimeReady(false);
      // If we are updating, give it 6 seconds to be seen
      const timer = setTimeout(() => setMinTimeReady(true), 6000);
      return () => clearTimeout(timer);
    } else {
      // If just booting normally, give it 2 seconds so it's not a flash
      const timer = setTimeout(() => setMinTimeReady(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [isChecking, isDownloading]);

  // Handle transition out
  useEffect(() => {
    const isUpdating = isChecking || isDownloading || availableUpdate;
    if (appReady && !isUpdating && minTimeReady) {
      // Hide native splash immediately since we have our JS overlay
      SplashScreen.hideAsync();
      
      // Animate out our custom overlay
      overlayOpacity.value = withTiming(0, { duration: 800 }, (finished) => {
        if (finished) {
          runOnJS(setShowOverlay)(false);
        }
      });
    }
  }, [appReady, isChecking, isDownloading, availableUpdate, minTimeReady]);

  useEffect(() => {
    if (downloadedUpdate) {
      Updates.reloadAsync();
    }
  }, [downloadedUpdate]);

  const animatedOverlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const isUpdating = isChecking || isDownloading;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LimitErrorProvider>
        <View style={styles.container}>
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          >
            <Stack.Screen name="(tabs)" />
          </Stack>

          {showOverlay && (
            <Animated.View style={[StyleSheet.absoluteFill, animatedOverlayStyle, { zIndex: 9999 }]}>
              <InitialLoadingScreen 
                minimal={!isUpdating} 
                message={isDownloading ? 'Aplicando mejoras...' : 'Buscando actualizaciones...'}
              />
            </Animated.View>
          )}
        </View>
      </LimitErrorProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
