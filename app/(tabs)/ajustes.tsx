import React, { useCallback, useState } from 'react';
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
      await MailComposer.composeAsync({
        recipients: [to],
        subject: 'Registros seleccionados con adjuntos - Media Hub',
        body,
        attachments: selectedRecords.slice(0, 10).map((item) => item.uri),
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
    </SafeAreaView>
  );
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
    ? selected
        .map((item) => {
          if (item.type === 'audio') {
            const summary = item.aiSummary?.trim() || 'Sin resumen disponible.';
            return [
              `- AUDIO | ${item.title}`,
              `  Fecha: ${formatDate(item.createdAt)}`,
              `  DUR.: ${formatDuration(item.durationMillis)}`,
              `  Resumen: ${summary}`,
            ].join('\n');
          }

          const meds = item.ocrParsed?.medications ?? [];
          const medsText =
            meds.length > 0
              ? meds
                  .slice(0, 8)
                  .map((med) => {
                    const detail = [med.dose, med.frequency, med.duration].filter(Boolean).join(' · ');
                    return detail ? `    - ${med.name}: ${detail}` : `    - ${med.name}`;
                  })
                  .join('\n')
              : '    - Sin medicamentos detectados';
          const indications = item.ocrParsed?.indicationsGeneral?.trim();
          const ocrRaw = item.ocrParsed?.rawText?.trim() || item.ocrText?.trim() || '[SIN_TEXTO]';
          const recipeText = [
            `- FOTO RECETA | ${item.title}`,
            `  Fecha: ${formatDate(item.createdAt)}`,
            `  Paciente: ${item.ocrParsed?.patientName || 'No identificado'}`,
            `  Medicamentos:`,
            medsText,
            `  Indicaciones: ${indications || 'No detectadas'}`,
            `  Texto OCR: ${ocrRaw}`,
          ];
          return recipeText.join('\n');
        })
        .join('\n\n')
    : '- Sin registros seleccionados';

  return [
    'Resumen generado desde Media Hub (registros seleccionados)',
    '',
    personBlock,
    '',
    statsBlock,
    '',
    'Registros incluidos:',
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
});
