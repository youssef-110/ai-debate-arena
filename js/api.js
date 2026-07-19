// ============================================================
//  AI DEBATE ARENA — api.js
//  Thin client for the Express backend. No API keys live here;
//  the server holds all provider credentials.
// ============================================================

const API = (() => {

  async function request(path, options = {}) {
    let res;
    try {
      res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
    } catch (err) {
      throw new Error('Cannot reach the arena server. Is `npm start` running?');
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON error body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || `Server error (${res.status}).`);
    }
    return data;
  }

  return {
    /** { providers: { groq: {label, model, available}, gemini: {...} } } */
    getConfig() {
      return request('/api/config');
    },

    /** { topic } */
    randomTopic() {
      return request('/api/topics/random');
    },

    /**
     * Ask a debater for their argument this round.
     * payload: { provider, topic, side, name, opponentName, roundIndex, transcript }
     * → { text }
     */
    argument(payload) {
      return request('/api/argument', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    },

    /**
     * Ask the AI judge to rule on the full debate.
     * payload: { provider, topic, debaters, transcript }
     * → { verdict }
     */
    judge(payload) {
      return request('/api/judge', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  };
})();
