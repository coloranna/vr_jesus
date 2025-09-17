import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Simple request logger
app.use((req, _res, next) => { console.log('[REQ]', req.method, req.url); next(); });

const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- Health / diagnostics ----
app.get('/healthz', (_req, res) => {
  const masked = (process.env.OPENAI_API_KEY || '').replace(/^(.{4}).+(.{4})$/, '$1…$2');
  res.json({
    ok: true,
    openaiKeyPresent: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
    node: process.version,
    defaultVoice: process.env.OPENAI_TTS_VOICE || 'alloy',
    keyMasked: masked || '(empty)'
  });
});

// ---- STT: robust (toFile) + model fallback ----
app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    console.log('STT received:', req.file.mimetype, 'size:', req.file.size);
    const file = await toFile(req.file.buffer, 'speech.webm', { type: req.file.mimetype || 'audio/webm' });

    let tr;
    try {
      tr = await openai.audio.transcriptions.create({ model: 'gpt-4o-transcribe', file });
      console.log('STT: gpt-4o-transcribe OK');
    } catch (e) {
      console.warn('STT: gpt-4o-transcribe failed, trying whisper-1:', e.status || '', e.message || '');
      tr = await openai.audio.transcriptions.create({ model: 'whisper-1', file });
      console.log('STT: whisper-1 OK');
    }
    res.json({ text: tr.text || '' });
  } catch (err) {
    console.error('STT error:', err);
    res.status(500).json({ error: 'stt_failed', detail: String(err) });
  }
});

// ---- Chat persona ----
app.post('/chat', async (req, res) => {
  try {
    const user = (req.body.user || '').slice(0, 2000);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Jesus—respectful, compassionate, scripture-informed. Speak in a calm, grounded male tone. Keep replies to 1–2 short sentences.' },
        { role: 'user', content: user }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error('CHAT error:', err);
    res.status(500).json({ error: 'chat_failed', detail: String(err) });
  }
});

// ---- TTS with voice fallback ----
async function synth(text, voice, model) {
  const audio = await openai.audio.speech.create({
    model,
    voice,
    format: 'mp3',
    input: text
  });
  return Buffer.from(await audio.arrayBuffer());
}

app.post('/tts', async (req, res) => {
  const text = (req.body.text || '').slice(0, 1000);
  const requested = (req.body.voice || req.query.voice || process.env.OPENAI_TTS_VOICE || 'alloy').trim();
  const models = ['gpt-4o-mini-tts'];
  const voices = [requested, 'alloy']; // alloy as safe fallback
  try {
    let lastErr;
    for (const m of models) {
      for (const v of voices) {
        try {
          console.log('[TTS] trying', m, 'voice=', v);
          const buf = await synth(text, v, m);
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(buf);
        } catch (e) {
          lastErr = e;
          console.warn('[TTS] failed', m, 'voice=', v, e.status || '', e.message || e);
        }
      }
    }
    throw lastErr || new Error('TTS failed for all attempts');
  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: 'tts_failed', detail: String(err.message || err) });
  }
});

// ---- Quick MP3 test ----
// GET /say?text=Peace%20be%20with%20you&voice=alloy
app.get('/say', async (req, res) => {
  const text = (req.query.text || 'Testing one two three').toString().slice(0, 1000);
  req.query.voice && (req.query.voice = req.query.voice.toString());
  req.body = { text, voice: req.query.voice };
  return app._router.handle({ ...req, method: 'POST', url: '/tts' }, res);
});

// ---- Serve client statically (single URL) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.join(__dirname, '../client');
app.use(express.static(clientDir));
app.get('/', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Server listening on ' + port));

