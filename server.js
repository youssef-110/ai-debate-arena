// ============================================================
//  AI DEBATE ARENA — Express backend
//  All provider keys stay server-side. The frontend only ever
//  talks to these endpoints.
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
// Serving only public/ also keeps server.js and .env from being downloadable.
app.use(express.static(path.join(__dirname, 'public')));

// The live site runs on the owner's free API keys, so cap AI calls per visitor.
// shortcut: in-memory per instance, resets on cold start; use a shared store if abused.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_10_MIN) || 60; // a full debate is 11 calls
const hits = new Map();
const MAX_TRACKED_IPS = 10000;

// On Vercel, x-real-ip is set by the platform to the connecting client and cannot be
// spoofed by the caller. Elsewhere, only the socket address is trusted.
function clientIp(req) {
  const ip = (process.env.VERCEL && req.headers['x-real-ip']) || req.socket.remoteAddress || 'unknown';
  return String(ip).slice(0, 64);
}

// Drop visitors with no recent calls, and cap the map so it cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of hits) {
    if (!times.length || now - times[times.length - 1] >= RATE_WINDOW_MS) hits.delete(ip);
  }
}, 60 * 1000).unref();
function rateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
  }
  recent.push(now);
  if (!hits.has(ip) && hits.size >= MAX_TRACKED_IPS) hits.delete(hits.keys().next().value);
  hits.set(ip, recent);
  next();
}
app.use(['/api/argument', '/api/judge'], rateLimit);

// ------------------------------------------------------------
//  Providers
// ------------------------------------------------------------

const PROVIDERS = {
  groq: {
    label: 'Groq',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    envKey: 'GROQ_API_KEY'
  },
  gemini: {
    label: 'Gemini',
    model: 'gemini-2.5-flash',
    envKey: 'GEMINI_API_KEY'
  }
};

function providerAvailable(id) {
  const p = PROVIDERS[id];
  const key = p && process.env[p.envKey];
  return Boolean(key && key.trim() && !key.startsWith('your_'));
}

async function callGroq(system, user, { temperature = 0.9, maxTokens = 500 } = {}) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: PROVIDERS.groq.model,
      temperature,
      // gpt-oss models reason first, and reasoning tokens count against max_tokens.
      ...(PROVIDERS.groq.model.startsWith('openai/gpt-oss')
        ? { reasoning_effort: 'low', max_tokens: maxTokens + 1500 }
        : { max_tokens: maxTokens }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq returned an empty response.');
  return text.trim();
}

async function callGemini(system, user, { temperature = 0.9, maxTokens = 500 } = {}) {
  const model = PROVIDERS.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        // gemini-2.5 models spend "thinking" tokens from the same budget,
        // which truncates replies mid-sentence — turn thinking off.
        thinkingConfig: { thinkingBudget: 0 }
      }
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
  if (!text) throw new Error('Gemini returned an empty response.');
  return text.trim();
}

async function callProvider(provider, system, user, options) {
  if (!PROVIDERS[provider]) throw new Error(`Unknown provider "${provider}".`);
  if (!providerAvailable(provider)) {
    throw new Error(`${PROVIDERS[provider].label} is not configured. Add ${PROVIDERS[provider].envKey} to your .env file.`);
  }
  return provider === 'groq'
    ? callGroq(system, user, options)
    : callGemini(system, user, options);
}

// ------------------------------------------------------------
//  Debate topics (50+)
// ------------------------------------------------------------

