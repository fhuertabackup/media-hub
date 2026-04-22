import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  Share,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring } from 'react-native-reanimated';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import ViewShot from 'react-native-view-shot';
import { useFocusEffect } from 'expo-router';

import {
  addMediaItem,
  copyPhotoToAppStorage,
  deleteMediaItem,
  getAllMedia,
  updateMediaItem,
} from '../../src/lib/media-store';
import { generatePhotoGroupTitle, ocrPhoto } from '../../src/lib/photo-ocr-api';
import { useLimitError } from '../../src/context/LimitErrorContext';
import { analyzeBonoPhoto } from '../../src/lib/bono-api';
import {
  lookupFonasaPrices,
  lookupFonasaDetail,
  FonasaPriceItem,
  FonasaLookupResult,
  FonasaPharmacyDetail,
} from '../../src/lib/fonasa-price-api';
import { extractMedicationNames } from '../../src/lib/medication-extract-api';
import { SectionHeaderBanner } from '../../src/components/SectionHeaderBanner';
import { SoftScreenGradient } from '../../src/components/SoftScreenGradient';
import { PhotoItem } from '../../src/types/media';
import { formatDate, generateId } from '../../src/utils/format';

const PADDING = 20;

interface PhotoGroup {
  groupId: string;
  createdAt: string;
  items: PhotoItem[];
}

interface GroupPriceLookupState {
  loading: boolean;
  error?: string;
  results?: FonasaLookupResult[];
  latitud?: number;
  longitud?: number;
}

interface GroupStructuredData {
  medications: Array<{
    name: string;
    dose?: string;
    frequency?: string;
    duration?: string;
    notes?: string;
  }>;
  indications: string;
  doctor: string;
  patient: string;
  institution: string;
  date: string;
  rawText: string;
}

type MedicationEntry = GroupStructuredData['medications'][number];

interface MedicationPriceResolution {
  status: 'matched_exact' | 'matched_name_only' | 'mismatch' | 'no_presentation' | 'not_found';
  price: number | null;
  sourceResult?: FonasaLookupResult;
  sourceItem?: FonasaPriceItem;
}

function normalizeMatchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDoseTokens(value: string) {
  const normalized = normalizeMatchText(value)
    .replace(/\bmiligram(?:o|os|a|as)\b/g, 'mg')
    .replace(/\bgram(?:o|os|a|as)\b/g, 'g')
    .replace(/\bmicrogram(?:o|os|a|as)\b/g, 'mcg')
    .replace(/\bmcg\b/g, 'mcg')
    .replace(/\bug\b/g, 'mcg')
    .replace(/\bmililit(?:ro|ros)\b/g, 'ml')
    .replace(/\bm[l1]\b/g, 'ml')
    .replace(/\bunidades? internacionales?\b/g, 'ui')
    .replace(/\biu\b/g, 'ui');

  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|ug|ml|ui|iu)/gi;
  let match = re.exec(normalized);
  while (match) {
    const number = match[1].replace(',', '.');
    const unitRaw = match[2].toLowerCase();
    const unit = unitRaw === 'ug' || unitRaw === 'iu' ? (unitRaw === 'ug' ? 'mcg' : 'ui') : unitRaw;
    out.push(`${number}${unit}`);
    match = re.exec(normalized);
  }
  return [...new Set(out)];
}

function medicationMatchesQuery(med: MedicationEntry, result: FonasaLookupResult) {
  const medName = normalizeMatchText(med.name);
  const query = normalizeMatchText(result.query);
  return medName.includes(query) || query.includes(medName);
}

function resolveMedicationPrice(
  med: MedicationEntry,
  lookup?: GroupPriceLookupState
): MedicationPriceResolution {
  const relevantResults = (lookup?.results ?? []).filter((result) => medicationMatchesQuery(med, result));
  if (relevantResults.length === 0) {
    return { status: 'not_found', price: null };
  }

  const expectedTokens = extractDoseTokens(`${med.name} ${med.dose ?? ''}`);
  if (expectedTokens.length === 0) {
    const pricedByResult = relevantResults
      .map((result) => {
        const pricedItems = result.items.filter((item) => Number.isFinite(item.ofertaFonasa));
        if (pricedItems.length === 0) return null;
        const bestItem = pricedItems.reduce((acc, curr) =>
          (curr.ofertaFonasa as number) < (acc.ofertaFonasa as number) ? curr : acc
        );
        return { result, item: bestItem };
      })
      .filter(Boolean) as Array<{ result: FonasaLookupResult; item: FonasaPriceItem }>;

    if (pricedByResult.length === 0) {
      return { status: 'no_presentation', price: null };
    }

    const best = pricedByResult.reduce((acc, curr) =>
      (curr.item.ofertaFonasa as number) < (acc.item.ofertaFonasa as number) ? curr : acc
    );

    return {
      status: 'matched_name_only',
      price: best.item.ofertaFonasa as number,
      sourceResult: best.result,
      sourceItem: best.item,
    };
  }

  const candidates = relevantResults.flatMap((result) =>
    result.items
      .filter((item) => Number.isFinite(item.ofertaFonasa))
      .map((item) => ({ item, result }))
  );

  const strictMatches = candidates.filter(({ item }) => {
    const candidateTokens = extractDoseTokens(
      `${item.principioActivo1 ?? ''} ${item.presentacion ?? ''} ${item.formaFarmaceutica ?? ''}`
    );
    return expectedTokens.every((token) => candidateTokens.includes(token));
  });

  if (strictMatches.length === 0) {
    return { status: 'mismatch', price: null };
  }

  const best = strictMatches.reduce((acc, curr) =>
    (curr.item.ofertaFonasa as number) < (acc.item.ofertaFonasa as number) ? curr : acc
  );

  return {
    status: 'matched_exact',
    price: best.item.ofertaFonasa as number,
    sourceResult: best.result,
    sourceItem: best.item,
  };
}

function computeMedicationTotalApprox(medications: MedicationEntry[], lookup?: GroupPriceLookupState) {
  return medications.reduce((acc, med) => {
    const resolved = resolveMedicationPrice(med, lookup);
    return resolved.status === 'matched_exact' && resolved.price != null ? acc + resolved.price : acc;
  }, 0);
}

