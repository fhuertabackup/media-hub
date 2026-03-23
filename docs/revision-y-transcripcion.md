# Revisión técnica y propuesta de transcripción (2026-03-23)

## 1) Revisión del proyecto (documentada, no bloqueante por ahora)

Contexto: app Expo + React Native con almacenamiento local de fotos/audios (`expo-file-system`) y captura/grabación en el cliente.

Hallazgos detectados durante la revisión:

1. Riesgo de caída por JSON inválido:
- Archivo: `src/lib/media-store.ts`
- Detalle: `JSON.parse` no está protegido ante corrupción del archivo `media-items.json`.
- Impacto: si el JSON se corrompe, las pantallas que dependen de `getAllMedia()` pueden fallar.

2. Modo de audio no se restablece explícitamente:
- Archivo: `app/(tabs)/index.tsx`
- Detalle: se activa `allowsRecording: true` para grabar, pero no se ve restauración explícita al cerrar/guardar.
- Impacto: comportamiento inconsistente de audio en algunos dispositivos.

3. Posible doble acción en `Pressable` anidado:
- Archivo: `app/(tabs)/biblioteca.tsx`
- Detalle: `Pressable` de compartir dentro de `Pressable` del tile.
- Impacto: en algunos casos puede abrir preview y compartir en el mismo toque.

4. Lint no pasa actualmente:
- Archivos: `app/(tabs)/index.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/ajustes.tsx`
- Detalle: comillas sin escapar + imports no usados.

5. Sin tests automáticos:
- No hay suite de test para cubrir regresiones.

Nota: estos puntos quedan documentados a solicitud, sin bloquear avance funcional.

---

## 2) ¿Se puede transcribir audio en la app?

Sí. Con OpenRouter se puede enviar audio como `input_audio` en `/api/v1/chat/completions` para obtener transcripción, siempre que el modelo elegido soporte audio input.

Referencias:
- OpenRouter Audio (input_audio): https://openrouter.ai/docs/guides/overview/multimodal/audio
- OpenRouter API reference: https://openrouter.ai/docs/api/reference/overview
- OpenRouter Models (filtrar audio input): https://openrouter.ai/models

---

## 3) Qué necesitamos para un MVP (con límite para pruebas)

### A. Backend intermedio (obligatorio)
No exponer `OPENROUTER_API_KEY` en la app móvil.

Opciones:
- Backend propio (Node/Express, Next API route, etc.)
- Edge Function (por ejemplo Supabase/Vercel/Cloudflare)

Responsabilidades mínimas del backend:
1. Recibir archivo de audio desde la app.
2. Validar tamaño, tipo y duración máxima.
3. Convertir a base64 y llamar OpenRouter.
4. Devolver transcripción y metadatos.

### B. Límite para pruebas (recomendado)
Para testear rápido y barato:
- Duración máxima: 60 segundos (o 90s como tope inicial)
- Tamaño máximo: 5 MB
- Formato aceptado: `m4a` (la app ya graba en ese flujo)

Si supera el límite: responder error claro para UX.

### C. Elección de modelo
Necesitamos seleccionar un modelo en OpenRouter que soporte audio input y transcripción en español.

Criterios:
- Soporte `input_audio`
- Calidad en español latino
- Costo por audio
- Latencia para móvil

### D. Cambios en app móvil
1. Extender tipo de audio (`AudioItem`) para guardar:
- `transcript?: string`
- `transcriptStatus?: 'pending' | 'done' | 'error'`
- `transcriptError?: string`

2. UI:
- Botón `Transcribir` en cada audio
- Estado visual (`Transcribiendo...`)
- Mostrar texto transcrito

3. Flujo:
- Usuario graba
- Guarda audio
- Tap en `Transcribir`
- App sube audio al backend
- Backend devuelve texto
- App persiste texto localmente

### E. Observabilidad mínima
- Log de duración real enviada
- Tiempo de respuesta del proveedor
- Errores por tipo (timeout, formato, límite)

---

## 4) Payload de referencia (backend -> OpenRouter)

Ejemplo orientativo (chat completions + `input_audio`):

```json
{
  "model": "<modelo-con-audio-input>",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Transcribe este audio en español. Devuelve solo la transcripción literal."
        },
        {
          "type": "input_audio",
          "inputAudio": {
            "data": "<AUDIO_BASE64>",
            "format": "m4a"
          }
        }
      ]
    }
  ],
  "stream": false
}
```

---

## 5) Riesgos y decisiones

1. Privacidad:
- El audio sale del dispositivo hacia proveedor externo.
- Se debe definir política de retención y consentimiento.

2. Costos:
- El costo depende del modelo y la duración de audio.
- Limitar duración al inicio evita sorpresas.

3. Calidad vs latencia:
- Modelos más baratos pueden degradar transcripción en ruido/acento.
- Recomendado benchmark corto con 10-20 audios reales.

---

## 6) Plan de implementación sugerido (rápido)

1. Crear endpoint backend `POST /transcriptions` con límite 60s/5MB.
2. Integrar llamada OpenRouter con modelo audio-input.
3. En app, agregar botón `Transcribir` en `AudioCard`.
4. Guardar transcripción en `media-items.json`.
5. Probar con 10 audios reales (silencio, ruido, distintos acentos).
6. Ajustar límite/modelo según costo-calidad.