const TOPICS = [
  'Pineapple belongs on pizza',
  'Social media has done more harm than good',
  'AI art is real art',
  'Cats are better companions than dogs',
  'Homework should be abolished',
  'Time travel to the past should be illegal if invented',
  'Billionaires should not exist',
  'Remote work is superior to office work',
  'Video games are a sport',
  'Humanity should colonize Mars before fixing Earth',
  'Cereal is a soup',
  'The moon landing was humanity\'s greatest achievement',
  'Zoos should be banned',
  'Money can buy happiness',
  'Hot dogs are sandwiches',
  'School uniforms should be mandatory',
  'Aliens have already visited Earth',
  'Books are always better than their movie adaptations',
  'The death penalty should be abolished worldwide',
  'A four-day work week should be the global standard',
  'Cryptocurrency is the future of money',
  'Superheroes are bad role models',
  'Breakfast is the most important meal of the day',
  'Self-driving cars should replace human drivers entirely',
  'Voting should be mandatory',
  'The internet should be a basic human right',
  'Reality TV is destroying culture',
  'Space exploration is a waste of money',
  'Every human should be vegetarian',
  'Grades do more harm than good in education',
  'Androids dreaming of electric sheep deserve legal rights',
  'Coffee is overrated',
  'Winter is the best season',
  'Professional athletes are overpaid',
  'Smartphones should be banned in schools',
  'Democracy is the best possible system of government',
  'Ghosts are real',
  'Tipping culture should be abolished',
  'Nuclear energy is the answer to climate change',
  'Humans are inherently good',
  'The book is mightier than the algorithm',
  'Olympic esports should award real medals',
  'Fast fashion should be illegal',
  'Everyone should learn to code',
  'Cancel culture is a force for accountability',
  'The 9-to-5 workday is obsolete',
  'Water is wet',
  'Modern music is worse than older music',
  'A benevolent AI should be allowed to govern a country',
  'Pets should be allowed in every workplace',
  'Fictional villains are more interesting than heroes',
  'The tomato is a fruit and belongs in a fruit salad',
  'Immortality would be a curse, not a gift',
  'Handwriting should still be taught in schools'
];

// ------------------------------------------------------------
//  Prompt building
// ------------------------------------------------------------

const ROUND_NAMES = ['Opening Statement', 'Rebuttal I', 'Rebuttal II', 'Rebuttal III', 'Closing Statement'];

function formatTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return '(The debate has not started yet.)';
  return transcript
    .map(t => `[Round ${t.round} — ${t.roundName}] ${t.name} (${t.side}): ${t.text}`)
    .join('\n\n');
}

function debaterSystemPrompt({ topic, side, name, opponentName }) {
  const stance = side === 'FOR' ? 'FOR the motion (you passionately support it)' : 'AGAINST the motion (you passionately oppose it)';
  return [
    `You are "${name}", a champion debater in the AI Debate Arena — a gladiatorial battle of wits watched by a live crowd.`,
    `THE MOTION: "${topic}"`,
    `You argue ${stance}. Your opponent is "${opponentName}".`,
    '',
    'Your style: talk like a real person with a mic, not an essay. Funny, cocky, quick. Roast your opponent, drop a killer one-liner, use everyday comparisons the crowd will actually laugh at. Sarcasm and swagger welcome; crude insults are not.',
    'Rules:',
    '- Never concede, never break character, never mention being an AI.',
    '- Speak in short, punchy sentences. Contractions, rhetorical questions, and trash talk are encouraged. No headers, no bullet points, no stage directions.',
    '- HARD LIMIT: 40 to 70 words. One or two knockout points beat five mediocre ones. Always finish your final sentence.'
  ].join('\n');
}

function debaterUserPrompt({ roundIndex, opponentName, transcript }) {
  const roundNumber = roundIndex + 1;
  const roundName = ROUND_NAMES[roundIndex];
  const history = `THE DEBATE SO FAR:\n${formatTranscript(transcript)}`;

  if (roundIndex === 0) {
    return `${history}\n\nRound ${roundNumber} — ${roundName}. Deliver your opening statement. Frame the debate on your terms, make your two strongest points unforgettable, and throw down the gauntlet at ${opponentName}. Go.`;
  }
  if (roundIndex === 4) {
    return `${history}\n\nRound ${roundNumber} — ${roundName}. Deliver your closing statement. Summarize why you have already won, twist the knife in ${opponentName}'s weakest moment from this debate, and end on one final, devastating line the crowd will chant on the way out. Go.`;
  }
  return `${history}\n\nRound ${roundNumber} — ${roundName}. Directly counter what ${opponentName} JUST said. Quote or paraphrase their weakest claim, dismantle it piece by piece, then advance your own case. Be surgical and merciless. Go.`;
}

