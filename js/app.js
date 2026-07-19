// ============================================================
//  AI DEBATE ARENA — app.js
//  Bootstraps the app: setup screen wiring, keyboard shortcuts,
//  and orchestration between the engine and the UI.
// ============================================================

(() => {

  const state = {
    config: null,        // /api/config payload
    settings: null,      // last debate settings (for rematch)
    engine: null         // active DebateEngine
  };

  // ----------------------------------------------------------
  //  Init
  // ----------------------------------------------------------

  async function init() {
    UI.initBackground();
    wireSetup();
    wireArena();
    wireVerdict();
    wireKeyboard();
    UI.setReadingSpeed(5);

    try {
      state.config = await API.getConfig();
      applyConfig();
    } catch (err) {
      UI.els.keyBanner.textContent = err.message;
      UI.els.keyBanner.classList.remove('hidden');
    }
  }

  function applyConfig() {
    const providers = state.config.providers;
    const anyAvailable = Object.values(providers).some(p => p.available);
    if (!anyAvailable) UI.els.keyBanner.classList.remove('hidden');

    for (const select of [UI.els.provider1, UI.els.provider2, UI.els.judgeProvider]) {
      for (const option of select.options) {
        const p = providers[option.value];
        if (!p) continue;
        if (!p.available) option.textContent += ' (no key)';
      }
    }

    // Prefer available providers as defaults
    if (!providers.gemini.available && providers.groq.available) {
      UI.els.provider2.value = 'groq';
    }
    if (!providers.groq.available && providers.gemini.available) {
      UI.els.provider1.value = 'gemini';
      UI.els.judgeProvider.value = 'gemini';
    }
    syncModels();
  }

  function modelFor(provider) {
    const p = state.config && state.config.providers[provider];
    return p ? p.model : (provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash');
  }

  function syncModels() {
    UI.els.model1.value = modelFor(UI.els.provider1.value);
    UI.els.model2.value = modelFor(UI.els.provider2.value);
  }

  // ----------------------------------------------------------
  //  Setup screen
  // ----------------------------------------------------------

  function wireSetup() {
    UI.els.provider1.addEventListener('change', syncModels);
    UI.els.provider2.addEventListener('change', syncModels);

    UI.els.btnRandom.addEventListener('click', randomTopic);

    document.querySelectorAll('input[name="judge-type"]').forEach(radio => {
      radio.addEventListener('change', () => {
        UI.els.judgeProviderWrap.classList.toggle('hidden', radio.value !== 'ai' || !radio.checked);
      });
    });

    UI.els.optSpeed.addEventListener('input', () => UI.setReadingSpeed(UI.els.optSpeed.value));

    UI.els.btnStart.addEventListener('click', startDebate);
  }

  async function randomTopic() {
    UI.els.btnRandom.disabled = true;
    try {
      const { topic } = await API.randomTopic();
      UI.els.topicInput.value = topic;
      UI.els.topicInput.animate(
        [{ boxShadow: '0 0 0 3px rgba(245,196,81,0.6)' }, { boxShadow: 'none' }],
        { duration: 700 }
      );
    } catch (err) {
      UI.els.keyBanner.textContent = err.message;
      UI.els.keyBanner.classList.remove('hidden');
    } finally {
      UI.els.btnRandom.disabled = false;
    }
  }

  function readSettings() {
    const judgeType = document.querySelector('input[name="judge-type"]:checked').value;
    return {
      topic: UI.els.topicInput.value.trim(),
      judgeType,
      judgeProvider: UI.els.judgeProvider.value,
      autoAdvance: () => UI.els.arenaAuto.checked,
      debaters: [
        {
          name: (UI.els.name1.value.trim() || 'AXIOM').toUpperCase(),
          provider: UI.els.provider1.value,
          model: modelFor(UI.els.provider1.value),
          side: 'FOR'
        },
        {
          name: (UI.els.name2.value.trim() || 'VESPER').toUpperCase(),
          provider: UI.els.provider2.value,
          model: modelFor(UI.els.provider2.value),
          side: 'AGAINST'
        }
      ]
    };
  }

  async function startDebate() {
    if (!UI.els.topicInput.value.trim()) {
      await randomTopic();
      if (!UI.els.topicInput.value.trim()) return;
    }

    const settings = readSettings();
    if (settings.debaters[0].name === settings.debaters[1].name) {
      settings.debaters[1].name += ' II';
    }

    UI.els.arenaAuto.checked = UI.els.optAuto.checked;
    state.settings = settings;
    runDebate(settings);
  }

  async function runDebate(settings) {
    UI.enterArena(settings);
    const engine = new DebateEngine(settings, UI, API);
    state.engine = engine;

    try {
      const verdict = await engine.run();
      state.engine = null;
      UI.status('');
      UI.showVerdict(verdict, settings);
    } catch (err) {
      state.engine = null;
      if (err.aborted) {
        UI.showScreen('setup');
        return;
      }
      UI.setLive(false);
      UI.status(`The debate collapsed: ${err.message}`, true);
      await UI.waitForContinue('BACK TO SETTINGS');
      UI.showScreen('setup');
    }
  }

  // ----------------------------------------------------------
  //  Arena controls
  // ----------------------------------------------------------

  function wireArena() {
    UI.els.arenaSpeed.addEventListener('input', () => UI.setReadingSpeed(UI.els.arenaSpeed.value));

    UI.els.btnContinue.addEventListener('click', () => UI.resolveContinue());

    UI.els.btnVoteFor.addEventListener('click', () => UI.resolveVote('FOR'));
    UI.els.btnVoteAgainst.addEventListener('click', () => UI.resolveVote('AGAINST'));

    UI.els.btnConcede.addEventListener('click', () => UI.openConcede());
    UI.els.btnConcedeCancel.addEventListener('click', () => UI.closeConcede());
    UI.els.btnConcedeFor.addEventListener('click', () => {
      UI.closeConcede();
      if (state.engine) state.engine.concede('FOR');
    });
    UI.els.btnConcedeAgainst.addEventListener('click', () => {
      UI.closeConcede();
      if (state.engine) state.engine.concede('AGAINST');
    });

    UI.els.btnExit.addEventListener('click', exitToSetup);
  }

  function exitToSetup() {
    if (state.engine) {
      state.engine.abort();
    } else {
      UI.showScreen('setup');
    }
  }

  // ----------------------------------------------------------
  //  Verdict screen
  // ----------------------------------------------------------

  function wireVerdict() {
    UI.els.btnRematch.addEventListener('click', () => {
      if (state.settings) runDebate(state.settings);
    });
    UI.els.btnNewDebate.addEventListener('click', () => UI.showScreen('setup'));
  }

  // ----------------------------------------------------------
  //  Keyboard shortcuts
  //  Space — continue · R — random topic · Esc — settings
  // ----------------------------------------------------------

  function wireKeyboard() {
    document.addEventListener('keydown', e => {
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)
        && document.activeElement.type !== 'checkbox'
        && document.activeElement.type !== 'range';

      if (e.code === 'Space' && !inField) {
        if (UI.currentScreen() === 'arena') {
          e.preventDefault();
          if (UI.hasPendingContinue()) UI.resolveContinue();
          else UI.skipTyping(); // space also fast-forwards the typewriter
        }
      }

      if ((e.key === 'r' || e.key === 'R') && !inField) {
        if (UI.currentScreen() === 'setup') {
          e.preventDefault();
          randomTopic();
        }
      }

      if (e.key === 'Escape') {
        if (!UI.els.concedeOverlay.classList.contains('hidden')) {
          UI.closeConcede();
          return;
        }
        if (UI.currentScreen() === 'arena') exitToSetup();
        else if (UI.currentScreen() === 'verdict') UI.showScreen('setup');
      }
    });
  }

  // ----------------------------------------------------------

  document.addEventListener('DOMContentLoaded', init);
})();
