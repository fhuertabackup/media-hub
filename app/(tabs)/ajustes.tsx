import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as MailComposer from 'expo-mail-composer';
import * as Print from 'expo-print';
import ViewShot from 'react-native-view-shot';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { SectionHeaderBanner } from '../../src/components/SectionHeaderBanner';
import { SoftScreenGradient } from '../../src/components/SoftScreenGradient';
import { getAllMedia } from '../../src/lib/media-store';
import { getAppSettings, saveAppSettings } from '../../src/lib/settings-store';
import { AppSettings } from '../../src/types/app-settings';
import { MediaItem } from '../../src/types/media';
import { formatDate, formatDuration } from '../../src/utils/format';

const EMPTY_SETTINGS: AppSettings = {
  personName: '',
  personInfo: '',
  emergencyContactName: '',
  emergencyEmail: '',
};

export default function AjustesScreen() {
  const [photoCount, setPhotoCount] = useState(0);
  const [audioCount, setAudioCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingMail, setSendingMail] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [records, setRecords] = useState<MediaItem[]>([]);
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [capturePhoto, setCapturePhoto] = useState<Extract<MediaItem, { type: 'photo' }> | null>(null);
  const captureViewRef = useRef<ViewShot | null>(null);
  const captureResolverRef = useRef<((uri: string | null) => void) | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [allMedia, storedSettings] = await Promise.all([getAllMedia(), getAppSettings()]);
      setPhotoCount(allMedia.filter((item) => item.type === 'photo').length);
      setAudioCount(allMedia.filter((item) => item.type === 'audio').length);
      setSettings(storedSettings);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const updateField = (key: keyof AppSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    try {
      setSaving(true);
      await saveAppSettings({
        personName: settings.personName.trim(),
        personInfo: settings.personInfo.trim(),
        emergencyContactName: settings.emergencyContactName.trim(),
        emergencyEmail: settings.emergencyEmail.trim(),
      });
      Alert.alert('Guardado', 'La información se guardó correctamente.');
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo guardar la información.');
    } finally {
      setSaving(false);
    }
  };

  const onPressEmail = async () => {
    const to = settings.emergencyEmail.trim();
    if (!to) {
      Alert.alert('Correo requerido', 'Ingresa un correo en contacto de emergencia.');
      return;
    }

    try {
      const media = await getAllMedia();
      setRecords(media);
      const map: Record<string, boolean> = {};
      media.forEach((item) => {
        map[item.id] = false;
      });
      setSelectedMap(map);
      setSelectorVisible(true);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo preparar el correo.');
    }
  };

  const toggleRecord = (id: string) => {
    setSelectedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedRecords = records.filter((item) => selectedMap[item.id]);

  useEffect(() => {
    if (!capturePhoto) return;
    let active = true;

    const runCapture = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      let uri: string | null = null;
      try {
        uri = (await captureViewRef.current?.capture?.()) ?? null;
      } catch (error) {
        console.error(error);
      } finally {
        if (!active) return;
        captureResolverRef.current?.(uri);
        captureResolverRef.current = null;
        setCapturePhoto(null);
      }
    };

    runCapture();
    return () => {
      active = false;
    };
  }, [capturePhoto]);

  const captureRecipeScreenshot = useCallback(
    async (photo: Extract<MediaItem, { type: 'photo' }>) =>
      new Promise<string | null>((resolve) => {
        if (captureResolverRef.current) {
          captureResolverRef.current(null);
          captureResolverRef.current = null;
        }
        captureResolverRef.current = resolve;
        setCapturePhoto(photo);
      }),
    []
  );

  const sendSummaryEmail = async () => {
    const to = settings.emergencyEmail.trim();
    if (!to) return;
    if (selectedRecords.length === 0) {
      Alert.alert('Sin selección', 'Selecciona al menos un registro.');
      return;
    }

    try {
      setSendingMail(true);
      const body = buildEmailSummary(settings, selectedRecords);
      const subject = encodeURIComponent('Resumen de registros seleccionados - Media Hub');
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${encodeURIComponent(body)}`;
      const canOpen = await Linking.canOpenURL(mailto);
      if (!canOpen) {
        Alert.alert('No disponible', 'No se pudo abrir la app de correo en este dispositivo.');
        return;
      }
      await Linking.openURL(mailto);
      setSelectorVisible(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo abrir el correo.');
    } finally {
      setSendingMail(false);
    }
  };

  const sendAttachmentEmail = async () => {
    const to = settings.emergencyEmail.trim();
    if (!to) return;
    if (selectedRecords.length === 0) {
      Alert.alert('Sin selección', 'Selecciona al menos un registro.');
      return;
    }

    try {
      setSendingMail(true);
      const available = await MailComposer.isAvailableAsync();
      if (!available) {
        Alert.alert('No disponible', 'El dispositivo no soporta adjuntos por este medio.');
        return;
      }
      const body = buildEmailSummary(settings, selectedRecords);
      const attachments = await buildEmailAttachments(selectedRecords, captureRecipeScreenshot);
      await MailComposer.composeAsync({
        recipients: [to],
        subject: 'Registros seleccionados con adjuntos - Media Hub',
        body,
        attachments,
      });
      setSelectorVisible(false);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo preparar correo con adjuntos.');
    } finally {
      setSendingMail(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <SoftScreenGradient color="#38BDF8" />
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      >
        <View style={styles.headerWrap}>
          <SectionHeaderBanner
            title="Ajustes"
            subtitle="Datos personales y contacto"
            icon="settings"
            color="#312E81"
          />
        </View>

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator size="large" color="#0EA5E9" />
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Información de la persona</Text>
            <View style={styles.card}>
              <Field
                label="Nombre"
                value={settings.personName}
                onChangeText={(value) => updateField('personName', value)}
                placeholder="Ej: María Pérez"
              />
              <Field
                label="Información relevante"
                value={settings.personInfo}
                onChangeText={(value) => updateField('personInfo', value)}
                placeholder="Ej: Edad, alergias, condiciones"
                multiline
              />
            </View>

            <Text style={styles.sectionTitle}>Contacto de emergencia (opcional)</Text>
            <View style={styles.card}>
              <Field
                label="Nombre del contacto"
                value={settings.emergencyContactName}
                onChangeText={(value) => updateField('emergencyContactName', value)}
                placeholder="Ej: Hijo/a o cuidador"
              />
              <Field
                label="Correo de contacto"
                value={settings.emergencyEmail}
                onChangeText={(value) => updateField('emergencyEmail', value)}
                placeholder="contacto@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Pressable style={styles.mailButton} onPress={onPressEmail}>
                <Ionicons name="mail-outline" size={20} color="#FFFFFF" />
                <Text style={styles.mailButtonText}>Seleccionar y enviar por correo</Text>
              </Pressable>
              <Text style={styles.mailHint}>
                Puedes elegir qué registros incluir y si enviar resumen o adjuntos.
              </Text>
            </View>

            <Text style={styles.sectionTitle}>Resumen rápido</Text>
            <View style={styles.card}>
              <InfoRow
                icon="images"
                iconColor="#10B981"
                iconBg="#D1FAE5"
                label="Fotos guardadas"
                value={`${photoCount}`}
              />
              <View style={styles.divider} />
              <InfoRow
                icon="mic"
                iconColor="#6D28D9"
                iconBg="#EDE9FE"
                label="Audios guardados"
                value={`${audioCount}`}
              />
            </View>

            <Pressable style={[styles.saveButton, saving && { opacity: 0.7 }]} onPress={onSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="save-outline" size={20} color="#FFFFFF" />
              )}
              <Text style={styles.saveButtonText}>Guardar ajustes</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <Modal visible={selectorVisible} animationType="slide" transparent>
        <View style={styles.selectorBackdrop}>
          <SafeAreaView style={styles.selectorSafe}>
            <View style={styles.selectorCard}>
              <View style={styles.selectorHeader}>
                <Text style={styles.selectorTitle}>Seleccionar registros</Text>
                <Pressable style={styles.selectorClose} onPress={() => setSelectorVisible(false)}>
                  <Ionicons name="close" size={22} color="#0F172A" />
                </Pressable>
              </View>

              <Text style={styles.selectorSub}>
                Marca fotos/audios que quieras incluir en el correo.
              </Text>

              <ScrollView style={styles.selectorList}>
                {records.map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.selectorRow}
                    onPress={() => toggleRecord(item.id)}
                  >
                    <View style={styles.selectorLeft}>
                      <View
                        style={[
                          styles.selectorType,
                          item.type === 'photo' ? styles.selectorTypePhoto : styles.selectorTypeAudio,
                        ]}
                      >
                        <Ionicons
                          name={item.type === 'photo' ? 'image' : 'mic'}
                          size={14}
                          color="#FFFFFF"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectorRowTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.selectorRowMeta}>
                          {formatDate(item.createdAt)}
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name={selectedMap[item.id] ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={selectedMap[item.id] ? '#2563EB' : '#94A3B8'}
                    />
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.selectorActions}>
                <Pressable
                  style={[styles.selectorAction, styles.selectorSummary]}
                  onPress={sendSummaryEmail}
                  disabled={sendingMail}
                >
                  <Text style={styles.selectorSummaryText}>
                    {sendingMail ? 'Enviando...' : 'Enviar resumen'}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.selectorAction, styles.selectorAttach]}
                  onPress={sendAttachmentEmail}
                  disabled={sendingMail}
                >
                  <Text style={styles.selectorAttachText}>Enviar adjuntos</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {capturePhoto ? (
        <View pointerEvents="none" style={styles.captureStage}>
          <ViewShot
            ref={captureViewRef}
            options={{ format: 'png', quality: 1, result: 'tmpfile', fileName: `receta-${capturePhoto.id}` }}
          >
            <RecipeScreenshotCard photo={capturePhoto} />
          </ViewShot>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

async function buildEmailAttachments(
  media: MediaItem[],
  captureRecipeScreenshot: (photo: Extract<MediaItem, { type: 'photo' }>) => Promise<string | null>
) {
  const selected = media.slice(0, 10);
  const out: string[] = [];

  for (const item of selected) {
    if (item.type === 'photo') {
      const screenshotUri = await captureRecipeScreenshot(item);
      if (screenshotUri) {
        out.push(screenshotUri);
        continue;
      }
      const pdfUri = await buildRecipeDetailPdfAttachment(item);
      if (pdfUri) {
        out.push(pdfUri);
        continue;
      }
    }
    out.push(item.uri);
  }

  return out;
}

async function buildRecipeDetailPdfAttachment(photo: Extract<MediaItem, { type: 'photo' }>) {
  try {
    const html = buildRecipeDetailHtml(photo);
    const file = await Print.printToFileAsync({ html });
    return file.uri;
  } catch (error) {
    console.error(error);
    return null;
  }
}

function buildRecipeDetailHtml(photo: Extract<MediaItem, { type: 'photo' }>) {
  const meds = photo.ocrParsed?.medications ?? [];
  const medsHtml =
    meds.length > 0
      ? meds
          .slice(0, 12)
          .map((med) => {
            const detail = [med.dose, med.frequency, med.duration, med.notes].filter(Boolean).join(' · ');
            return `<li><strong>${escapeHtml(med.name)}</strong>${detail ? `: ${escapeHtml(detail)}` : ''}</li>`;
          })
          .join('')
      : '<li>Sin medicamentos detectados</li>';

  const raw = photo.ocrParsed?.rawText?.trim() || photo.ocrText?.trim() || '[SIN_TEXTO]';
  const patient = photo.ocrParsed?.patientName?.trim() || 'No identificado';
  const doctor = photo.ocrParsed?.doctorName?.trim() || '';
  const center = photo.ocrParsed?.institution?.trim() || '';
  const indications = photo.ocrParsed?.indicationsGeneral?.trim() || 'No detectadas';

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; padding: 18px; }
          .card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; background: #ffffff; }
          .title { font-size: 22px; font-weight: 800; margin: 0 0 8px; color: #1e3a8a; }
          .meta { font-size: 13px; color: #475569; margin: 0 0 4px; }
          .block { margin-top: 12px; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          .label { font-size: 12px; font-weight: 700; color: #1e3a8a; text-transform: uppercase; margin: 0 0 5px; }
          ul { margin: 0; padding-left: 18px; }
          li { margin-bottom: 5px; line-height: 1.35; }
          .text { font-size: 13px; line-height: 1.4; color: #0f172a; white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1 class="title">${escapeHtml(photo.photoGroupTitle?.trim() || photo.title)}</h1>
          <p class="meta"><strong>Fecha:</strong> ${escapeHtml(formatDate(photo.createdAt))}</p>
          <p class="meta"><strong>Paciente:</strong> ${escapeHtml(patient)}</p>
          ${doctor ? `<p class="meta"><strong>Profesional:</strong> ${escapeHtml(doctor)}</p>` : ''}
          ${center ? `<p class="meta"><strong>Centro:</strong> ${escapeHtml(center)}</p>` : ''}

          <div class="block">
            <p class="label">Medicamentos</p>
            <ul>${medsHtml}</ul>
          </div>

          <div class="block">
            <p class="label">Indicaciones</p>
            <p class="text">${escapeHtml(indications)}</p>
          </div>

          <div class="block">
            <p class="label">Texto OCR</p>
            <p class="text">${escapeHtml(raw)}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function escapeHtml(input: string) {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
  autoCapitalize = 'sentences',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

function RecipeScreenshotCard({ photo }: { photo: Extract<MediaItem, { type: 'photo' }> }) {
  const meds = photo.ocrParsed?.medications ?? [];
  const priceResults = photo.priceLookupCache?.results ?? [];
  const totalApprox = priceResults.reduce((acc, result) => {
    if (result.bestPrice == null || result.itemCount <= 0) return acc;
    return acc + result.bestPrice;
  }, 0);

  return (
    <View style={styles.captureCard}>
      <Text style={styles.captureTitle}>{photo.photoGroupTitle?.trim() || photo.title}</Text>
      <View style={styles.captureHeaderArea}>
        <View style={styles.captureHeaderInfo}>
          <Text style={styles.captureMeta}>Fecha: {formatDate(photo.createdAt)}</Text>
          <Text style={styles.captureMeta}>Paciente: {photo.ocrParsed?.patientName || 'No identificado'}</Text>
          <Text style={styles.captureMeta}>Profesional: {photo.ocrParsed?.doctorName?.trim() || 'No detectado'}</Text>
          <Text style={styles.captureMeta}>Centro: {photo.ocrParsed?.institution?.trim() || 'No detectado'}</Text>
        </View>

        <View style={styles.captureTotalCardFloating}>
          <Text style={styles.captureTotalLabel}>TOTAL APROX</Text>
          <Text style={styles.captureTotalValue}>{totalApprox > 0 ? `$${Math.round(totalApprox)}` : 'S/P'}</Text>
        </View>
      </View>

      <View style={styles.captureSection}>
        <Text style={styles.captureSectionTitle}>Medicamentos y precios</Text>
        {meds.length > 0 ? (
          meds.slice(0, 10).map((med, index) => {
            const detail = [med.dose, med.frequency, med.duration].filter(Boolean).join(' · ');
            const medName = med.name.trim().toLowerCase();
            const matched = priceResults.find((result) => {
              const query = result.query.trim().toLowerCase();
              return query.includes(medName) || medName.includes(query);
            });
            const hasPrice = Boolean(matched && matched.bestPrice != null && matched.itemCount > 0);
            return (
              <View key={`${med.name}-${index}`} style={styles.captureMedRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.captureText}>{med.name}</Text>
                  {detail ? <Text style={styles.captureSubText}>{detail}</Text> : null}
                </View>
                <Text style={[styles.capturePrice, !hasPrice ? styles.capturePriceMissing : null]}>
                  {hasPrice && matched ? `$${Math.round(matched.bestPrice as number)}` : 'S/P'}
                </Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.captureText}>Sin medicamentos detectados</Text>
        )}
        {priceResults.length === 0 ? <Text style={styles.captureHint}>Precios no consultados</Text> : null}
      </View>
    </View>
  );
}

function InfoRow({
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
    <View style={styles.infoRow}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function buildEmailSummary(settings: AppSettings, media: MediaItem[]) {
  const audios = media.filter((item) => item.type === 'audio');
  const photos = media.filter((item) => item.type === 'photo');
  const audioDuration = audios.reduce((sum, item) => sum + item.durationMillis, 0);
  const selected = media.slice(0, 30);

  const personBlock = [
    `Persona: ${settings.personName || 'No informado'}`,
    `Información relevante: ${settings.personInfo || 'No informada'}`,
  ].join('\n');

  const statsBlock = [
    `Fotos guardadas: ${photos.length}`,
    `Audios guardados: ${audios.length}`,
    `Duración total de audio: ${formatDuration(audioDuration)}`,
  ].join('\n');

  const selectedBlock = selected.length
    ? [
        `Registros seleccionados: ${selected.length}`,
        `Fotos seleccionadas: ${photos.length}`,
        `Audios seleccionados: ${audios.length}`,
        `Duración total audios seleccionados: ${formatDuration(audioDuration)}`,
      ].join('\n')
    : 'Sin registros seleccionados';

  return [
    'Resumen generado desde Media Hub (registros seleccionados)',
    '',
    personBlock,
    '',
    statsBlock,
    '',
    'Resumen de envío:',
    selectedBlock,
  ].join('\n');
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 120 },
  headerWrap: {
    paddingTop: 10,
    marginBottom: 20,
  },
  loadingBlock: {
    marginTop: 40,
    alignItems: 'center',
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
    padding: 12,
    marginBottom: 22,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  mailButton: {
    marginTop: 2,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  mailButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  mailHint: {
    marginTop: 8,
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 2,
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
    fontSize: 15,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 2,
  },
  saveButton: {
    borderRadius: 14,
    backgroundColor: '#0EA5E9',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  selectorBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.48)',
    justifyContent: 'flex-end',
  },
  selectorSafe: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  selectorCard: {
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  selectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '900',
  },
  selectorClose: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorSub: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 6,
    marginBottom: 10,
  },
  selectorList: {
    maxHeight: 420,
  },
  selectorRow: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#FFFFFF',
  },
  selectorLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectorType: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorTypePhoto: { backgroundColor: '#10B981' },
  selectorTypeAudio: { backgroundColor: '#6D28D9' },
  selectorRowTitle: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  selectorRowMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  selectorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  selectorAction: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorSummary: {
    backgroundColor: '#2563EB',
  },
  selectorSummaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  selectorAttach: {
    backgroundColor: '#E2E8F0',
  },
  selectorAttachText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  captureTitle: {
    color: '#0F172A',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
  },
  captureMeta: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  captureHeaderArea: {
    position: 'relative',
    marginTop: 4,
    minHeight: 112,
    paddingRight: 142,
  },
  captureHeaderInfo: {
    paddingTop: 2,
  },
  captureTotalCardFloating: {
    position: 'absolute',
    right: 0,
    top: 0,
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
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  captureTotalValue: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2,
    textAlign: 'right',
  },
  captureSection: {
    marginTop: 10,
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
    marginBottom: 5,
  },
  captureText: {
    color: '#0F172A',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  captureSubText: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
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
  capturePrice: {
    color: '#047857',
    fontSize: 14,
    fontWeight: '900',
  },
  capturePriceMissing: {
    color: '#B91C1C',
  },
  captureHint: {
    color: '#B45309',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '700',
  },
  captureRaw: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 18,
  },
});