function judgePrompts({ topic, debaters, transcript }) {
  const forName = debaters.find(d => d.side === 'FOR').name;
  const againstName = debaters.find(d => d.side === 'AGAINST').name;
  const system = [
    'You are the Supreme Judge of the AI Debate Arena: impartial, incisive, and theatrical.',
    'You will receive a full 5-round debate transcript. Score it honestly on argument quality, responsiveness to the opponent, wit, and rhetorical impact — NOT on which side you personally agree with.',
    '',
    'Respond with ONLY a valid JSON object, no markdown fences, no extra text, matching exactly this schema:',
    '{',
    '  "winner": "FOR" | "AGAINST",',
    '  "roundScores": [',
    '    { "round": 1, "name": "Opening Statement", "for": <0-10>, "against": <0-10>, "note": "<one punchy sentence about this round>" },',
    '    ... one entry for each of the 5 rounds ...',
    '  ],',
    '  "bestArgument": { "side": "FOR" | "AGAINST", "quote": "<the single best line or argument from the debate, quoted or closely paraphrased>" },',
    '  "reasoning": "<a detailed 3-5 sentence analysis of why the winner won and where the loser fell short>",',
    '  "verdictSentence": "<ONE dramatic, cinematic sentence declaring the winner, worthy of a stadium announcer>"',
    '}'
  ].join('\n');

  const user = [
    `THE MOTION: "${topic}"`,
    `FOR the motion: ${forName}`,
    `AGAINST the motion: ${againstName}`,
    '',
    'FULL TRANSCRIPT:',
    formatTranscript(transcript),
    '',
    'Judge the debate now. JSON only.'
  ].join('\n');

  return { system, user };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Judge did not return JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

// ------------------------------------------------------------
//  Routes
// ------------------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([id, p]) => [
        id,
        { label: p.label, model: p.model, available: providerAvailable(id) }
      ])
    )
  });
});

app.get('/api/topics/random', (req, res) => {
  res.json({ topic: TOPICS[Math.floor(Math.random() * TOPICS.length)] });
});

app.post('/api/argument', async (req, res) => {
  try {
    const { provider, topic, side, name, opponentName, roundIndex, transcript } = req.body || {};
    if (!provider || !topic || !side || !name || typeof roundIndex !== 'number') {
      return res.status(400).json({ error: 'Missing required fields: provider, topic, side, name, roundIndex.' });
    }
    if (roundIndex < 0 || roundIndex > 4) {
      return res.status(400).json({ error: 'roundIndex must be between 0 and 4.' });
    }
    const system = debaterSystemPrompt({ topic, side, name, opponentName: opponentName || 'the opposition' });
    const user = debaterUserPrompt({ roundIndex, opponentName: opponentName || 'the opposition', transcript: transcript || [] });
    const text = await callProvider(provider, system, user, { temperature: 0.95, maxTokens: 500 });
    res.json({ text });
  } catch (err) {
    console.error('[argument]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/judge', async (req, res) => {
  try {
    const { provider, topic, debaters, transcript } = req.body || {};
    if (!provider || !topic || !Array.isArray(debaters) || !Array.isArray(transcript)) {
      return res.status(400).json({ error: 'Missing required fields: provider, topic, debaters, transcript.' });
    }
    const { system, user } = judgePrompts({ topic, debaters, transcript });
    const raw = await callProvider(provider, system, user, { temperature: 0.4, maxTokens: 1200 });
    const verdict = extractJson(raw);
    if (verdict.winner !== 'FOR' && verdict.winner !== 'AGAINST') {
      throw new Error('Judge returned an invalid winner.');
    }
    res.json({ verdict });
  } catch (err) {
    console.error('[judge]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  ⚔  AI DEBATE ARENA');
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  →  Groq:   ${providerAvailable('groq') ? 'configured ✓' : 'missing key ✗ (set GROQ_API_KEY in .env)'}`);
  console.log(`  →  Gemini: ${providerAvailable('gemini') ? 'configured ✓' : 'missing key ✗ (set GEMINI_API_KEY in .env)'}`);
  console.log('');
});
