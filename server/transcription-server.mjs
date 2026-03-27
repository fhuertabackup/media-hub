import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const app = express();
const port = Number(process.env.TRANSCRIBE_PORT ?? 4001);
const host = process.env.TRANSCRIBE_HOST ?? '0.0.0.0';
const maxFileMb = Number(process.env.TRANSCRIBE_MAX_FILE_MB ?? 5);
const openRouterKey = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_TRANSCRIBE_MODEL ?? 'mistralai/voxtral-small-24b-2507';
const postProcessEnabled = process.env.TRANSCRIBE_POSTPROCESS === 'true';
const postProcessModel = process.env.OPENROUTER_POSTPROCESS_MODEL ?? 'google/gemini-2.0-flash-lite-001';
const vocabularyHints = process.env.TRANSCRIBE_HINTS ?? '';
const audioAiEnabled = process.env.AUDIO_AI_ENABLED === 'true';
const audioAiModel = process.env.OPENROUTER_AUDIO_AI_MODEL ?? 'mistralai/voxtral-small-24b-2507';
const enrichModel = process.env.OPENROUTER_ENRICH_MODEL ?? 'google/gemini-2.0-flash-lite-001';
const photoTitleModel = process.env.OPENROUTER_PHOTO_TITLE_MODEL ?? enrichModel;
const ocrModel =
  process.env.OPENROUTER_OCR_MODEL ?? 'mistralai/mistral-small-3.1-24b-instruct:free';
const ocrFallbackModels = (process.env.OPENROUTER_OCR_FALLBACK_MODELS ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!openRouterKey) {
  console.error('Missing OPENROUTER_API_KEY in environment.');
  process.exit(1);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileMb * 1024 * 1024 },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    model,
    audioAiEnabled,
    audioAiModel: audioAiEnabled ? audioAiModel : null,
    enrichModel,
    photoTitleModel,
    ocrModel,
    ocrFallbackModels,
    postProcessEnabled,
    postProcessModel: postProcessEnabled ? postProcessModel : null,
    maxFileMb,
  });
});

