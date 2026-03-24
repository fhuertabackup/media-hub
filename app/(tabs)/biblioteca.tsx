import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';

import {
  addMediaItem,
  copyPhotoToAppStorage,
  deleteMediaItem,
  getAllMedia,
  updateMediaItem,
} from '../../src/lib/media-store';
import { generatePhotoGroupTitle, ocrPhoto } from '../../src/lib/photo-ocr-api';
import {
  lookupFonasaPrices,
  lookupFonasaDetail,
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
  const [previewPhoto, setPreviewPhoto] = useState<PhotoItem | null>(null);

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [retryingGroupIds, setRetryingGroupIds] = useState<Record<string, boolean>>({});
  const [rawOcrExpandedByGroup, setRawOcrExpandedByGroup] = useState<Record<string, boolean>>({});
  const [priceLookupByGroup, setPriceLookupByGroup] = useState<
    Record<
      string,
      {
        loading: boolean;
        error?: string;
        results?: FonasaLookupResult[];
        latitud?: number;
        longitud?: number;
      }
    >
  >({});
  const [priceDetailModal, setPriceDetailModal] = useState<{
    open: boolean;
    loading: boolean;
    error?: string;
    query?: string;
    pharmacies: FonasaPharmacyDetail[];
  }>({ open: false, loading: false, pharmacies: [] });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

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

  const getGroupTitle = (group: PhotoGroup) => {
    const persisted = group.items.find((item) => item.photoGroupTitle?.trim())?.photoGroupTitle?.trim();
    if (persisted) return persisted;
    return 'Receta sin título';
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
      if (hasPending) return 'Extrayendo texto de receta...';
      return '[SIN_TEXTO]';
    }
    return lines.slice(0, 3).join('\n');
  };

  const getGroupStructuredData = (group: PhotoGroup) => {
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
    group.items.some((item) => item.ocrStatus === 'pending');

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
      await updateMediaItem(photo.id, { ocrStatus: 'error', ocrError: message });
    }
  }, []);

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
        const patientTitle = `Receta ${patientName}`.slice(0, 60).trim();
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
      }

      await loadPhotos();
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
    [autoGenerateGroupTitle, loadPhotos, retryingGroupIds, runPhotoOcr]
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
      Alert.alert('Título requerido', 'Escribe un título corto para la receta.');
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
    return `Receta ${day}/${month} ${hours}:${minutes}`;
  };

  const shareGroupRecipe = async (group: PhotoGroup) => {
    try {
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
      Alert.alert('Error', 'No se pudo compartir la receta.');
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

  const lookupGroupPrices = async (group: PhotoGroup) => {
    const queries = await getPriceQueriesForGroup(group);
    if (queries.length === 0) {
      Alert.alert('Sin medicamentos', 'No se detectaron medicamentos para consultar precios.');
      return;
    }

    try {
      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: { loading: true, error: '', results: prev[group.groupId]?.results },
      }));

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
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

      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: {
          loading: false,
          error: '',
          results: result.results,
          latitud: position.coords.latitude,
          longitud: position.coords.longitude,
        },
      }));
    } catch (error) {
      console.error(error);
      setPriceLookupByGroup((prev) => ({
        ...prev,
        [group.groupId]: {
          loading: false,
          error: error instanceof Error ? error.message : 'No se pudieron consultar precios.',
          results: [],
        },
      }));
    }
  };

  const openPriceDetail = async (group: PhotoGroup, result: FonasaLookupResult) => {
    const context = priceLookupByGroup[group.groupId];
    const latitud = context?.latitud;
    const longitud = context?.longitud;
    const firstItem = result.items?.[0];

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
            title="Foto receta"
            subtitle={`${photos.length} foto${photos.length !== 1 ? 's' : ''} guardada${photos.length !== 1 ? 's' : ''}`}
            icon="images"
            color="#312E81"
            actionLabel="Foto receta"
            actionIconOnly
            onPressAction={openCameraSession}
          />
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#6D28D9" />
            <Text style={styles.centerText}>Cargando recetas...</Text>
          </View>
        ) : groupedPhotos.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-text-outline" size={42} color="#059669" />
            <Text style={styles.emptyTitle}>Sin eventos de receta</Text>
            <Text style={styles.emptyText}>
              Toca “Foto receta” para capturar una o varias fotos del mismo flujo.
            </Text>
          </View>
        ) : (
          groupedPhotos.map((group) => (
            <View key={group.groupId} style={styles.groupCard}>
              <View style={styles.groupHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupTitle} numberOfLines={1}>
                    {getGroupTitle(group)}
                  </Text>
                  <Text style={styles.groupMeta}>{formatDate(group.createdAt)}</Text>
                </View>

                <Pressable style={styles.iconButton} onPress={() => openEditTitle(group)}>
                  <Ionicons name="create-outline" size={18} color="#0F172A" />
                </Pressable>
                <Pressable style={styles.iconButtonDanger} onPress={() => confirmDeleteGroup(group)}>
                  <Ionicons name="trash-outline" size={18} color="#DC2626" />
                </Pressable>
              </View>

              <View style={styles.groupBody}>
                <Pressable style={styles.photoCountCard} onPress={() => setPreviewGroup(group)}>
                  <Ionicons name="images-outline" size={28} color="#1E3A8A" />
                  <Text style={styles.photoCountNumber}>{group.items.length}</Text>
                  <Text style={styles.photoCountLabel}>fotos</Text>
                </Pressable>

                <Pressable style={styles.summaryCard} onPress={() => setPreviewGroup(group)}>
                  <View style={styles.summaryTopRow}>
                    <Text style={styles.summaryLabel}>Texto extraído</Text>
                    {canRetryGroupOcr(group) ? (
                      <Pressable
                        style={[styles.retryButton, retryingGroupIds[group.groupId] && { opacity: 0.6 }]}
                        onPress={() => retryGroupOcr(group)}
                        disabled={Boolean(retryingGroupIds[group.groupId])}
                      >
                        {retryingGroupIds[group.groupId] ? (
                          <ActivityIndicator size="small" color="#1E3A8A" />
                        ) : (
                          <Ionicons name="refresh" size={14} color="#1E3A8A" />
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                  {isGroupProcessing(group) ? (
                    <View style={styles.processingRow}>
                      <ActivityIndicator size="small" color="#1E3A8A" />
                      <Text style={styles.processingText}>Procesando receta...</Text>
                    </View>
                  ) : null}
                  <Text style={styles.summaryText} numberOfLines={4}>
                    {getGroupSummary(group)}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
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
              <Pressable style={styles.previewCloseBtn} onPress={() => setPreviewGroup(null)}>
                <Ionicons name="close" size={26} color="#FFFFFF" />
              </Pressable>
            </View>

            <View style={styles.groupModalCard}>
              <ScrollView
                horizontal
                style={styles.groupModalPhotosScroll}
                contentContainerStyle={styles.groupModalPhotos}
              >
                {previewGroup?.items.map((photo) => (
                  <View key={photo.id} style={styles.groupModalPhotoItem}>
                    <Pressable onPress={() => setPreviewPhoto(photo)}>
                      <Image source={{ uri: photo.uri }} style={styles.groupModalPhoto} />
                    </Pressable>
                    <Pressable
                      style={styles.groupModalDeleteBtn}
                      onPress={() => confirmDeletePhoto(photo)}
                    >
                      <Ionicons name="trash-outline" size={15} color="#DC2626" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.groupModalTextWrap}>
                <View style={styles.modalTextHeader}>
                  <Text style={styles.summaryLabel}>Texto completo de receta</Text>
                  <View style={styles.modalActions}>
                    {previewGroup ? (
                      <Pressable
                        style={styles.shareRecipeButton}
                        onPress={() => lookupGroupPrices(previewGroup)}
                      >
                        {priceLookupByGroup[previewGroup.groupId]?.loading ? (
                          <ActivityIndicator size="small" color="#1E3A8A" />
                        ) : (
                          <Ionicons name="cash-outline" size={14} color="#1E3A8A" />
                        )}
                        <Text style={styles.shareRecipeText}>Precios</Text>
                      </Pressable>
                    ) : null}
                    {previewGroup ? (
                      <Pressable style={styles.shareRecipeButton} onPress={() => shareGroupRecipe(previewGroup)}>
                        <Ionicons name="share-outline" size={14} color="#1E3A8A" />
                        <Text style={styles.shareRecipeText}>Compartir</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                <ScrollView contentContainerStyle={styles.richContent}>
                  {previewGroup ? (
                    (() => {
                      const data = getGroupStructuredData(previewGroup);
                      const priceLookup = priceLookupByGroup[previewGroup.groupId];
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
                                      <View key={`${med.name}-${index}`} style={styles.medCard}>
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
                                          const medName = med.name.trim().toLowerCase();
                                          const matched = priceLookup?.results?.find((result) => {
                                            const query = result.query.trim().toLowerCase();
                                            return query.includes(medName) || medName.includes(query);
                                          });
                                          const hasPrice = Boolean(
                                            matched && matched.bestPrice != null && matched.itemCount > 0
                                          );
                                          return (
                                            <View style={styles.medPriceRow}>
                                              <View style={{ flex: 1 }}>
                                                <Text style={styles.medPriceLabel}>Precio Fonasa</Text>
                                                <Text style={styles.medPriceValue}>
                                                  {hasPrice && matched
                                                    ? `$${Math.round(matched.bestPrice as number)}`
                                                    : 'S/P'}
                                                </Text>
                                              </View>

                                              {hasPrice && matched ? (
                                                <Pressable
                                                  style={styles.medActionButton}
                                                  onPress={() => openPriceDetail(previewGroup, matched)}
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
                  ) : (
                    <Text style={styles.groupModalText}>[SIN_TEXTO]</Text>
                  )}
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal visible={previewPhoto !== null} animationType="fade" transparent>
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
                <Image source={{ uri: previewPhoto.uri }} style={styles.previewImage} resizeMode="contain" />
              ) : null}
            </View>
          </SafeAreaView>
        </View>
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
    </SafeAreaView>
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D1FAE5',
    padding: 12,
    marginBottom: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  groupTitle: {
    color: '#064E3B',
    fontSize: 20,
    fontWeight: '900',
  },
  groupMeta: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
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
  groupBody: {
    flexDirection: 'row',
    gap: 10,
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
  photoCountNumber: {
    color: '#1E3A8A',
    fontSize: 20,
    fontWeight: '900',
  },
  photoCountLabel: {
    color: '#1E3A8A',
    fontSize: 12,
    fontWeight: '800',
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
});
