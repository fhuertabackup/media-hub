import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { LimitErrorProvider } from '../src/context/LimitErrorContext';
import { InitialLoadingScreen } from '../src/components/InitialLoadingScreen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { isChecking, isDownloading, downloadedUpdate, availableUpdate } = Updates.useUpdates();
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Here you would load fonts, logic, etc.
        // For now we just simulate a small delay to make the transition smoother
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn(e);
      } finally {
        setAppReady(true);
      }
    }

    prepare();
  }, []);

  useEffect(() => {
    if (downloadedUpdate) {
      // If an update was downloaded at startup, reload the app to apply it.
      Updates.reloadAsync();
    }
  }, [downloadedUpdate]);

  useEffect(() => {
    // Hide splash screen when the app is ready and not doing updates
    if (appReady && !isChecking && !isDownloading && !availableUpdate) {
      SplashScreen.hideAsync();
    }
  }, [appReady, isChecking, isDownloading, availableUpdate]);

  // Show our beautiful loading screen if we are checking or downloading updates
  if (isChecking || isDownloading) {
    const message = isDownloading ? 'Descargando mejoras...' : 'Buscando actualizaciones...';
    return <InitialLoadingScreen message={message} />;
  }

  // Fallback to null (keeping native splash) if app isn't ready yet
  if (!appReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LimitErrorProvider>
        <Stack
          screenOptions={{
            headerShown: false,
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </LimitErrorProvider>
    </GestureHandlerRootView>
  );
}