app.post('/api/transcriptions', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'audio file is required' });
    }

    const preparedAudio = await prepareAudioForProvider(file);

    const payload = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildTranscriptionInstruction(vocabularyHints),
            },
            {
              type: 'input_audio',
              input_audio: {
                data: preparedAudio.base64,
                format: preparedAudio.format,
              },
            },
          ],
        },
      ],
      stream: false,
      temperature: 0,
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      const providerRaw = data?.error?.metadata?.raw;
      const providerMessage = typeof providerRaw === 'string' ? extractProviderMessage(providerRaw) : '';
      return res.status(response.status).json({
        error: providerMessage || data?.error?.message || 'OpenRouter error',
        details: data,
      });
    }

    const rawTranscript = extractTextFromChoice(data);
    const transcript = postProcessTranscript(rawTranscript);
    if (!transcript) {
      return res.status(502).json({
        error: 'No transcription content returned by model',
        details: data,
      });
    }

    const finalTranscript = postProcessEnabled
      ? await refineTranscriptWithModel(transcript, postProcessModel, openRouterKey)
      : transcript;

    return res.json({
      transcript: finalTranscript,
      rawTranscript,
      model,
      usage: data?.usage ?? null,
    });
  } catch (error) {
    console.error('transcription error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/audio-ai/query', upload.single('audio'), async (req, res) => {
  try {
    if (!audioAiEnabled) {
      return res.status(403).json({
        error: 'Audio AI feature is disabled',
      });
    }

    const file = req.file;
    const prompt = String(req.body?.prompt ?? '').trim();
    if (!file) {
      return res.status(400).json({ error: 'audio file is required' });
    }
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const preparedAudio = await prepareAudioForProvider(file);

    const payload = {
      model: audioAiModel,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Responde SOLO a la consulta del usuario usando como contexto el audio adjunto. Si el audio no tiene información suficiente, dilo explícitamente de forma breve.',
            },
            {
              type: 'text',
              text: `Consulta del usuario: ${prompt}`,
            },
            {
              type: 'input_audio',
              input_audio: {
                data: preparedAudio.base64,
                format: preparedAudio.format,
              },
            },
          ],
        },
      ],
      stream: false,
      temperature: 0.2,
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      const providerRaw = data?.error?.metadata?.raw;
      const providerMessage = typeof providerRaw === 'string' ? extractProviderMessage(providerRaw) : '';
      return res.status(response.status).json({
        error: providerMessage || data?.error?.message || 'OpenRouter error',
        details: data,
      });
    }

    const answer = extractTextFromChoice(data);
    if (!answer) {
      return res.status(502).json({
        error: 'No answer content returned by model',
        details: data,
      });
    }

    return res.json({
      answer,
      model: audioAiModel,
      usage: data?.usage ?? null,
    });
  } catch (error) {
    console.error('audio ai error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/transcriptions/enrich', async (req, res) => {
  try {
    const transcript = String(req.body?.transcript ?? '').trim();
    if (!transcript || transcript === '[SIN_VOZ]') {
      return res.status(400).json({
        error: 'Valid transcript is required',
      });
    }

    const payload = {
      model: enrichModel,
      messages: [
        {
          role: 'user',
          content: buildEnrichmentInstruction(transcript),
        },
      ],
      stream: false,
      temperature: 0.2,
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      const providerRaw = data?.error?.metadata?.raw;
      const providerMessage = typeof providerRaw === 'string' ? extractProviderMessage(providerRaw) : '';
      return res.status(response.status).json({
        error: providerMessage || data?.error?.message || 'OpenRouter error',
        details: data,
      });
    }

    const rawContent = extractTextFromChoice(data);
    const parsed = parseEnrichment(rawContent);
    if (!parsed) {
      return res.status(502).json({
        error: 'Invalid enrich response format',
        details: data,
      });
    }

    return res.json({
      title: parsed.title,
      summary: parsed.summary,
      model: enrichModel,
      usage: data?.usage ?? null,
    });
  } catch (error) {
    console.error('enrich error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/photos/ocr', upload.single('photo'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'photo file is required' });
    }

    const imageType = detectImageMime(file.mimetype, file.originalname);
    if (!imageType) {
      return res.status(400).json({ error: 'Unsupported image format' });
    }

    const imageDataUrl = `data:${imageType};base64,${file.buffer.toString('base64')}`;
    const modelCandidates = [...new Set([ocrModel, ...ocrFallbackModels])];
    let text = '';
    let parsed = null;
    let selectedModel = modelCandidates[0];
    let lastFailure = null;

    for (const candidateModel of modelCandidates) {
      const payload = {
        model: candidateModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildPhotoOcrInstruction(),
              },
              {
                type: 'image_url',
                image_url: { url: imageDataUrl },
              },
            ],
          },
        ],
        stream: false,
        temperature: 0,
      };

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const providerRaw = data?.error?.metadata?.raw;
        const providerMessage = typeof providerRaw === 'string' ? extractProviderMessage(providerRaw) : '';
        lastFailure = {
          status: response.status,
          error: providerMessage || data?.error?.message || 'OpenRouter error',
          details: data,
        };
        continue;
      }

      const extracted = extractTextFromChoice(data).trim();
      if (!extracted) {
        lastFailure = {
          status: 502,
          error: 'No OCR text returned by model',
          details: data,
        };
        continue;
      }

      const structured = parsePhotoOcr(extracted);
      text = structured?.rawText || extracted;
      parsed = structured;
      selectedModel = candidateModel;
      break;
    }

    if (!text) {
      return res.status(lastFailure?.status ?? 502).json({
        error: lastFailure?.error ?? 'OCR failed for all configured models',
        details: lastFailure?.details ?? null,
      });
    }

    return res.json({
      text,
      parsed,
      model: selectedModel,
    });
  } catch (error) {
    console.error('photo ocr error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/photos/title', async (req, res) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text || text === '[SIN_TEXTO]') {
      return res.status(400).json({ error: 'Valid OCR text is required' });
    }

    const payload = {
      model: photoTitleModel,
      messages: [
        {
          role: 'user',
          content:
            'Genera un título MUY corto para una receta médica (máximo 4 palabras). Debe servir como nombre del evento de fotos. Devuelve SOLO el título sin comillas.\n\n' +
            text,
        },
      ],
      stream: false,
      temperature: 0.2,
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const providerRaw = data?.error?.metadata?.raw;
      const providerMessage = typeof providerRaw === 'string' ? extractProviderMessage(providerRaw) : '';
      return res.status(response.status).json({
        error: providerMessage || data?.error?.message || 'OpenRouter error',
        details: data,
      });
    }

    const rawTitle = extractTextFromChoice(data);
    const title = normalizePhotoTitle(rawTitle);
    if (!title) {
      return res.status(502).json({ error: 'No title returned by model', details: data });
    }

    return res.json({
      title,
      model: photoTitleModel,
      usage: data?.usage ?? null,
    });
  } catch (error) {
    console.error('photo title error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/prices/fonasa', async (req, res) => {
  try {
    const latitud = Number(req.body?.latitud);
    const longitud = Number(req.body?.longitud);
    const medications = Array.isArray(req.body?.medications)
      ? req.body.medications
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      : [];

    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
      return res.status(400).json({ error: 'latitud y longitud son requeridas.' });
    }
    if (medications.length === 0) {
      return res.status(400).json({ error: 'medications es requerido.' });
    }

    const results = await Promise.all(
      medications.map((query) =>
        lookupFonasaMedication({ latitud, longitud, nombreMedicamento: query })
      )
    );

    return res.json({
      provider: 'fonasa',
      results,
    });
  } catch (error) {
    console.error('fonasa prices error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/prices/fonasa/detail', async (req, res) => {
  try {
    const latitud = Number(req.body?.latitud);
    const longitud = Number(req.body?.longitud);
    const nombreMedicamento = String(req.body?.nombreMedicamento ?? '').trim();
    const registroSanitario = String(req.body?.registroSanitario ?? '').trim();
    const presentacion = String(req.body?.presentacion ?? '').trim();
    const laboratorio = String(req.body?.laboratorio ?? '').trim();

    if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
      return res.status(400).json({ error: 'latitud y longitud son requeridas.' });
    }
    if (!nombreMedicamento || !registroSanitario || !presentacion || !laboratorio) {
      return res.status(400).json({ error: 'Parámetros de medicamento incompletos.' });
    }

    const pharmacies = await lookupFonasaDetail({
      latitud,
      longitud,
      nombreMedicamento,
      registroSanitario,
      presentacion,
      laboratorio,
    });

    return res.json({
      provider: 'fonasa',
      pharmacies,
    });
  } catch (error) {
    console.error('fonasa detail error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.post('/api/medications/extract', async (req, res) => {
  try {
    const text = String(req.body?.text ?? '').trim();
    if (!text || text === '[SIN_TEXTO]') {
      return res.json({ medications: [] });
    }

    const payload = {
      model: enrichModel,
      messages: [
        {
          role: 'user',
          content:
            'Analiza este texto OCR de receta médica y devuelve SOLO JSON válido con este formato exacto:\n' +
            '{"medications":["NOMBRE 1","NOMBRE 2"]}\n' +
            'Reglas:\n' +
            '- Incluir solo nombres de medicamentos.\n' +
            '- No incluir dosis, frecuencia, médico, hospital ni indicaciones.\n' +
            '- Sin duplicados.\n' +
            '- Máximo 10 elementos.\n\n' +
            text,
        },
      ],
      stream: false,
      temperature: 0,
    };

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'OpenRouter error',
      });
    }

    const raw = extractTextFromChoice(data);
    const medications = parseMedicationExtraction(raw);
    return res.json({ medications, model: enrichModel });
  } catch (error) {
    console.error('medications extract error', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

app.listen(port, host, () => {
  console.log(`Transcription API listening on http://${host}:${port}`);
});

function detectFormat(mimetype = '', fileName = '') {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (mimetype.includes('mpeg') || ext === 'mp3') return 'mp3';
  if (mimetype.includes('wav') || ext === 'wav') return 'wav';
  if (mimetype.includes('webm') || ext === 'webm') return 'webm';
  if (mimetype.includes('ogg') || ext === 'ogg') return 'ogg';
  if (
    mimetype.includes('mp4') ||
    mimetype.includes('m4a') ||
    ext === 'm4a' ||
    ext === 'mp4'
  ) {
    return 'm4a';
  }

  return null;
}

function detectImageMime(mimetype = '', fileName = '') {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (mimetype.includes('png') || ext === 'png') return 'image/png';
  if (mimetype.includes('webp') || ext === 'webp') return 'image/webp';
  if (mimetype.includes('heic') || ext === 'heic') return 'image/heic';
  if (mimetype.includes('jpeg') || mimetype.includes('jpg') || ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg';
  }

  return null;
}

async function prepareAudioForProvider(file) {
  const format = detectFormat(file.mimetype, file.originalname);
  if (!format) {
    throw new Error('Unsupported audio format');
  }

  if (format === 'wav' || format === 'mp3') {
    return {
      format,
      base64: file.buffer.toString('base64'),
    };
  }

  const tmpId = randomUUID();
  const inputPath = join(tmpdir(), `media-hub-${tmpId}.${format}`);
  const outputPath = join(tmpdir(), `media-hub-${tmpId}.wav`);

  try {
    await fs.writeFile(inputPath, file.buffer);
    await transcodeWithFfmpeg(inputPath, outputPath);
    const converted = await fs.readFile(outputPath);
    return {
      format: 'wav',
      base64: converted.toString('base64'),
    };
  } finally {
    await Promise.allSettled([fs.unlink(inputPath), fs.unlink(outputPath)]);
  }
}

function transcodeWithFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-ar',
      '16000',
      '-ac',
      '1',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`ffmpeg is required for audio conversion (${error.message}).`));
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Audio conversion failed: ${stderr || `ffmpeg exited with ${code}`}`));
    });
  });
}

function extractTextFromChoice(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('\n')
    .trim();
}

function extractProviderMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.message ? String(parsed.error.message) : '';
  } catch {
    return String(raw).trim();
  }
}

function buildEnrichmentInstruction(transcript) {
  return (
    'A partir de la transcripción en español, genera:\n' +
    '1) Un título breve y útil (máximo 8 palabras).\n' +
    '2) Un resumen breve (1-2 frases).\n' +
    'No inventes información. Mantén nombres y datos originales.\n' +
    'Devuelve SOLO un JSON válido en una sola línea con este formato exacto:\n' +
    '{"title":"...","summary":"..."}\n\n' +
    `TRANSCRIPCIÓN:\n${transcript}`
  );
}

function buildTranscriptionInstruction(hints) {
  const base =
    'Transcribe literalmente este audio en español. Responde SOLO con la transcripción. No hagas resúmenes ni explicaciones. Si una parte es ininteligible usa [inaudible]. Si no hay voz inteligible responde SOLO: [SIN_VOZ].';

  const normalizedHints = hints
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalizedHints.length === 0) {
    return base;
  }

  return `${base} Prioriza estas palabras/nombres: ${normalizedHints.join(', ')}.`;
}

function postProcessTranscript(text) {
  const cleaned = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  if (!cleaned || cleaned === '[SIN_VOZ]') return cleaned;

  const withCapital = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (/[.!?…]$/.test(withCapital)) return withCapital;
  return `${withCapital}.`;
}

async function refineTranscriptWithModel(transcript, selectedModel, key) {
  if (!transcript || transcript === '[SIN_VOZ]') return transcript;

  const payload = {
    model: selectedModel,
    messages: [
      {
        role: 'user',
        content:
          'Corrige solo ortografía, tildes y puntuación del siguiente texto en español. No agregues información nueva ni cambies nombres propios. Devuelve SOLO el texto final.\n\n' +
          transcript,
      },
    ],
    stream: false,
    temperature: 0,
  };

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return transcript;
  }

  const refined = extractTextFromChoice(data);
  return refined ? postProcessTranscript(refined) : transcript;
}

function parseEnrichment(rawContent) {
  if (!rawContent) return null;

  try {
    const clean = extractJsonCandidate(rawContent);
    const parsed = JSON.parse(clean);
    const title = String(parsed?.title ?? '').trim();
    const summary = String(parsed?.summary ?? '').trim();
    if (!title || !summary) return null;
    return { title, summary };
  } catch {
    const fallback = fallbackEnrichmentFromText(rawContent);
    return fallback;
  }
}

function extractJsonCandidate(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }
  return text.trim();
}

function fallbackEnrichmentFromText(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let title = '';
  let summary = '';

  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!title && (normalized.startsWith('título:') || normalized.startsWith('titulo:'))) {
      title = line.split(':').slice(1).join(':').trim();
      continue;
    }
    if (!summary && normalized.startsWith('resumen:')) {
      summary = line.split(':').slice(1).join(':').trim();
      continue;
    }
  }

  if (!title && lines.length > 0) {
    title = lines[0].slice(0, 80).trim();
  }
  if (!summary && lines.length > 1) {
    summary = lines.slice(1).join(' ').slice(0, 240).trim();
  }

  if (!title || !summary) return null;
  return { title, summary };
}

function normalizePhotoTitle(rawTitle) {
  const cleaned = String(rawTitle || '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  const words = cleaned.split(' ').slice(0, 4);
  return words.join(' ');
}

async function lookupFonasaMedication({ latitud, longitud, nombreMedicamento }) {
  const payload = {
    latitud: String(latitud),
    longitud: String(longitud),
    nombreMedicamento: String(nombreMedicamento || '').trim(),
    principioActivo: null,
  };

  const response = await fetch('https://api.fonasa.cl/medicamentos/obtener', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      query: payload.nombreMedicamento,
      bestPrice: null,
      itemCount: 0,
      items: [],
    };
  }

  const items = normalizeFonasaItems(data);
  const withPrice = items.filter((item) => Number.isFinite(item.ofertaFonasa));
  const bestPrice = withPrice.length
    ? Math.min(...withPrice.map((item) => Number(item.ofertaFonasa)))
    : null;

  return {
    query: payload.nombreMedicamento,
    bestPrice,
    itemCount: items.length,
    items: items.slice(0, 8),
  };
}

function normalizeFonasaItems(data) {
  const listado = Array.isArray(data?.listado) ? data.listado : [];
  const items = [];

  for (const entry of listado) {
    const presentaciones = Array.isArray(entry?.presentacionesExistentes)
      ? entry.presentacionesExistentes
      : [];

    for (const presentacion of presentaciones) {
      const productos = Array.isArray(presentacion?.productos) ? presentacion.productos : [];
      for (const producto of productos) {
        const price = Number(producto?.ofertaFonasa);
        items.push({
          id: Number(producto?.id) || undefined,
          nombreMedicamento: String(producto?.nombreMedicamento ?? '').trim(),
          principioActivo1: String(producto?.principioActivo1 ?? '').trim(),
          registroSanitario: String(producto?.registroSanitario ?? '').trim(),
          presentacion: String(producto?.presentacion ?? '').trim(),
          formaFarmaceutica: String(producto?.formaFarmaceutica ?? '').trim(),
          laboratorio: String(producto?.laboratorio ?? '').trim(),
          ofertaFonasa: Number.isFinite(price) ? price : undefined,
        });
      }
    }
  }

  return items.sort((a, b) => (a.ofertaFonasa ?? Number.MAX_SAFE_INTEGER) - (b.ofertaFonasa ?? Number.MAX_SAFE_INTEGER));
}

function parseMedicationExtraction(rawContent) {
  if (!rawContent) return [];
  try {
    const clean = extractJsonCandidate(rawContent);
    const parsed = JSON.parse(clean);
    const medications = Array.isArray(parsed?.medications) ? parsed.medications : [];
    return [...new Set(
      medications
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
        .slice(0, 10)
    )];
  } catch {
    return [];
  }
}

async function lookupFonasaDetail({
  latitud,
  longitud,
  nombreMedicamento,
  registroSanitario,
  presentacion,
  laboratorio,
}) {
  const response = await fetch('https://api.fonasa.cl/medicamentos/detalle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      latitud,
      longitud,
      nombreMedicamento,
      registroSanitario,
      presentacion,
      laboratorio,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) return [];
  return normalizeFonasaDetail(data);
}

function normalizeFonasaDetail(data) {
  const groups = Array.isArray(data?.Farmacias) ? data.Farmacias : [];
  const out = [];

  for (const group of groups) {
    const rows = Array.isArray(group?.data) ? group.data : [];
    for (const row of rows) {
      out.push({
        farmacia: String(row?.nombreFarmacia ?? row?.farmacia ?? '').trim(),
        nombreSucursal: String(row?.nombreSucursal ?? '').trim(),
        direccion: String(row?.direccion ?? '').trim(),
        comuna: String(row?.comuna ?? '').trim(),
        ciudad: String(row?.ciudad ?? '').trim(),
        region: String(row?.region ?? '').trim(),
        distancia: Number.isFinite(Number(row?.distancia)) ? Number(row.distancia) : null,
        latitud: Number.isFinite(Number(row?.latitud)) ? Number(row.latitud) : null,
        longitud: Number.isFinite(Number(row?.longitud)) ? Number(row.longitud) : null,
        ofertaFonasa: Number.isFinite(Number(row?.ofertaFonasa)) ? Number(row.ofertaFonasa) : null,
        precioNormal: Number.isFinite(Number(row?.precioNormal)) ? Number(row.precioNormal) : null,
        ahorro: Number.isFinite(Number(row?.ahorro)) ? Number(row.ahorro) : null,
      });
    }
  }

  return out.sort((a, b) => {
    const aFonasa = a.ofertaFonasa ?? Number.MAX_SAFE_INTEGER;
    const bFonasa = b.ofertaFonasa ?? Number.MAX_SAFE_INTEGER;
    if (aFonasa !== bFonasa) return aFonasa - bFonasa;

    const aDist = a.distancia ?? Number.MAX_SAFE_INTEGER;
    const bDist = b.distancia ?? Number.MAX_SAFE_INTEGER;
    return aDist - bDist;
  });
}

function buildPhotoOcrInstruction() {
  return (
    'Analiza esta imagen de receta médica y devuelve SOLO JSON válido (sin markdown ni texto extra) con este esquema exacto:\n' +
    '{"raw_text":"string","institution":"string","doctor_name":"string","doctor_license":"string","patient_name":"string","date":"string","indications_general":"string","medications":[{"name":"string","dose":"string","frequency":"string","duration":"string","notes":"string"}]}\n' +
    'Reglas:\n' +
    '- Es SIEMPRE una receta médica del paciente.\n' +
    '- raw_text: TODO el texto visible literal, sin resumir.\n' +
    '- No inventes datos.\n' +
    '- patient_name es obligatorio: si no aparece, usa "PACIENTE_NO_IDENTIFICADO".\n' +
    '- Si otro campo no aparece, usa string vacío "".\n' +
    '- medications debe listar cada medicamento encontrado; si no hay, devuelve []\n' +
    '- Si no hay texto legible, devuelve {"raw_text":"[SIN_TEXTO]","institution":"","doctor_name":"","doctor_license":"","patient_name":"PACIENTE_NO_IDENTIFICADO","date":"","indications_general":"","medications":[]}.'
  );
}

function parsePhotoOcr(rawContent) {
  if (!rawContent) return null;

  try {
    const jsonText = extractJsonCandidate(rawContent);
    const parsed = JSON.parse(jsonText);
    return normalizePhotoOcrParsed(parsed);
  } catch {
    return {
      rawText: String(rawContent).trim() || '[SIN_TEXTO]',
      institution: '',
      doctorName: '',
      doctorLicense: '',
      patientName: '',
      date: '',
      indicationsGeneral: '',
      medications: [],
    };
  }
}

function normalizePhotoOcrParsed(value) {
  const rawText = String(value?.raw_text ?? '').trim() || '[SIN_TEXTO]';

  const medicationsInput = Array.isArray(value?.medications) ? value.medications : [];
  const medications = medicationsInput
    .map((med) => ({
      name: String(med?.name ?? '').trim(),
      dose: String(med?.dose ?? '').trim(),
      frequency: String(med?.frequency ?? '').trim(),
      duration: String(med?.duration ?? '').trim(),
      notes: String(med?.notes ?? '').trim(),
    }))
    .filter((med) => med.name);

  return {
    rawText,
    institution: String(value?.institution ?? '').trim(),
    doctorName: String(value?.doctor_name ?? '').trim(),
    doctorLicense: String(value?.doctor_license ?? '').trim(),
    patientName: String(value?.patient_name ?? '').trim() || 'PACIENTE_NO_IDENTIFICADO',
    date: String(value?.date ?? '').trim(),
    indicationsGeneral: String(value?.indications_general ?? '').trim(),
    medications,
  };
}
