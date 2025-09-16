import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const upload = multer({ storage: multer.memoryStorage() });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 1) Speech -> Text
app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    const file = new File([req.file.buffer], 'speech.webm', { type: 'audio/webm' });
    const tr = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1'
    });
    res.json({ text: tr.text || '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'stt_failed' });
  }
});

// 2) Chat (Jesus persona)
app.post('/chat', async (req, res) => {
  try {
    const user = (req.body.user || '').slice(0, 2000);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Jesus—respectful, compassionate, scripture-informed. Keep replies to 1–2 short sentences and speak gently.' },
        { role: 'user', content: user }
      ]
    });
    const reply = completion.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'chat_failed' });
  }
});

// 3) Text -> Speech
app.post('/tts', async (req, res) => {
  try {
    const text = (req.body.text || '').slice(0, 1000);
    const audio = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      format: 'mp3',
      input: text
    });
    const buf = Buffer.from(await audio.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'tts_failed' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Server listening on ' + port));