function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // si vuelve a escala 1, resetear posición
      if (scale.value <= 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <Animated.View style={{ flex: 1, width: '100%' }}>
        <Animated.Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, animatedStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

export default function BibliotecaScreen() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [tempPhotos, setTempPhotos] = useState<string[]>([]);
  const [sessionGroupId, setSessionGroupId] = useState<string>('');

  const [previewGroup, setPreviewGroup] = useState<PhotoGroup | null>(null);
  const [detailTab, setDetailTab] = useState<'receta' | 'bono'>('receta');
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);
  const [galleryGroup, setGalleryGroup] = useState<PhotoGroup | null>(null);
  const [shareCaptureGroup, setShareCaptureGroup] = useState<PhotoGroup | null>(null);

  const [addToGroup, setAddToGroup] = useState<{ groupId: string; type: 'receta' | 'bono' } | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const { showLimitError } = useLimitError();
  const [editingTitle, setEditingTitle] = useState('');
  const [retryingGroupIds, setRetryingGroupIds] = useState<Record<string, boolean>>({});
  const [rawOcrExpandedByGroup, setRawOcrExpandedByGroup] = useState<Record<string, boolean>>({});
  const [priceLookupByGroup, setPriceLookupByGroup] = useState<Record<string, GroupPriceLookupState>>({});
  const [priceDetailModal, setPriceDetailModal] = useState<{
    open: boolean;
    loading: boolean;
    error?: string;
    query?: string;
    pharmacies: FonasaPharmacyDetail[];
  }>({ open: false, loading: false, pharmacies: [] });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const autoPriceLookupTriedRef = useRef<Record<string, boolean>>({});
  const shareCaptureViewRef = useRef<ViewShot | null>(null);
  const shareCaptureResolverRef = useRef<((uri: string | null) => void) | null>(null);

  const loadPhotos = useCallback(async () => {
    try {
      setLoading(true);
      const all = await getAllMedia();
      setPhotos(all.filter((i): i is PhotoItem => i.type === 'photo'));
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudieron cargar las fotos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadPhotos();
    }, [loadPhotos])
  );

  const groupedPhotos = useMemo<PhotoGroup[]>(() => {
    const groups = new Map<string, PhotoItem[]>();

    photos.forEach((photo) => {
      const key = photo.photoGroupId || photo.id;
      const current = groups.get(key) || [];
      current.push(photo);
      groups.set(key, current);
    });

    return Array.from(groups.entries())
      .map(([groupId, items]) => {
        const sortedItems = [...items].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        return {
          groupId,
          createdAt: sortedItems[0]?.createdAt ?? new Date().toISOString(),
          items: sortedItems,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [photos]);

  const displayItems = useMemo(() => {
    return groupedPhotos.flatMap(group => {
      const out: Array<{ group: PhotoGroup; type: 'receta' | 'bono' }> = [];
      const ocrPending = group.items.some(i => i.ocrStatus === 'pending');
      const bonoPending = group.items.some(i => i.bonoStatus === 'pending');
      const anyPending = ocrPending || bonoPending;
      const hasBonoParsed = group.items.some(i => i.bonoParsed?.document_type === 'bono');

      if (anyPending) {
        out.push({ group, type: 'receta' });
        return out;
      }

      const hasRealReceta = !hasBonoParsed && group.items.some(i =>
        (i.ocrParsed?.medications?.length ?? 0) > 0 ||
        Boolean(i.ocrParsed?.patientName || i.ocrParsed?.doctorName || i.ocrParsed?.institution)
      );
      if (hasRealReceta) out.push({ group, type: 'receta' });
      if (hasBonoParsed) out.push({ group, type: 'bono' });
      if (out.length === 0) out.push({ group, type: 'receta' });
      return out;
    });
  }, [groupedPhotos]);

  const getCachedPriceLookupForGroup = useCallback((group: PhotoGroup): GroupPriceLookupState | undefined => {
    const cache = group.items.find((item) => item.priceLookupCache)?.priceLookupCache;
    if (!cache) return undefined;
    return {
      loading: false,
      error: '',
      results: cache.results,
      latitud: cache.latitud,
      longitud: cache.longitud,
    };
  }, []);

  const getEffectivePriceLookup = useCallback(
    (group: PhotoGroup): GroupPriceLookupState | undefined =>
      priceLookupByGroup[group.groupId] ?? getCachedPriceLookupForGroup(group),
    [getCachedPriceLookupForGroup, priceLookupByGroup]
  );

  const persistPriceLookupForGroup = useCallback(
    async (groupId: string, lookup: GroupPriceLookupState) => {
      if (!lookup.results || lookup.results.length === 0 || lookup.latitud == null || lookup.longitud == null) {
        return;
      }

      const all = await getAllMedia();
      const groupItems = all.filter(
        (item): item is PhotoItem => item.type === 'photo' && (item.photoGroupId || item.id) === groupId
      );

      for (const item of groupItems) {
        await updateMediaItem(item.id, {
          priceLookupCache: {
            provider: 'fonasa',
            updatedAt: new Date().toISOString(),
            latitud: lookup.latitud,
            longitud: lookup.longitud,
            results: lookup.results,
          },
        });
      }
    },
    []
  );

  useEffect(() => {
    if (groupedPhotos.length === 0) return;

    setPriceLookupByGroup((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const group of groupedPhotos) {
        if (next[group.groupId]) continue;
        const cached = getCachedPriceLookupForGroup(group);
        if (!cached) continue;
        next[group.groupId] = cached;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [getCachedPriceLookupForGroup, groupedPhotos]);

  useEffect(() => {
    if (!previewGroup) return;
    const updated = groupedPhotos.find(g => g.groupId === previewGroup.groupId);
    if (updated) setPreviewGroup(updated);
  }, [groupedPhotos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shareCaptureGroup) return;
    let active = true;

    const runCapture = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      let uri: string | null = null;
      try {
        uri = (await shareCaptureViewRef.current?.capture?.()) ?? null;
      } catch (error) {
        console.error(error);
      } finally {
        if (!active) return;
        shareCaptureResolverRef.current?.(uri);
        shareCaptureResolverRef.current = null;
        setShareCaptureGroup(null);
      }
    };

    runCapture();
    return () => {
      active = false;
    };
  }, [shareCaptureGroup]);

  const captureRecipeScreenshot = useCallback(
    async (group: PhotoGroup) =>
      new Promise<string | null>((resolve) => {
        if (shareCaptureResolverRef.current) {
          shareCaptureResolverRef.current(null);
          shareCaptureResolverRef.current = null;
        }
        shareCaptureResolverRef.current = resolve;
        setShareCaptureGroup(group);
      }),
    []
  );

  const getGroupTitle = (group: PhotoGroup) => {
    const persisted = group.items.find((item) => item.photoGroupTitle?.trim())?.photoGroupTitle?.trim();
    if (persisted) return persisted;
    return 'Documento sin título';
  };

  const getGroupTextLines = (group: PhotoGroup) => {
    const medicationLines = group.items.flatMap((item) => {
      const meds = item.ocrParsed?.medications ?? [];
      return meds.map((med) => {
        const details = [med.dose, med.frequency, med.duration].filter(Boolean).join(' · ');
        return details ? `${med.name}: ${details}` : med.name;
      });
    });

    if (medicationLines.length > 0) {
      return [...new Set(medicationLines)];
    }

    const lines = group.items
      .map((item) => item.ocrParsed?.rawText ?? item.ocrText ?? '')
      .join('\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line !== '[SIN_TEXTO]');

    return [...new Set(lines)];
  };

  const getGroupSummary = (group: PhotoGroup) => {
    const lines = getGroupTextLines(group);
    if (lines.length === 0) {
      const hasPending = group.items.some((item) => item.ocrStatus === 'pending');
      if (hasPending) return 'Analizando documento...';
      return '[SIN_TEXTO]';
    }
    return lines.slice(0, 3).join('\n');
  };

  const getGroupStructuredData = (group: PhotoGroup): GroupStructuredData => {
    const medications = group.items.flatMap((item) => item.ocrParsed?.medications ?? []);

    const firstWithMeta = group.items.find(
      (item) =>
        item.ocrParsed?.institution ||
        item.ocrParsed?.doctorName ||
        item.ocrParsed?.doctorLicense ||
        item.ocrParsed?.date ||
        item.ocrParsed?.patientName ||
        item.ocrParsed?.indicationsGeneral
    );

    const rawText = group.items
      .map((item) => item.ocrParsed?.rawText ?? item.ocrText ?? '')
      .join('\n')
      .trim();

    return {
      medications,
      indications: firstWithMeta?.ocrParsed?.indicationsGeneral?.trim() ?? '',
      doctor: [firstWithMeta?.ocrParsed?.doctorName, firstWithMeta?.ocrParsed?.doctorLicense]
        .filter(Boolean)
        .join(' · '),
      patient: firstWithMeta?.ocrParsed?.patientName?.trim() ?? '',
      institution: firstWithMeta?.ocrParsed?.institution?.trim() ?? '',
      date: firstWithMeta?.ocrParsed?.date?.trim() ?? '',
      rawText: rawText || '[SIN_TEXTO]',
    };
  };

  const canRetryGroupOcr = (group: PhotoGroup) => {
    const hasPending = group.items.some((item) => item.ocrStatus === 'pending');
    if (hasPending) return false;
    return group.items.some(
      (item) =>
        item.ocrStatus === 'error' ||
        !(item.ocrParsed?.rawText ?? item.ocrText)?.trim() ||
        (item.ocrParsed?.rawText ?? item.ocrText)?.trim() === '[SIN_TEXTO]'
    );
  };

  const isGroupProcessing = (group: PhotoGroup) =>
    group.items.some((item) => item.ocrStatus === 'pending' || item.bonoStatus === 'pending');

  const openCameraSession = async () => {
    if (!cameraPermission?.granted) {
      const response = await requestCameraPermission();
      if (!response.granted) {
        Alert.alert('Permiso requerido', 'Necesitas permitir acceso a la cámara.');
        return;
      }
    }

    setSessionGroupId(generateId());
    setTempPhotos([]);
    setCameraVisible(true);
  };

  const takePhotoToSession = async () => {
    if (!cameraRef.current || takingPhoto) return;

    try {
      setTakingPhoto(true);
      const result = await cameraRef.current.takePictureAsync({ quality: 0.95 });
      if (!result?.uri) throw new Error('No se pudo capturar la foto.');
      setTempPhotos((prev) => [...prev, result.uri]);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo capturar la foto.');
    } finally {
      setTakingPhoto(false);
    }
  };

  const removeTempPhoto = (index: number) => {
    setTempPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const pickPhotosToSession = async () => {
    if (pickingPhoto || savingGroup) return;

    try {
      setPickingPhoto(true);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso requerido', 'Necesitas permitir acceso a la galería.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
      });

      if (result.canceled) return;
      const uris = (result.assets ?? []).map((asset) => asset.uri).filter(Boolean);
      if (uris.length > 0) {
        setTempPhotos((prev) => [...prev, ...uris]);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudieron cargar fotos de la galería.');
    } finally {
      setPickingPhoto(false);
    }
  };

  const updateGroupTitle = useCallback(
    async (groupId: string, title: string) => {
      const all = await getAllMedia();
      const groupItems = all.filter(
        (item): item is PhotoItem => item.type === 'photo' && (item.photoGroupId || item.id) === groupId
      );
      for (const item of groupItems) {
        await updateMediaItem(item.id, { photoGroupTitle: title });
      }
    },
    []
  );

  const runPhotoOcr = useCallback(async (photo: PhotoItem) => {
    try {
      await updateMediaItem(photo.id, { ocrStatus: 'pending', ocrError: '' });
      await loadPhotos();
      const result = await ocrPhoto({ uri: photo.uri });
      await updateMediaItem(photo.id, {
        ocrText: result.text,
        ocrParsed: result.parsed,
        ocrStatus: 'done',
        ocrError: '',
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'No se pudo extraer texto.';
      if (error instanceof Error && message.includes('Límite')) {
        showLimitError(message, 'Contacta soporte para ampliar tu plan.');
        return;
      }
      await updateMediaItem(photo.id, { ocrStatus: 'error', ocrError: message });
    }
  }, [loadPhotos, showLimitError]);

  const runBonoAnalyze = useCallback(async (photo: PhotoItem) => {
    try {
      await updateMediaItem(photo.id, { bonoStatus: 'pending', bonoError: '' });
      await loadPhotos();
      const result = await analyzeBonoPhoto({ uri: photo.uri });
      await updateMediaItem(photo.id, {
        bonoParsed: result.parsed,
        bonoStatus: 'done',
        bonoError: '',
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'No se pudo analizar bono.';
      if (error instanceof Error && message.includes('Límite')) {
        showLimitError(message, 'Contacta soporte para ampliar tu plan.');
        return;
      }
      await updateMediaItem(photo.id, { bonoStatus: 'error', bonoError: message });
    }
  }, [loadPhotos, showLimitError]);

  const autoGenerateGroupTitle = useCallback(
    async (groupId: string) => {
      const all = await getAllMedia();
      const groupItems = all.filter(
        (item): item is PhotoItem => item.type === 'photo' && (item.photoGroupId || item.id) === groupId
      );
      const alreadyHasTitle = groupItems.some((item) => item.photoGroupTitle?.trim());
      if (alreadyHasTitle) return;

      const patientName = groupItems
        .map((item) => item.ocrParsed?.patientName?.trim() ?? '')
        .find((name) => name.length > 0 && name !== 'PACIENTE_NO_IDENTIFICADO');
      if (patientName) {
        const patientTitle = patientName.slice(0, 60).trim();
        for (const item of groupItems) {
          await updateMediaItem(item.id, { photoGroupTitle: patientTitle });
        }
        return;
      }

      const combinedText = groupItems
        .map((item) => item.ocrParsed?.rawText ?? item.ocrText ?? '')
        .join('\n')
        .trim();

      if (!combinedText || combinedText === '[SIN_TEXTO]') return;

      try {
        const result = await generatePhotoGroupTitle(combinedText);
        const title = result.title.trim() || buildFallbackGroupTitle(groupItems[0]?.createdAt);
        for (const item of groupItems) {
          await updateMediaItem(item.id, { photoGroupTitle: title });
        }
      } catch (error) {
        console.error(error);
        const fallback = buildFallbackGroupTitle(groupItems[0]?.createdAt);
        for (const item of groupItems) {
          await updateMediaItem(item.id, { photoGroupTitle: fallback });
        }
      }
    },
    []
  );

  const savePhotoGroup = async () => {
    if (tempPhotos.length === 0 || savingGroup) {
      Alert.alert('Sin fotos', 'Captura al menos una foto para guardar el grupo.');
      return;
    }

    try {
      setSavingGroup(true);
      const groupId = sessionGroupId || generateId();
      const baseCount = photos.length;
      const createdItems: PhotoItem[] = [];

      for (let i = 0; i < tempPhotos.length; i += 1) {
        const sourceUri = tempPhotos[i];
        const id = generateId();
        const storedUri = await copyPhotoToAppStorage(sourceUri, `photo-${id}.jpg`);

        const item: PhotoItem = {
          id,
          type: 'photo',
          title: `Foto ${baseCount + i + 1}`,
          uri: storedUri,
          createdAt: new Date().toISOString(),
          photoGroupId: groupId,
          ocrStatus: 'pending',
          bonoStatus: 'pending',
        };

        await addMediaItem(item);
        createdItems.push(item);
      }

      setCameraVisible(false);
      setTempPhotos([]);
      setSessionGroupId('');
      await loadPhotos();

      for (const item of createdItems) {
        await runPhotoOcr(item);
        await loadPhotos();
        await runBonoAnalyze(item);
        await loadPhotos();
      }
      await autoGenerateGroupTitle(groupId);
      await loadPhotos();
      Alert.alert('Evento guardado', `Se guardaron ${createdItems.length} fotos.`);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar el evento de fotos.');
    } finally {
      setSavingGroup(false);
    }
  };

  const retryGroupOcr = useCallback(
    async (group: PhotoGroup) => {
      if (retryingGroupIds[group.groupId]) return;
      try {
        setRetryingGroupIds((prev) => ({ ...prev, [group.groupId]: true }));
        for (const photo of group.items) {
          await runPhotoOcr(photo);
          await runBonoAnalyze(photo);
        }
        await loadPhotos();
        await autoGenerateGroupTitle(group.groupId);
        await loadPhotos();
      } catch (error) {
        console.error(error);
        Alert.alert('Error', 'No se pudo reintentar el OCR del evento.');
      } finally {
        setRetryingGroupIds((prev) => ({ ...prev, [group.groupId]: false }));
      }
    },
    [autoGenerateGroupTitle, loadPhotos, retryingGroupIds, runPhotoOcr, runBonoAnalyze]
  );

  const addPhotoToGroup = useCallback(
    async (groupId: string, type: 'receta' | 'bono') => {
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permiso requerido', 'Necesitas permitir acceso a la galería.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: false,
          quality: 1,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        const sourceUri = result.assets[0].uri;
        const id = generateId();
        const storedUri = await copyPhotoToAppStorage(sourceUri, `photo-${id}.jpg`);
        const item: PhotoItem = {
          id,
          type: 'photo',
          title: `Foto`,
          uri: storedUri,
          createdAt: new Date().toISOString(),
          photoGroupId: groupId,
          ocrStatus: type === 'receta' ? 'pending' : undefined,
          bonoStatus: type === 'bono' ? 'pending' : undefined,
        };
        await addMediaItem(item);
        await loadPhotos();
        if (type === 'receta') {
          await runPhotoOcr(item);
          await loadPhotos();
          await autoGenerateGroupTitle(groupId);
        } else {
          await runBonoAnalyze(item);
        }
        await loadPhotos();
      } catch (error) {
        console.error(error);
        Alert.alert('Error', 'No se pudo agregar la foto.');
      }
    },
    [addMediaItem, autoGenerateGroupTitle, copyPhotoToAppStorage, loadPhotos, runBonoAnalyze, runPhotoOcr]
  );

  const scanMissingForGroup = useCallback(
    async (group: PhotoGroup, type: 'receta' | 'bono') => {
      if (retryingGroupIds[group.groupId]) return;
      try {
        setRetryingGroupIds((prev) => ({ ...prev, [group.groupId]: true }));
        for (const photo of group.items) {
          if (type === 'receta') await runPhotoOcr(photo);
          else await runBonoAnalyze(photo);
        }
        await loadPhotos();
        if (type === 'receta') await autoGenerateGroupTitle(group.groupId);
        await loadPhotos();
      } catch (error) {
        console.error(error);
      } finally {
        setRetryingGroupIds((prev) => ({ ...prev, [group.groupId]: false }));
      }
    },
    [autoGenerateGroupTitle, loadPhotos, retryingGroupIds, runBonoAnalyze, runPhotoOcr]
  );

  const confirmDeletePhoto = (photo: PhotoItem) => {
    Alert.alert('Eliminar foto', '¿Quieres eliminar esta foto del evento?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMediaItem(photo);
            await loadPhotos();
            setPreviewGroup((prev) => {
              if (!prev) return prev;
              const items = prev.items.filter((item) => item.id !== photo.id);
              return items.length ? { ...prev, items } : null;
            });
            setGalleryGroup((prev) => {
              if (!prev) return prev;
              const items = prev.items.filter((item) => item.id !== photo.id);
              return items.length ? { ...prev, items } : null;
            });
          } catch (error) {
            console.error(error);
            Alert.alert('Error', 'No se pudo eliminar la foto.');
          }
        },
      },
    ]);
  };

  const confirmDeleteGroup = (group: PhotoGroup) => {
    Alert.alert('Eliminar evento', `¿Eliminar las ${group.items.length} foto(s) de este evento?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar todo',
        style: 'destructive',
        onPress: async () => {
          try {
            for (const photo of group.items) {
              await deleteMediaItem(photo);
            }
            await loadPhotos();
            setPreviewGroup(null);
            setGalleryGroup(null);
          } catch (error) {
            console.error(error);
            Alert.alert('Error', 'No se pudo eliminar el evento.');
          }
        },
      },
    ]);
  };

  const openEditTitle = (group: PhotoGroup) => {
    setEditingGroupId(group.groupId);
    setEditingTitle(getGroupTitle(group));
  };

  const saveEditedTitle = async () => {
    if (!editingGroupId) return;
    const clean = editingTitle.trim();
    if (!clean) {
      Alert.alert('Título requerido', 'Escribe un título para el documento.');
      return;
    }

    try {
      await updateGroupTitle(editingGroupId, clean);
      await loadPhotos();
      setEditingGroupId(null);
      setEditingTitle('');
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo actualizar el título.');
    }
  };

  const buildFallbackGroupTitle = (isoDate?: string) => {
    const date = isoDate ? new Date(isoDate) : new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `Documento ${day}/${month} ${hours}:${minutes}`;
  };

  const shareGroupRecipe = async (group: PhotoGroup, type: 'receta' | 'bono' = 'receta') => {
    try {
      if (type === 'bono') {
        const bonoParsed = group.items.map(i => i.bonoParsed).find(Boolean);
        if (!bonoParsed) {
          Alert.alert('Sin datos', 'No hay datos de bono para compartir.');
          return;
        }
        const itemLines = bonoParsed.items?.map(i =>
          `- ${i.descripcion || i.codigo}: copago ${i.copago ?? 'N/D'}, a pagar ${i.valor_a_pagar ?? 'N/D'}`
        ).join('\n') || '- Sin prestaciones';
        const message = [
          `Bono: ${getGroupTitle(group)}`,
          bonoParsed.beneficiario_nombre ? `Beneficiario: ${bonoParsed.beneficiario_nombre}` : '',
          bonoParsed.profesional_nombre ? `Profesional: ${bonoParsed.profesional_nombre}` : '',
          bonoParsed.prestador_nombre ? `Centro: ${bonoParsed.prestador_nombre}` : '',
          bonoParsed.fecha_atencion ? `Fecha: ${bonoParsed.fecha_atencion}` : '',
          '',
          'Prestaciones:',
          itemLines,
          '',
          bonoParsed.monto_a_pagar ? `Total a pagar: ${bonoParsed.monto_a_pagar}` : '',
        ].filter(Boolean).join('\n');
        await Share.share({ message, title: getGroupTitle(group) });
        return;
      }

      const screenshotUri = await captureRecipeScreenshot(group);
      if (screenshotUri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(screenshotUri, {
          dialogTitle: getGroupTitle(group),
          mimeType: 'image/png',
        });
        return;
      }

      const data = getGroupStructuredData(group);
      const medText =
        data.medications.length > 0
          ? data.medications
              .map((med) => {
                const detail = [med.dose, med.frequency, med.duration, med.notes]
                  .filter(Boolean)
                  .join(' · ');
                return detail ? `- ${med.name}: ${detail}` : `- ${med.name}`;
              })
              .join('\n')
          : '- Sin medicamentos detectados';

      const message = [
        `Receta: ${getGroupTitle(group)}`,
        data.patient ? `Paciente: ${data.patient}` : '',
        data.date ? `Fecha: ${data.date}` : '',
        '',
        'Medicamentos:',
        medText,
        '',
        `Indicaciones: ${data.indications || 'No detectadas'}`,
        '',
        'Texto OCR:',
        data.rawText,
      ]
        .filter(Boolean)
        .join('\n');

      await Share.share({ message, title: getGroupTitle(group) });
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo compartir.');
    }
  };

  const toggleRawOcrAccordion = (groupId: string) => {
    setRawOcrExpandedByGroup((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getPriceQueriesForGroup = async (group: PhotoGroup) => {
    const data = getGroupStructuredData(group);
    const namesFromStructured = data.medications
      .map((med) => med.name.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (namesFromStructured.length > 0) {
      return [...new Set(namesFromStructured)];
    }
    const aiNames = await extractMedicationNames(data.rawText || '');
    return [...new Set(aiNames)];
  };

  const lookupGroupPrices = async (group: PhotoGroup, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const queries = await getPriceQueriesForGroup(group);
    if (queries.length === 0) {
      if (!silent) {
        Alert.alert('Sin medicamentos', 'No se detectaron medicamentos para consultar precios.');
      }
      return;
    }

    try {
      const current = getEffectivePriceLookup(group);
      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: { loading: true, error: '', results: current?.results },
      }));

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        if (silent) {
          setPriceLookupByGroup((prev) => ({
            ...prev,
            [group.groupId]: { ...current, loading: false, error: '' },
          }));
          return;
        }
        throw new Error('Debes permitir ubicación para consultar precios cercanos.');
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const result = await lookupFonasaPrices({
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
        medications: queries,
      });

      const nextLookup: GroupPriceLookupState = {
        loading: false,
        error: '',
        results: result.results,
        latitud: position.coords.latitude,
        longitud: position.coords.longitude,
      };

      await persistPriceLookupForGroup(group.groupId, nextLookup);

      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: nextLookup,
      }));
    } catch (error) {
      console.error(error);
      if (silent) {
        const current = getEffectivePriceLookup(group);
        setPriceLookupByGroup((prev) => ({
          ...prev,
          [group.groupId]: {
            loading: false,
            error: '',
            results: current?.results ?? [],
            latitud: current?.latitud,
            longitud: current?.longitud,
          },
        }));
        return;
      }
      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: {
          loading: false,
          error: error instanceof Error ? error.message : 'No se pudieron consultar precios.',
          results: getEffectivePriceLookup(group)?.results ?? [],
          latitud: getEffectivePriceLookup(group)?.latitud,
          longitud: getEffectivePriceLookup(group)?.longitud,
        },
      }));
    }
  };

  useEffect(() => {
    groupedPhotos.forEach((group) => {
      if (autoPriceLookupTriedRef.current[group.groupId]) return;
      if (isGroupProcessing(group)) return;

      const hasTranscription = group.items.some((item) => {
        const text = (item.ocrParsed?.rawText ?? item.ocrText ?? '').trim();
        return item.ocrStatus === 'done' && text.length > 0 && text !== '[SIN_TEXTO]';
      });
      if (!hasTranscription) return;

      const effective = getEffectivePriceLookup(group);
      const hasCachedPrices = Boolean(effective?.results && effective.results.length > 0);
      if (hasCachedPrices) {
        autoPriceLookupTriedRef.current[group.groupId] = true;
        return;
      }

      autoPriceLookupTriedRef.current[group.groupId] = true;
      void lookupGroupPrices(group, { silent: true });
    });
  }, [getEffectivePriceLookup, groupedPhotos, lookupGroupPrices]);

  const openPriceDetail = async (
    group: PhotoGroup,
    result: FonasaLookupResult,
    selectedItem?: FonasaPriceItem
  ) => {
    const context = getEffectivePriceLookup(group);
    const latitud = context?.latitud;
    const longitud = context?.longitud;
    const firstItem = selectedItem ?? result.items?.[0];

    if (!latitud || !longitud || !firstItem?.registroSanitario || !firstItem.presentacion || !firstItem.laboratorio) {
      Alert.alert('Faltan datos', 'Primero vuelve a consultar precios para obtener contexto completo.');
      return;
    }

    try {
      setPriceDetailModal({
        open: true,
        loading: true,
        error: '',
        query: result.query,
        pharmacies: [],
      });

      const pharmacies = await lookupFonasaDetail({
        latitud,
        longitud,
        nombreMedicamento: result.query,
        registroSanitario: firstItem.registroSanitario,
        presentacion: firstItem.presentacion,
        laboratorio: firstItem.laboratorio,
      });

      setPriceDetailModal({
        open: true,
        loading: false,
        error: '',
        query: result.query,
        pharmacies,
      });
    } catch (error) {
      console.error(error);
      setPriceDetailModal({
        open: true,
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo cargar detalle de farmacias.',
        query: result.query,
        pharmacies: [],
      });
    }
  };

  const openPharmacyRoute = async (pharmacy: FonasaPharmacyDetail) => {
    if (pharmacy.latitud == null || pharmacy.longitud == null) {
      Alert.alert('Sin coordenadas', 'Esta farmacia no tiene coordenadas disponibles.');
      return;
    }

    try {
      const destination = `${pharmacy.latitud},${pharmacy.longitud}`;
      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert('No disponible', 'No se pudo abrir la app de mapas.');
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo abrir la ruta en mapas.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <SoftScreenGradient color="#34D399" />
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        <View style={styles.headerWrap}>
          <SectionHeaderBanner
            title="Documento médico"
            subtitle={`${photos.length} foto${photos.length !== 1 ? 's' : ''} guardada${photos.length !== 1 ? 's' : ''}`}
            icon="images"
            color="#312E81"
            actionLabel="Agregar foto"
            actionIconOnly
            onPressAction={openCameraSession}
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#6D28D9" />
            <Text style={styles.centerText}>Cargando documentos...</Text>
          </View>
        ) : groupedPhotos.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={42} color="#059669" />
            <Text style={styles.emptyTitle}>Sin documentos médicos</Text>
            <Text style={styles.emptyText}>
              Toca “Agregar foto” para capturar una receta o bono médico.
            </Text>
          </View>
        ) : (
          displayItems.map(({ group, type }) => {
            const isPending = group.items.some(i => i.ocrStatus === 'pending' || i.bonoStatus === 'pending');
            const isDone = type === 'receta'
              ? group.items.some(i => i.ocrStatus === 'done')
              : group.items.some(i => i.bonoParsed);

            const name = type === 'receta'
              ? group.items.map(i => i.ocrParsed?.patientName).find(Boolean) || ''
              : group.items.map(i => i.bonoParsed?.beneficiario_nombre).find(Boolean) || '';
            const doctor = type === 'receta'
              ? group.items.map(i => i.ocrParsed?.doctorName).find(Boolean) || ''
              : group.items.map(i => i.bonoParsed?.profesional_nombre).find(Boolean) || '';
            const date = type === 'receta'
              ? group.items.map(i => i.ocrParsed?.date).find(Boolean) || ''
              : group.items.map(i => i.bonoParsed?.fecha_atencion || i.bonoParsed?.fecha_emision).find(Boolean) || '';
            const center = type === 'receta'
              ? group.items.map(i => i.ocrParsed?.institution).find(Boolean) || ''
              : group.items.map(i => i.bonoParsed?.prestador_nombre).find(Boolean) || '';

            const isReceta = type === 'receta';
            const accentColor = isReceta ? '#10B981' : '#6366F1';
            const badgeBg = isReceta ? '#D1FAE518' : '#6366F118';
            const badgeBorder = isReceta ? '#10B98130' : '#6366F130';

            return (
              <Pressable
                key={`${group.groupId}-${type}`}
                style={[styles.groupCard, isPending && styles.groupCardProcessing]}
                onPress={() => { setDetailTab(type); setPreviewGroup(group); }}
              >
                <View style={styles.groupCardTop}>
                  <View style={[styles.docTypeBadge, isPending
                    ? { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }
                    : { backgroundColor: badgeBg, borderColor: badgeBorder }
                  ]}>
                    {isPending
                      ? <ActivityIndicator size="small" color="#94A3B8" />
                      : <Ionicons name={isReceta ? 'document-text' : 'receipt'} size={14} color={accentColor} />
                    }
                    <Text style={[styles.docTypeBadgeText, { color: isPending ? '#94A3B8' : accentColor }]}>
                      {isPending ? 'Analizando documento...' : isReceta ? 'Receta' : 'Bono'}
                    </Text>
                  </View>
                  <View style={styles.groupActions}>
                    <Pressable style={styles.iconButton} onPress={() => openEditTitle(group)}>
                      <Ionicons name="create-outline" size={16} color="#0F172A" />
                    </Pressable>
                    <Pressable style={styles.iconButton} onPress={() => shareGroupRecipe(group, type)}>
                      <Ionicons name="share-outline" size={16} color="#1E3A8A" />
                    </Pressable>
                    <Pressable style={styles.iconButtonDanger} onPress={() => confirmDeleteGroup(group)}>
                      <Ionicons name="trash-outline" size={16} color="#DC2626" />
                    </Pressable>
                  </View>
                </View>

                <Text style={styles.groupTitle} numberOfLines={1}>
                  {name || getGroupTitle(group)}
                </Text>
                {doctor ? <Text style={styles.groupDoctor} numberOfLines={1}>{doctor}</Text> : null}

                <View style={styles.groupMeta}>
                  {date ? (
                    <View style={styles.groupMetaItem}>
                      <Ionicons name="calendar-outline" size={12} color="#94A3B8" />
                      <Text style={styles.groupMetaText}>{date}</Text>
                    </View>
                  ) : null}
                  {center ? (
                    <View style={styles.groupMetaItem}>
                      <Ionicons name="business-outline" size={12} color="#94A3B8" />
                      <Text style={styles.groupMetaText} numberOfLines={1}>{center}</Text>
                    </View>
                  ) : null}
                  {!date && !center && !isPending ? (
                    <Text style={styles.groupMetaText}>{formatDate(group.createdAt)}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={cameraVisible} animationType="slide">
        <View style={styles.cameraScreen}>
          <CameraView ref={cameraRef} style={styles.camera} />

          <SafeAreaView style={styles.cameraOverlay}>
            <View style={styles.cameraTopRow}>
              <Pressable style={styles.cameraGhostBtn} onPress={() => setCameraVisible(false)}>
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </Pressable>
              <View style={styles.cameraCountBadge}>
                <Text style={styles.cameraCountText}>{tempPhotos.length} foto(s)</Text>
              </View>
            </View>

            <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.previewStrip}
              >
                {tempPhotos.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.previewThumbWrap}>
                    <Image source={{ uri }} style={styles.previewThumb} />
                    <Pressable style={styles.previewDeleteBtn} onPress={() => removeTempPhoto(index)}>
                      <Ionicons name="close" size={15} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.cameraActionsRow}>
                <Pressable
                  style={styles.captureCircle}
                  onPress={takePhotoToSession}
                  disabled={takingPhoto || pickingPhoto || savingGroup}
                >
                  <View style={styles.captureCircleInner} />
                </Pressable>

                <Pressable
                  style={[styles.galleryCircle, (pickingPhoto || savingGroup) && { opacity: 0.6 }]}
                  onPress={pickPhotosToSession}
                  disabled={pickingPhoto || savingGroup}
                >
                  {pickingPhoto ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="images-outline" size={28} color="#FFFFFF" />
                  )}
                </Pressable>

                <Pressable
                  style={[styles.saveGroupButton, tempPhotos.length === 0 && { opacity: 0.55 }]}
                  onPress={savePhotoGroup}
                  disabled={tempPhotos.length === 0 || savingGroup}
                >
                  {savingGroup ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="save-outline" size={20} color="#FFFFFF" />
                  )}
                  <Text style={styles.saveGroupText}>{savingGroup ? 'Guardando...' : 'Guardar evento'}</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={previewGroup !== null} animationType="slide" transparent>
        <View style={styles.previewBackdrop}>
          <SafeAreaView style={styles.previewSafe}>
            <View style={styles.previewTopRow}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {previewGroup ? getGroupTitle(previewGroup) : ''}
              </Text>
              <Pressable
                style={styles.previewCloseBtn}
                onPress={() => {
                  setPreviewGroup(null);
                  setGalleryGroup(null);
                }}
              >
                <Ionicons name="close" size={26} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.groupModalCard}>
              {previewGroup ? (
                <View style={styles.groupModalPhotosHeader}>
                  <Pressable style={styles.detailPhotoStackButton} onPress={() => setGalleryGroup(previewGroup)}>
                    <Ionicons name="images-outline" size={28} color="#1E3A8A" />
                    <Text style={styles.photoCountNumber}>{previewGroup.items.length}</Text>
                    <Text style={styles.photoCountLabel}>fotos</Text>
                  </Pressable>

                  {(() => {
                    if (detailTab === 'bono') {
                      const bonoParsed = previewGroup.items.map(i => i.bonoParsed).find(Boolean);
                      const totalPagar = bonoParsed?.monto_a_pagar;
                      return (
                        <View style={styles.totalApproxCard}>
                          <Text style={styles.totalApproxLabel}>A PAGAR</Text>
                          <Text style={[styles.totalApproxValue, { color: '#FFFFFF' }]}>
                            {totalPagar || 'S/P'}
                          </Text>
                        </View>
                      );
                    }
                    const priceLookup = getEffectivePriceLookup(previewGroup);
                    const totalApprox = computeMedicationTotalApprox(
                      getGroupStructuredData(previewGroup).medications,
                      priceLookup
                    );
                    return (
                      <View style={styles.totalApproxCard}>
                        <Text style={styles.totalApproxLabel}>TOTAL APROX</Text>
                        <Text style={styles.totalApproxValue}>
                          {totalApprox > 0 ? `$${Math.round(totalApprox)}` : 'S/P'}
                        </Text>
                      </View>
                    );
                  })()}
                </View>
              ) : null}

              <View style={styles.groupModalTextWrap}>
                <View style={styles.modalTextHeader}>
                  <Text style={styles.summaryLabel}>{detailTab === 'receta' ? 'Receta médica' : 'Bono'}</Text>
                  <View style={styles.modalActions}>
                    {previewGroup && detailTab === 'receta' ? (
                      <Pressable
                        style={styles.shareRecipeButton}
                        onPress={() => lookupGroupPrices(previewGroup)}
                      >
                        {getEffectivePriceLookup(previewGroup)?.loading ? (
                          <ActivityIndicator size="small" color="#1E3A8A" />
                        ) : (
                          <Ionicons name="cash-outline" size={14} color="#1E3A8A" />
                        )}
                        <Text style={styles.shareRecipeText}>Precios</Text>
                      </Pressable>
                    ) : null}
                    {previewGroup ? (
                      <Pressable style={styles.shareRecipeButton} onPress={() => shareGroupRecipe(previewGroup, detailTab)}>
                        <Ionicons name="share-outline" size={14} color="#1E3A8A" />
                        <Text style={styles.shareRecipeText}>Compartir</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <ScrollView contentContainerStyle={styles.richContent}>
                  {previewGroup && detailTab === 'bono' ? (() => {
                    const bonoParsed = previewGroup.items.map(i => i.bonoParsed).find(Boolean);
                    const bonoStatus = previewGroup.items.find(i => i.bonoStatus)?.bonoStatus;
                    if (bonoStatus === 'pending' && !bonoParsed) {
                      return (
                        <View style={styles.processingRow}>
                          <ActivityIndicator size="small" color="#6366F1" />
                          <Text style={styles.processingText}>Analizando bono...</Text>
                        </View>
                      );
                    }
                    if (!bonoParsed) {
                      return (
                        <View style={styles.bonoEmptyWrap}>
                          <Ionicons name="receipt-outline" size={36} color="#CBD5E1" />
                          <Text style={styles.bonoEmptyTitle}>Bono no escaneado</Text>
                          <Text style={styles.bonoEmptyText}>Este grupo no tiene un bono. Agrega una foto del bono para analizarlo.</Text>
                          <Pressable
                            style={[styles.addPhotoBtn, { backgroundColor: '#6366F1' }]}
                            onPress={() => previewGroup && addPhotoToGroup(previewGroup.groupId, 'bono')}
                          >
                            <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                            <Text style={styles.addPhotoBtnText}>Agregar foto de bono</Text>
                          </Pressable>
                        </View>
                      );
                    }
                    return (
                      <>
                        {bonoParsed.beneficiario_nombre ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Beneficiario</Text>
                            <Text style={styles.sectionText}>{bonoParsed.beneficiario_nombre}</Text>
                            {bonoParsed.beneficiario_rut ? <Text style={styles.sectionSubText}>RUT: {bonoParsed.beneficiario_rut}</Text> : null}
                          </View>
                        ) : null}
                        {bonoParsed.profesional_nombre ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Profesional</Text>
                            <Text style={styles.sectionText}>{bonoParsed.profesional_nombre}</Text>
                            {bonoParsed.profesional_rut ? <Text style={styles.sectionSubText}>RUT: {bonoParsed.profesional_rut}</Text> : null}
                          </View>
                        ) : null}
                        {bonoParsed.prestador_nombre ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Centro médico</Text>
                            <Text style={styles.sectionText}>{bonoParsed.prestador_nombre}</Text>
                          </View>
                        ) : null}
                        {(bonoParsed.fecha_atencion || bonoParsed.fecha_emision) ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Fechas</Text>
                            {bonoParsed.fecha_atencion ? <Text style={styles.sectionText}>Atención: {bonoParsed.fecha_atencion}</Text> : null}
                            {bonoParsed.fecha_emision ? <Text style={styles.sectionSubText}>Emisión: {bonoParsed.fecha_emision}</Text> : null}
                          </View>
                        ) : null}
                        {bonoParsed.numero_bono ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>N° Bono</Text>
                            <Text style={styles.sectionText}>{bonoParsed.numero_bono}</Text>
                          </View>
                        ) : null}
                        {bonoParsed.items && bonoParsed.items.length > 0 ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Prestaciones</Text>
                            {bonoParsed.items.map((item, idx) => (
                              <View key={idx} style={styles.bonoItem}>
                                <Text style={styles.bonoItemDesc}>{item.descripcion || item.codigo}</Text>
                                <View style={styles.bonoItemRow}>
                                  {item.copago ? <Text style={styles.bonoItemDetail}>Copago: {item.copago}</Text> : null}
                                  {item.valor_a_pagar ? <Text style={styles.bonoItemDetail}>A pagar: {item.valor_a_pagar}</Text> : null}
                                  {item.bonificacion ? <Text style={styles.bonoItemDetail}>Bonif.: {item.bonificacion}</Text> : null}
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        {(bonoParsed.monto_total || bonoParsed.copago_total || bonoParsed.monto_a_pagar) ? (
                          <View style={[styles.sectionBlock, styles.bonoTotalsBlock]}>
                            <Text style={styles.sectionTitle}>Totales</Text>
                            {bonoParsed.monto_total ? <Text style={styles.sectionText}>Total: {bonoParsed.monto_total}</Text> : null}
                            {bonoParsed.bonificacion_total ? <Text style={styles.sectionSubText}>Bonificación: {bonoParsed.bonificacion_total}</Text> : null}
                            {bonoParsed.copago_total ? <Text style={styles.sectionSubText}>Copago total: {bonoParsed.copago_total}</Text> : null}
                            {bonoParsed.monto_a_pagar ? (
                              <Text style={styles.bonoMontoPagar}>A pagar: {bonoParsed.monto_a_pagar}</Text>
                            ) : null}
                          </View>
                        ) : null}
                        {bonoParsed.provider ? (
                          <View style={styles.sectionBlock}>
                            <Text style={styles.sectionTitle}>Proveedor</Text>
                            <Text style={styles.sectionText}>{bonoParsed.provider}</Text>
                          </View>
                        ) : null}
                      </>
                    );
                  })() : null}
                  {previewGroup && detailTab === 'receta' ? (
                    (() => {
                      const recetaStatus = previewGroup.items.find(i => i.ocrStatus)?.ocrStatus;
                      if (recetaStatus === 'pending') {
                        return (
                          <View style={styles.processingRow}>
                            <ActivityIndicator size="small" color="#10B981" />
                            <Text style={styles.processingText}>Analizando documento...</Text>
                          </View>
                        );
                      }
                      const data = getGroupStructuredData(previewGroup);
                      const hasRealRecetaData =
                        data.medications.length > 0 ||
                        Boolean(data.patient || data.doctor || data.institution);
                      if (!hasRealRecetaData) {
                        return (
                          <View style={styles.bonoEmptyWrap}>
                            <Ionicons name="document-text-outline" size={36} color="#CBD5E1" />
                            <Text style={styles.bonoEmptyTitle}>Receta no escaneada</Text>
                            <Text style={styles.bonoEmptyText}>Este grupo no tiene una receta médica. Agrega una foto de receta para analizarla.</Text>
                            <Pressable
                              style={styles.addPhotoBtn}
                              onPress={() => previewGroup && addPhotoToGroup(previewGroup.groupId, 'receta')}
                            >
                              <Ionicons name="camera-outline" size={16} color="#FFFFFF" />
                              <Text style={styles.addPhotoBtnText}>Agregar foto de receta</Text>
                            </Pressable>
                          </View>
                        );
                      }
                      const priceLookup = getEffectivePriceLookup(previewGroup);
                      const showMedicationSection =
                        data.medications.length > 0 ||
                        Boolean(priceLookup?.loading || priceLookup?.error) ||
                        Boolean(priceLookup?.results && priceLookup.results.length > 0);
                      const hasStructured =
                        data.medications.length > 0 ||
                        Boolean(data.indications || data.doctor || data.patient || data.institution || data.date);

                      return (
                        <>
                          {hasStructured ? (
                            <>
                              {showMedicationSection ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Medicamentos y precios</Text>
                                  {data.medications.length > 0 ? (
                                    data.medications.map((med, index) => (
                                      <View
                                        key={`${med.name}-${index}`}
                                        style={[
                                          styles.medCard,
                                          (() => {
                                            const resolved = resolveMedicationPrice(med, priceLookup);
                                            const lookedUp = Boolean(priceLookup?.results);
                                            return lookedUp &&
                                              resolved.status !== 'matched_exact' &&
                                              resolved.status !== 'matched_name_only'
                                              ? styles.medCardMissing
                                              : null;
                                          })(),
                                        ]}
                                      >
                                        <Text style={styles.medName}>{med.name}</Text>
                                        {[med.dose, med.frequency, med.duration, med.notes]
                                          .filter(Boolean)
                                          .join(' · ') ? (
                                          <Text style={styles.medDetail}>
                                            {[med.dose, med.frequency, med.duration, med.notes]
                                              .filter(Boolean)
                                              .join(' · ')}
                                          </Text>
                                        ) : null}

                                        {(() => {
                                          const resolved = resolveMedicationPrice(med, priceLookup);
                                          const hasPrice =
                                            (resolved.status === 'matched_exact' ||
                                              resolved.status === 'matched_name_only') &&
                                            resolved.price != null;
                                          const sourceResult = resolved.sourceResult;
                                          const lookedUp = Boolean(priceLookup?.results);
                                          return (
                                            <View style={styles.medPriceRow}>
                                              <View style={{ flex: 1 }}>
                                                <Text style={styles.medPriceLabel}>Precio Fonasa</Text>
                                                <Text
                                                  style={[
                                                    styles.medPriceValue,
                                                    lookedUp && !hasPrice ? styles.medPriceValueMissing : null,
                                                  ]}
                                                >
                                                  {hasPrice ? `$${Math.round(resolved.price as number)}` : 'S/P'}
                                                </Text>
                                                {lookedUp && !hasPrice ? (
                                                  <View style={styles.medMissingRow}>
                                                    <Ionicons name="alert-circle-outline" size={12} color="#B91C1C" />
                                                    <Text style={styles.medMissingText}>
                                                      {resolved.status === 'mismatch'
                                                        ? 'No coincide presentación'
                                                        : resolved.status === 'no_presentation'
                                                          ? 'Sin dosis/presentación legible'
                                                          : 'No encontrado'}
                                                    </Text>
                                                  </View>
                                                ) : null}
                                                {lookedUp && resolved.status === 'matched_name_only' ? (
                                                  <View style={styles.medWarningRow}>
                                                    <Ionicons name="alert-circle-outline" size={12} color="#B45309" />
                                                    <Text style={styles.medWarningText}>
                                                      Coincidencia por nombre (precio referencial)
                                                    </Text>
                                                  </View>
                                                ) : null}
                                              </View>

                                              {hasPrice && sourceResult ? (
                                                <Pressable
                                                  style={styles.medActionButton}
                                                  onPress={() =>
                                                    openPriceDetail(previewGroup, sourceResult, resolved.sourceItem)
                                                  }
                                                >
                                                  <Text style={styles.medActionButtonText}>Ver detalle</Text>
                                                  <Ionicons
                                                    name="chevron-forward"
                                                    size={14}
                                                    color="#1E3A8A"
                                                  />
                                                </Pressable>
                                              ) : (
                                                <Pressable
                                                  style={styles.medActionButton}
                                                  onPress={() => lookupGroupPrices(previewGroup)}
                                                >
                                                  <Text style={styles.medActionButtonText}>Buscar info</Text>
                                                  <Ionicons name="search-outline" size={14} color="#1E3A8A" />
                                                </Pressable>
                                              )}
                                            </View>
                                          );
                                        })()}
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={styles.sectionText}>No se detectaron medicamentos estructurados.</Text>
                                  )}

                                  {priceLookup?.loading ? (
                                    <View style={styles.processingRow}>
                                      <ActivityIndicator size="small" color="#1E3A8A" />
                                      <Text style={styles.processingText}>Buscando precios...</Text>
                                    </View>
                                  ) : null}

                                  {priceLookup?.error ? (
                                    <Text style={styles.errorText}>{priceLookup.error}</Text>
                                  ) : null}

                                  {priceLookup?.results && priceLookup.results.length > 0 ? (
                                    <Text style={styles.priceHintText}>
                                      Puedes tocar “Ver detalle” en cada medicamento para ver farmacias cercanas.
                                    </Text>
                                  ) : null}
                                </View>
                              ) : null}

                              {data.indications ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Indicaciones</Text>
                                  <Text style={styles.sectionText}>{data.indications}</Text>
                                </View>
                              ) : null}

                              {data.doctor ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Profesional</Text>
                                  <Text style={styles.sectionText}>{data.doctor}</Text>
                                </View>
                              ) : null}

                              {data.patient ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Paciente</Text>
                                  <Text style={styles.sectionText}>{data.patient}</Text>
                                </View>
                              ) : null}

                              {data.institution ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Centro</Text>
                                  <Text style={styles.sectionText}>{data.institution}</Text>
                                </View>
                              ) : null}

                              {data.date ? (
                                <View style={styles.sectionBlock}>
                                  <Text style={styles.sectionTitle}>Fecha</Text>
                                  <Text style={styles.sectionText}>{data.date}</Text>
                                </View>
                              ) : null}
                            </>
                          ) : null}

                          <View style={styles.sectionBlock}>
                            <Pressable
                              style={styles.accordionHeader}
                              onPress={() => toggleRawOcrAccordion(previewGroup.groupId)}
                            >
                              <Text style={styles.sectionTitleNoMargin}>Texto original OCR</Text>
                              <Ionicons
                                name={
                                  rawOcrExpandedByGroup[previewGroup.groupId]
                                    ? 'chevron-up-outline'
                                    : 'chevron-down-outline'
                                }
                                size={18}
                                color="#1E3A8A"
                              />
                            </Pressable>
                            {rawOcrExpandedByGroup[previewGroup.groupId] ? (
                              <Text style={styles.groupModalText}>{data.rawText}</Text>
                            ) : (
                              <Text style={styles.accordionHint}>Toca para expandir</Text>
                            )}
                          </View>
                        </>
                      );
                    })()
                  ) : null}
                  {!previewGroup ? (
                    <Text style={styles.groupModalText}>[SIN_TEXTO]</Text>
                  ) : null}
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={galleryGroup !== null} animationType="slide" transparent>
        <View style={styles.previewBackdrop}>
          <SafeAreaView style={styles.previewSafe}>
            <View style={styles.previewTopRow}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                {galleryGroup ? `Fotos (${galleryGroup.items.length})` : ''}
              </Text>
              <Pressable style={styles.previewCloseBtn} onPress={() => setGalleryGroup(null)}>
                <Ionicons name="close" size={26} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.groupModalCard}>
              <ScrollView
                horizontal
                style={styles.groupModalPhotosScroll}
                contentContainerStyle={styles.groupModalPhotos}
              >
                {galleryGroup?.items.map((photo) => (
                  <View key={photo.id} style={styles.groupModalPhotoItem}>
                    <Pressable onPress={() => setPreviewPhoto(photo)}>
                      <Image source={{ uri: photo.uri }} style={styles.groupModalPhoto} />
                    </Pressable>
                    <Pressable style={styles.groupModalDeleteBtn} onPress={() => confirmDeletePhoto(photo)}>
                      <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={previewPhoto !== null} animationType="fade" transparent>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.previewBackdrop}>
            <SafeAreaView style={styles.previewSafe}>
              <View style={styles.previewTopRow}>
                <Text style={styles.previewTitle} numberOfLines={1}>{previewPhoto?.title}</Text>
                <Pressable style={styles.previewCloseBtn} onPress={() => setPreviewPhoto(null)}>
                  <Ionicons name="close" size={26} color="#FFFFFF" />
                </Pressable>
              </View>

              <View style={styles.previewImageWrap}>
                {previewPhoto ? (
                  <ZoomableImage key={previewPhoto.id} uri={previewPhoto.uri} />
                ) : null}
              </View>
            </SafeAreaView>
          </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal visible={priceDetailModal.open} animationType="slide" transparent>
        <View style={styles.editBackdrop}>
          <View style={styles.priceDetailCard}>
            <View style={styles.priceDetailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceDetailTitle}>Farmacias cercanas</Text>
                <Text style={styles.priceDetailSub}>{priceDetailModal.query || ''}</Text>
              </View>
              <Pressable
                style={styles.selectorClose}
                onPress={() => setPriceDetailModal({ open: false, loading: false, pharmacies: [] })}
              >
                <Ionicons name="close" size={22} color="#0F172A" />
              </Pressable>
            </View>

            {priceDetailModal.loading ? (
              <View style={styles.priceDetailLoading}>
                <ActivityIndicator size="large" color="#1E3A8A" />
                <Text style={styles.centerText}>Consultando farmacias...</Text>
              </View>
            ) : priceDetailModal.error ? (
              <Text style={styles.errorText}>{priceDetailModal.error}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {priceDetailModal.pharmacies.length === 0 ? (
                  <Text style={styles.sectionText}>Sin resultados de farmacias para este medicamento.</Text>
                ) : (
                  priceDetailModal.pharmacies.map((item, index) => (
                    <View key={`${item.farmacia}-${item.nombreSucursal}-${index}`} style={styles.pharmacyRow}>
                      <Text style={styles.pharmacyName}>
                        {item.farmacia} · {item.nombreSucursal}
                      </Text>
                      <Text style={styles.pharmacyMeta}>
                        {item.direccion} - {item.comuna}
                      </Text>
                      <Text style={styles.pharmacyMeta}>
                        {item.ciudad} {item.region ? `(${item.region})` : ''}
                      </Text>
                      <Text style={styles.pharmacyMeta}>
                        Distancia: {item.distancia != null ? `${Math.round(item.distancia)} m` : 'N/D'}
                      </Text>
                      <Text style={styles.pharmacyMeta}>
                        Coordenadas: {item.latitud ?? 'N/D'}, {item.longitud ?? 'N/D'}
                      </Text>
                      <Text style={styles.pharmacyPrice}>
                        Fonasa: {item.ofertaFonasa != null ? `$${Math.round(item.ofertaFonasa)}` : 'N/D'} ·
                        Normal: {item.precioNormal != null ? ` $${Math.round(item.precioNormal)}` : ' N/D'}
                      </Text>
                      <Pressable
                        style={[
                          styles.routeButton,
                          (item.latitud == null || item.longitud == null) && { opacity: 0.5 },
                        ]}
                        onPress={() => openPharmacyRoute(item)}
                        disabled={item.latitud == null || item.longitud == null}
                      >
                        <Ionicons name="navigate-outline" size={14} color="#1E3A8A" />
                        <Text style={styles.routeButtonText}>Cómo llegar</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={editingGroupId !== null} animationType="fade" transparent>
        <View style={styles.editBackdrop}>
          <View style={styles.editCard}>
            <Text style={styles.editTitle}>Editar título del evento</Text>
            <TextInput
              style={styles.editInput}
              value={editingTitle}
              onChangeText={setEditingTitle}
              placeholder="Ej: Receta antibiótico"
              maxLength={60}
            />
            <View style={styles.editActions}>
              <Pressable style={styles.editCancel} onPress={() => setEditingGroupId(null)}>
                <Text style={styles.editCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.editSave} onPress={saveEditedTitle}>
                <Text style={styles.editSaveText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {shareCaptureGroup ? (
        <View pointerEvents="none" style={styles.captureStage}>
          <ViewShot
            ref={shareCaptureViewRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile', fileName: `receta-${shareCaptureGroup.groupId}` }}
          >
            <RecipeShareCaptureCard
              title={getGroupTitle(shareCaptureGroup)}
              createdAt={shareCaptureGroup.createdAt}
              data={getGroupStructuredData(shareCaptureGroup)}
              priceLookup={getEffectivePriceLookup(shareCaptureGroup)}
            />
          </ViewShot>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function RecipeShareCaptureCard({
  title,
  createdAt,
  data,
  priceLookup,
}: {
  title: string;
  createdAt: string;
  data: GroupStructuredData;
  priceLookup?: GroupPriceLookupState;
}) {
  const totalApprox = computeMedicationTotalApprox(data.medications, priceLookup);

  return (
    <View style={styles.captureCard}>
      <Text style={styles.captureTitle}>{title}</Text>
      <Text style={styles.captureMeta}>Fecha: {formatDate(createdAt)}</Text>
      <Text style={styles.captureMeta}>Paciente: {data.patient || 'No identificado'}</Text>
      <Text style={styles.captureMeta}>Profesional: {data.doctor || 'No detectado'}</Text>
      <Text style={styles.captureMeta}>Centro: {data.institution || 'No detectado'}</Text>

      <View style={styles.captureTotalCardFloating}>
        <Text style={styles.captureTotalLabel}>TOTAL APROX</Text>
        <Text style={styles.captureTotalValue}>{totalApprox > 0 ? `$${Math.round(totalApprox)}` : 'S/P'}</Text>
      </View>

      <View style={styles.captureSection}>
        <Text style={styles.captureSectionTitle}>Medicamentos y precios</Text>
        {data.medications.length > 0 ? (
          data.medications.slice(0, 12).map((med, index) => {
            const resolved = resolveMedicationPrice(med, priceLookup);
            const hasPrice =
              (resolved.status === 'matched_exact' || resolved.status === 'matched_name_only') &&
              resolved.price != null;
            const detail = [med.dose, med.frequency, med.duration].filter(Boolean).join(' · ');
            return (
              <View key={`${med.name}-${index}`} style={styles.captureMedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.captureMedName}>{med.name}</Text>
                  {detail ? <Text style={styles.captureMedDetail}>{detail}</Text> : null}
                  {resolved.status === 'matched_name_only' ? (
                    <Text style={styles.captureMedWarn}>Precio referencial por nombre</Text>
                  ) : null}
                </View>
                <Text style={[styles.captureMedPrice, !hasPrice ? styles.captureMedPriceMissing : null]}>
                  {hasPrice ? `$${Math.round(resolved.price as number)}` : 'S/P'}
                </Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.captureMedDetail}>Sin medicamentos detectados</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: PADDING, paddingTop: 0, paddingBottom: 130 },
  headerWrap: {
    paddingTop: 10,
    marginBottom: 20,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
    gap: 10,
  },
  centerText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 10,
  },
  emptyText: {
    color: '#334155',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 8,
  },
  groupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  groupRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  groupThumb: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
  },
  groupThumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupBody: {
    flex: 1,
    gap: 3,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  groupActions: {
    flexDirection: 'row',
    gap: 4,
  },
  groupTitle: {
    flex: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    marginRight: 6,
  },
  groupDoctor: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  groupMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  groupMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  groupMetaText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  groupPills: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillReceta: { backgroundColor: '#D1FAE518', borderColor: '#10B98140' },
  pillBono: { backgroundColor: '#6366F118', borderColor: '#6366F140' },
  pillPending: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  pillLocked: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  pillText: { fontSize: 11, fontWeight: '700' },
  pillTextReceta: { color: '#10B981' },
  pillTextBono: { color: '#6366F1' },
  pillTextPending: { color: '#94A3B8' },
  pillTextLocked: { color: '#CBD5E1' },
  groupErrorText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonDanger: {
    width: 34,
    height: 34,
    borderRadius: 999,
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCountCard: {
    width: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 2,
  },
  photoStackWrap: {
    width: 92,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  photoStackImage: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#93C5FD',
    left: 18,
    top: 2,
    backgroundColor: '#DBEAFE',
  },
  photoStackImageMiddle: {
    left: 26,
    top: 0,
    zIndex: 2,
  },
  photoStackImageTop: {
    left: 34,
    top: 4,
    zIndex: 3,
  },
  photoCountNumber: {
    color: '#1E3A8A',
    fontSize: 18,
    fontWeight: '900',
  },
  photoCountLabel: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
  },
  totalApproxCard: {
    flex: 1,
    height: 92,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F97316',
    borderWidth: 1,
    borderColor: '#EA580C',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  totalApproxLabel: {
    color: '#FFEDD5',
    fontSize: 11,
    fontWeight: '800',
  },
  totalApproxValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 1,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  summaryLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  retryButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  processingText: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryText: {
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  cameraScreen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  cameraTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraGhostBtn: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraCountBadge: {
    backgroundColor: 'rgba(5,150,105,0.9)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  cameraCountText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  previewStrip: {
    gap: 10,
    paddingBottom: 12,
  },
  previewThumbWrap: {
    width: 68,
    height: 68,
  },
  previewThumb: {
    width: 68,
    height: 68,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  previewDeleteBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  captureCircle: {
    width: 84,
    height: 84,
    borderRadius: 999,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCircleInner: {
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
  },
  galleryCircle: {
    width: 62,
    height: 62,
    borderRadius: 999,
    backgroundColor: 'rgba(30,58,138,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveGroupButton: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  saveGroupText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  previewSafe: {
    flex: 1,
    justifyContent: 'space-between',
  },
  previewTopRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  previewTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    flex: 1,
  },
  previewCloseBtn: {
    width: 46,
    height: 46,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImageWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  groupModalCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  groupModalPhotosScroll: {
    maxHeight: 148,
    flexGrow: 0,
  },
  groupModalPhotosHeader: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailPhotoStackButton: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  groupModalPhotos: {
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'flex-start',
  },
  groupModalPhotoItem: {
    width: 96,
    alignItems: 'center',
    gap: 6,
  },
  groupModalPhoto: {
    width: 96,
    height: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  groupModalDeleteBtn: {
    width: 84,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  groupModalTextWrap: {
    flex: 1,
    margin: 12,
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    padding: 10,
  },
  richContent: {
    paddingBottom: 10,
    gap: 10,
  },
  modalTextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareRecipeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  shareRecipeText: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '700',
  },
  sectionBlock: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 10,
  },
  sectionTitle: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  sectionTotalText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  sectionTotalPill: {
    borderRadius: 999,
    backgroundColor: '#F97316',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#EA580C',
  },
  sectionTitleNoMargin: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  accordionHint: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionText: {
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#F8FAFC',
  },
  priceName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  priceMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  priceValue: {
    color: '#047857',
    fontSize: 16,
    fontWeight: '900',
  },
  priceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceDetailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    maxHeight: '80%',
  },
  priceDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  priceDetailTitle: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '900',
  },
  priceDetailSub: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 2,
  },
  priceDetailLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  pharmacyRow: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    padding: 10,
    marginBottom: 8,
  },
  pharmacyName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  pharmacyMeta: {
    color: '#475569',
    fontSize: 12,
    marginTop: 3,
  },
  pharmacyPrice: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  routeButton: {
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  routeButtonText: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
  },
  selectorClose: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  medBullet: {
    color: '#0F172A',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 1,
  },
  medName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  medDetail: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 2,
  },
  medCard: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 12,
    backgroundColor: '#F8FAFF',
    padding: 10,
    marginBottom: 8,
  },
  medCardMissing: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  medPriceRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  medPriceLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  medPriceValue: {
    color: '#047857',
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  medPriceValueMissing: {
    color: '#B91C1C',
  },
  medMissingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  medWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  medMissingText: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  medWarningText: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  medActionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  medActionButtonText: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
  },
  priceHintText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  captureStage: {
    position: 'absolute',
    left: -5000,
    top: -5000,
    width: 390,
    backgroundColor: '#FFFFFF',
  },
  captureCard: {
    width: 390,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  captureTitle: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 8,
  },
  captureMeta: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  captureTotalCardFloating: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 132,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EA580C',
    backgroundColor: '#F97316',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'flex-end',
  },
  captureTotalLabel: {
    color: '#FFEDD5',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  captureTotalValue: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    marginTop: 1,
    textAlign: 'right',
  },
  captureSection: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 10,
  },
  captureSectionTitle: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  captureMedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  captureMedName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  captureMedDetail: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
  },
  captureMedPrice: {
    color: '#047857',
    fontSize: 14,
    fontWeight: '900',
  },
  captureMedPriceMissing: {
    color: '#B91C1C',
  },
  captureMedWarn: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  groupModalText: {
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '500',
  },
  editBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  editCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
  },
  editTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 10,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0F172A',
  },
  editActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  editCancel: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  editCancelText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  editSave: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  editSaveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  groupCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  docTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  docTypeBadgeText: {
    fontSize: 13,
    fontWeight: '800',
  },
  groupCardProcessing: {
    borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF',
  },
  groupProcessingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDE9FE',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 10,
  },
  groupProcessingText: {
    color: '#5B21B6',
    fontSize: 12,
    fontWeight: '700',
  },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 12,
  },
  addPhotoBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pillScan: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  pillTextScan: { color: '#1E3A8A' },
  detailTabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    padding: 3,
    gap: 3,
  },
  detailTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 11,
  },
  detailTabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  detailTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
  },
  detailTabTextActive: {
    color: '#10B981',
  },
  detailTabTextActiveBono: {
    color: '#6366F1',
  },
  bonoEmptyWrap: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  bonoEmptyTitle: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '800',
  },
  bonoEmptyText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  bonoItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bonoItemDesc: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  bonoItemRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bonoItemDetail: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  bonoTotalsBlock: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
  },
  bonoMontoPagar: {
    color: '#059669',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 4,
  },
  sectionSubText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
});
