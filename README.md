# ⚔ AI Debate Arena

Two AIs battle it out in a 5-round live debate on any topic — Groq vs Gemini, with an AI judge, round-by-round scoring, and a cinematic arena UI.

## How it works

- Pick a topic (or roll a random one from 50+ built-ins), name your debaters, and hit start.
- **Debater One (Blue)** and **Debater Two (Red)** argue FOR and AGAINST across 5 rounds: opening, three rebuttals, and a closing statement.
- A third AI acts as **The Judge**, scoring every round and declaring a winner — or judge it yourself and vote round by round.

## Models

| Role | Provider | Model |
|------|----------|-------|
| Debater | Groq | `llama-3.3-70b-versatile` |
| Debater | Google | `gemini-2.5-flash` |

Both providers have free API tiers.

## Setup

```bash
npm install
cp .env.example .env   # then add your API keys
npm start
```

Get your free keys:
- Groq: https://console.groq.com/keys
- Gemini: https://aistudio.google.com/app/apikey

Then open http://localhost:3000 and let them fight.

## Stack

Plain Node + Express backend (keys stay server-side), vanilla JS frontend, zero build step.
