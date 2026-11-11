// ============================================================
//  AI DEBATE ARENA — ui.js
//  All DOM work: screens, typewriter, transitions, voting,
//  particle canvases, and the cinematic verdict takeover.
// ============================================================

const UI = (() => {

  const $ = id => document.getElementById(id);

  const els = {
    screens: {
      setup: $('screen-setup'),
      arena: $('screen-arena'),
      verdict: $('screen-verdict')
    },
    bgCanvas: $('bg-canvas'),
    // setup
    keyBanner: $('key-banner'),
    topicInput: $('topic-input'),
    btnRandom: $('btn-random-topic'),
    name1: $('name-1'), provider1: $('provider-1'), model1: $('model-1'),
    name2: $('name-2'), provider2: $('provider-2'), model2: $('model-2'),
    judgeProviderWrap: $('judge-provider-wrap'),
    judgeProvider: $('judge-provider'),
    optAuto: $('opt-auto'), optSpeed: $('opt-speed'), speedValue: $('speed-value'),
    btnStart: $('btn-start'),
    // arena
    arenaTopic: $('arena-topic-text'),
    roundIndicator: $('round-indicator'),
    arenaAuto: $('arena-auto'), arenaSpeed: $('arena-speed'),
    btnConcede: $('btn-concede'), btnExit: $('btn-exit'),
    panelFor: $('panel-for'), panelAgainst: $('panel-against'),
    feedFor: $('feed-for'), feedAgainst: $('feed-against'),
    arenaName1: $('arena-name-1'), arenaModel1: $('arena-model-1'),
    arenaName2: $('arena-name-2'), arenaModel2: $('arena-model-2'),
    vsDivider: $('vs-divider'),
    statusLine: $('status-line'),
    btnContinue: $('btn-continue'),
    voteBar: $('vote-bar'),
    btnVoteFor: $('btn-vote-for'), btnVoteAgainst: $('btn-vote-against'),
    voteTally: $('vote-tally'),
    // overlays
    roundTransition: $('round-transition'),
    rtNumber: $('rt-number'), rtTitle: $('rt-title'),
    concedeOverlay: $('concede-overlay'),
    btnConcedeFor: $('btn-concede-for'), btnConcedeAgainst: $('btn-concede-against'),
    btnConcedeCancel: $('btn-concede-cancel'),
    // verdict
    verdictCanvas: $('verdict-canvas'),
    verdictWinner: $('verdict-winner'),
    verdictMethod: $('verdict-method'),
    verdictSentence: $('verdict-sentence'),
    verdictScores: $('verdict-scores'),
    verdictBest: $('verdict-best'),
    verdictBestQuote: $('verdict-best-quote'),
    verdictBestAttr: $('verdict-best-attr'),
    verdictReasoning: $('verdict-reasoning'),
    btnRematch: $('btn-rematch'),
    btnNewDebate: $('btn-new-debate')
  };

  const COLORS = { FOR: '#3b82f6', AGAINST: '#ef4444', DRAW: '#a78bfa', GOLD: '#f5c451' };

  // ----------------------------------------------------------
  //  State for interruptible waits
  // ----------------------------------------------------------

  let typeCancelled = false;
  let pendingContinue = null;   // resolve fn
  let pendingVote = null;       // resolve fn
  let readingSpeed = 5;         // 1..10

  function setReadingSpeed(v) {
    readingSpeed = Math.min(10, Math.max(1, Number(v) || 5));
    els.optSpeed.value = readingSpeed;
    els.arenaSpeed.value = readingSpeed;
    els.speedValue.textContent = readingSpeed;
  }
  function charDelay() { return 42 - readingSpeed * 4; } // 38ms .. 2ms

  /** Cancel any in-flight typewriter / pending waits (concede, exit). */
  function interrupt() {
    typeCancelled = true;
    if (pendingContinue) { pendingContinue(null); pendingContinue = null; }
    if (pendingVote) { pendingVote(null); pendingVote = null; }
    els.btnContinue.classList.add('hidden');
    els.voteBar.classList.add('hidden');
  }

  // ----------------------------------------------------------
  //  Screens
  // ----------------------------------------------------------

  function showScreen(name) {
    Object.values(els.screens).forEach(s => s.classList.remove('active'));
    els.screens[name].classList.add('active');
    if (name !== 'verdict') stopVerdictParticles();
    window.scrollTo(0, 0);
  }

  function currentScreen() {
    return Object.keys(els.screens).find(k => els.screens[k].classList.contains('active'));
  }

  // ----------------------------------------------------------
  //  Arena setup / reset
  // ----------------------------------------------------------

  function enterArena(settings) {
    els.arenaTopic.textContent = `“${settings.topic}”`;
    els.arenaName1.textContent = settings.debaters[0].name;
    els.arenaModel1.textContent = `${settings.debaters[0].provider} · ${settings.debaters[0].model}`;
    els.arenaName2.textContent = settings.debaters[1].name;
    els.arenaModel2.textContent = `${settings.debaters[1].provider} · ${settings.debaters[1].model}`;
    els.feedFor.innerHTML = '';
    els.feedAgainst.innerHTML = '';
    els.btnVoteFor.textContent = `🔵 ${settings.debaters[0].name}`;
    els.btnVoteAgainst.textContent = `🔴 ${settings.debaters[1].name}`;
    els.btnConcedeFor.textContent = `🔵 ${settings.debaters[0].name} concedes`;
    els.btnConcedeAgainst.textContent = `🔴 ${settings.debaters[1].name} concedes`;
    els.voteTally.innerHTML = '';
    els.voteBar.classList.add('hidden');
    els.btnContinue.classList.add('hidden');
    setSpeaking(null);
    setLive(true);
    status('');
    typeCancelled = false;
    showScreen('arena');
  }

  function setLive(on) {
    els.vsDivider.classList.toggle('live', on);
  }

  function setRound(n) {
    els.roundIndicator.textContent = `ROUND ${n} / 5`;
  }

  function setSpeaking(side) {
    els.panelFor.classList.toggle('speaking', side === 'FOR');
    els.panelAgainst.classList.toggle('speaking', side === 'AGAINST');
  }

  function status(text, isError = false) {
    els.statusLine.textContent = text;
    els.statusLine.classList.toggle('error', isError);
  }

  // ----------------------------------------------------------
  //  Arguments + typewriter
  // ----------------------------------------------------------

  function feedFor(side) { return side === 'FOR' ? els.feedFor : els.feedAgainst; }

  function addThinking(side, name) {
    const el = document.createElement('div');
    el.className = 'thinking-dots';
    el.textContent = `${name} is composing`;
    feedFor(side).appendChild(el);
    el.scrollIntoView({ block: 'end' });
    return el;
  }

  function addArgument(side, roundLabel) {
    const card = document.createElement('div');
    card.className = 'argument';
    const round = document.createElement('div');
    round.className = 'argument-round';
    round.textContent = roundLabel;
    const text = document.createElement('div');
    text.className = 'argument-text';
    card.appendChild(round);
    card.appendChild(text);
    feedFor(side).appendChild(card);
    card.scrollIntoView({ block: 'end' });
    return text;
  }

  /** Types text char-by-char at the current reading speed. */
  function typewrite(el, text) {
    return new Promise(resolve => {
      typeCancelled = false;
      el.classList.add('typing');
      const feed = el.closest('.feed');
      let i = 0;

      const tick = () => {
        if (typeCancelled) {
          el.textContent = text;
          el.classList.remove('typing');
          resolve();
          return;
        }
        i += 1;
        el.textContent = text.slice(0, i);
        if (feed) feed.scrollTop = feed.scrollHeight;
        if (i >= text.length) {
          el.classList.remove('typing');
          resolve();
        } else {
          setTimeout(tick, charDelay());
        }
      };
      tick();
    });
  }

  function skipTyping() { typeCancelled = true; }

  // ----------------------------------------------------------
  //  Round transition
  // ----------------------------------------------------------

  function roundTransition(number, title) {
    return new Promise(resolve => {
      els.rtNumber.textContent = `— ROUND ${number} OF 5 —`;
      els.rtTitle.textContent = title;
      els.roundTransition.classList.remove('hidden', 'leaving');
      setTimeout(() => {
        els.roundTransition.classList.add('leaving');
        setTimeout(() => {
          els.roundTransition.classList.add('hidden');
          els.roundTransition.classList.remove('leaving');
          resolve();
        }, 360);
      }, 1650);
    });
  }

  // ----------------------------------------------------------
  //  Continue / voting
  // ----------------------------------------------------------

  /** Resolves when the user presses Continue (or Space). */
  function waitForContinue(label = 'CONTINUE') {
    return new Promise(resolve => {
      pendingContinue = resolve;
      els.btnContinue.innerHTML = `${label} &nbsp;<kbd>Space</kbd>`;
      els.btnContinue.classList.remove('hidden');
    });
  }

  function resolveContinue() {
    if (pendingContinue) {
      const r = pendingContinue;
      pendingContinue = null;
      els.btnContinue.classList.add('hidden');
      r(true);
    }
  }

  function hasPendingContinue() { return Boolean(pendingContinue); }

  /** Shows vote buttons; resolves 'FOR' | 'AGAINST' (or null if interrupted). */
  function collectVote() {
    return new Promise(resolve => {
      pendingVote = resolve;
      els.voteBar.classList.remove('hidden');
    });
  }

  function resolveVote(side) {
    if (pendingVote) {
      const r = pendingVote;
      pendingVote = null;
      els.voteBar.classList.add('hidden');
      r(side);
    }
  }

  /** votes: array of 'FOR'|'AGAINST'; renders 5 round dots. */
  function renderTally(votes) {
    els.voteTally.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('span');
      const v = votes[i];
      if (v === 'FOR') { dot.className = 'dot-for'; dot.textContent = '●'; }
      else if (v === 'AGAINST') { dot.className = 'dot-against'; dot.textContent = '●'; }
      else { dot.className = 'dot-empty'; dot.textContent = '○'; }
      els.voteTally.appendChild(dot);
    }
  }

  // ----------------------------------------------------------
  //  Concede overlay
  // ----------------------------------------------------------

  function openConcede() { els.concedeOverlay.classList.remove('hidden'); }
  function closeConcede() { els.concedeOverlay.classList.add('hidden'); }

  // ----------------------------------------------------------
  //  Verdict screen — cinematic takeover
  // ----------------------------------------------------------

  function showVerdict(verdict, settings) {
    const winnerDebater =
      verdict.winner === 'DRAW' ? null :
      settings.debaters.find(d => d.side === verdict.winner);

    els.verdictWinner.textContent = winnerDebater ? winnerDebater.name : 'DEAD HEAT';
    els.verdictWinner.className = 'verdict-winner ' +
      (verdict.winner === 'FOR' ? 'win-for' : verdict.winner === 'AGAINST' ? 'win-against' : 'win-draw');

    const methodLabel = {
      ai: 'BY DECISION OF THE AI JUDGE',
      crowd: 'BY VOTE OF THE CROWD',
      concession: 'VICTORY BY CONCESSION'
    }[verdict.method] || '';
    els.verdictMethod.textContent = winnerDebater
      ? `${methodLabel} · ${winnerDebater.provider} · ${winnerDebater.model}`
      : methodLabel;

    els.verdictSentence.textContent = verdict.verdictSentence || '';

    renderScores(verdict, settings);

    if (verdict.bestArgument && verdict.bestArgument.quote) {
      const bestDebater = settings.debaters.find(d => d.side === verdict.bestArgument.side);
      els.verdictBestQuote.textContent = `“${verdict.bestArgument.quote}”`;
      els.verdictBestAttr.textContent = bestDebater
        ? `— ${bestDebater.name} · ${bestDebater.side} THE MOTION`
        : '';
      els.verdictBest.classList.remove('hidden');
    } else {
      els.verdictBest.classList.add('hidden');
    }

    els.verdictReasoning.textContent = verdict.reasoning || '';

    showScreen('verdict');
    startVerdictParticles(
      verdict.winner === 'DRAW'
        ? COLORS.DRAW
        : COLORS[verdict.winner]
    );
  }

  function renderScores(verdict, settings) {
    els.verdictScores.innerHTML = '';
    const rows = verdict.roundScores || [];
    let totalFor = 0;
    let totalAgainst = 0;

    rows.forEach((r, i) => {
      totalFor += r.for;
      totalAgainst += r.against;
      const row = document.createElement('div');
      row.className = 'score-row';
      row.style.animationDelay = `${1.0 + i * 0.18}s`;

      const chip = r.for > r.against ? 'for' : r.against > r.for ? 'against' : 'tie';
      const chipText = chip === 'for'
        ? settings.debaters[0].name
        : chip === 'against'
          ? settings.debaters[1].name
          : 'EVEN';

      row.innerHTML = `
        <div class="score-round">
          <span class="score-round-name">R${r.round} · ${escapeHtml(r.name || '')}</span>
          ${r.note ? `<span class="score-round-note">${escapeHtml(r.note)}</span>` : ''}
        </div>
        <div class="score-nums"><span class="s-for">${r.for}</span><span class="s-sep">—</span><span class="s-against">${r.against}</span></div>
        <span class="score-winner-chip ${chip}">${escapeHtml(chipText)}</span>
      `;
      els.verdictScores.appendChild(row);
    });

    if (rows.length) {
      const total = document.createElement('div');
      total.className = 'score-row score-total';
      total.style.animationDelay = `${1.0 + rows.length * 0.18 + 0.2}s`;
      total.innerHTML = `
        <div class="score-round"><span class="score-round-name">FINAL SCORE</span></div>
        <div class="score-nums"><span class="s-for">${totalFor}</span><span class="s-sep">—</span><span class="s-against">${totalAgainst}</span></div>
        <span class="score-winner-chip ${totalFor > totalAgainst ? 'for' : totalAgainst > totalFor ? 'against' : 'tie'}">TOTAL</span>
      `;
      els.verdictScores.appendChild(total);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ----------------------------------------------------------
  //  Background particles — drifting embers, blue left / red right
  // ----------------------------------------------------------

  function initBackground() {
    const canvas = els.bgCanvas;
    const ctx = canvas.getContext('2d');
    let w, h, particles;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      const count = Math.min(110, Math.floor((w * h) / 16000));
      particles = Array.from({ length: count }, () => spawn());
    }

    function spawn() {
      const x = Math.random() * w;
      return {
        x,
        y: Math.random() * h,
        r: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -(Math.random() * 0.3 + 0.06),
        a: Math.random() * 0.5 + 0.12,
        hue: x < w / 2 ? 217 : 0 // blue left, red right
      };
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -6 || p.x < -6 || p.x > w + 6) Object.assign(p, spawn(), { y: h + 6 });
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 85%, 62%, ${p.a})`;
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }

    window.addEventListener('resize', resize);
    resize();
    frame();
  }

  // ----------------------------------------------------------
  //  Verdict particles — explosion in the winner's color
  // ----------------------------------------------------------

  let verdictRaf = null;

  function startVerdictParticles(color) {
    stopVerdictParticles();
    const canvas = els.verdictCanvas;
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const parts = [];
    const start = performance.now();

    function burst(cx, cy, n, power) {
      for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (Math.random() ** 0.5) * power;
        parts.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          r: Math.random() * 3 + 1,
          life: 1,
          decay: Math.random() * 0.012 + 0.006,
          color: Math.random() < 0.22 ? '#f5c451' : color
        });
      }
    }

    // opening salvo
    burst(w / 2, h * 0.32, 160, 11);
    setTimeout(() => burst(w * 0.28, h * 0.4, 90, 9), 350);
    setTimeout(() => burst(w * 0.72, h * 0.4, 90, 9), 650);
    setTimeout(() => burst(w / 2, h * 0.3, 120, 10), 1100);

    function frame(now) {
      ctx.clearRect(0, 0, w, h);
      const elapsed = now - start;

      // gentle ember rain after the explosions
      if (elapsed > 1800 && elapsed < 12000 && Math.random() < 0.25) {
        parts.push({
          x: Math.random() * w, y: -8,
          vx: (Math.random() - 0.5) * 0.4,
          vy: Math.random() * 1.2 + 0.4,
          r: Math.random() * 2 + 0.6,
          life: 1, decay: 0.004,
          color: Math.random() < 0.3 ? '#f5c451' : color
        });
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += 0.06;       // gravity
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0 || p.y > h + 20) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      verdictRaf = requestAnimationFrame(frame);
    }
    verdictRaf = requestAnimationFrame(frame);

    verdictCleanup = () => {
      window.removeEventListener('resize', onResize);
      ctx.clearRect(0, 0, w, h);
    };
  }

  let verdictCleanup = null;

  function stopVerdictParticles() {
    if (verdictRaf) { cancelAnimationFrame(verdictRaf); verdictRaf = null; }
    if (verdictCleanup) { verdictCleanup(); verdictCleanup = null; }
  }

  // ----------------------------------------------------------

  return {
    els,
    showScreen,
    currentScreen,
    enterArena,
    setLive,
    setRound,
    setSpeaking,
    status,
    addThinking,
    addArgument,
    typewrite,
    skipTyping,
    roundTransition,
    waitForContinue,
    resolveContinue,
    hasPendingContinue,
    collectVote,
    resolveVote,
    renderTally,
    openConcede,
    closeConcede,
    showVerdict,
    initBackground,
    setReadingSpeed,
    interrupt
  };
})();
