// ============================================================
//  AI DEBATE ARENA — debate.js
//  The debate engine: 5 rounds, turn order, transcript,
//  judging (AI or crowd), and concessions.
// ============================================================

const ROUNDS = [
  { name: 'Opening Statement', title: 'OPENING STATEMENTS' },
  { name: 'Rebuttal I', title: 'FIRST REBUTTAL' },
  { name: 'Rebuttal II', title: 'SECOND REBUTTAL' },
  { name: 'Rebuttal III', title: 'FINAL REBUTTAL' },
  { name: 'Closing Statement', title: 'CLOSING STATEMENTS' }
];

class AbortedError extends Error {
  constructor() { super('Debate aborted.'); this.aborted = true; }
}

class DebateEngine {
  /**
   * settings: {
   *   topic, judgeType: 'ai'|'user', judgeProvider,
   *   autoAdvance: () => bool,
   *   debaters: [ {name, provider, model, side:'FOR'}, {..., side:'AGAINST'} ]
   * }
   */
  constructor(settings, ui, api) {
    this.settings = settings;
    this.ui = ui;
    this.api = api;
    this.transcript = [];
    this.votes = [];
    this.concededBy = null;
    this.aborted = false;
  }

  abort() {
    this.aborted = true;
    this.ui.interrupt();
  }

  concede(side) {
    this.concededBy = side;
    this.ui.interrupt();
  }

  checkFlow() {
    if (this.aborted) throw new AbortedError();
    return !this.concededBy;
  }

  async run() {
    const { settings, ui } = this;

    for (let r = 0; r < ROUNDS.length; r++) {
      if (!this.checkFlow()) break;

      ui.setRound(r + 1);
      await ui.roundTransition(r + 1, ROUNDS[r].title);
      if (!this.checkFlow()) break;

      // FOR speaks first, AGAINST answers.
      for (const debater of settings.debaters) {
        const spoke = await this.speak(debater, r);
        if (!spoke) break;
      }
      if (!this.checkFlow()) break;

      ui.setSpeaking(null);

      // Crowd voting after every round
      if (settings.judgeType === 'user') {
        ui.status(`Round ${r + 1} complete — cast your vote.`);
        const vote = await ui.collectVote();
        if (!this.checkFlow()) break;
        if (vote) {
          this.votes.push(vote);
          ui.renderTally(this.votes);
        }
      }

      // Advance to next round
      if (r < ROUNDS.length - 1) {
        if (settings.autoAdvance()) {
          ui.status('Next round incoming…');
          await this.delay(1400);
        } else {
          ui.status('');
          await ui.waitForContinue(`ROUND ${r + 2}`);
        }
        if (!this.checkFlow()) break;
      }
    }

    if (this.aborted) throw new AbortedError();

    ui.setLive(false);
    ui.setSpeaking(null);

    if (this.concededBy) return this.concessionVerdict();
    return this.finalVerdict();
  }

  async speak(debater, roundIndex) {
    const { settings, ui } = this;
    if (!this.checkFlow()) return false;

    const opponent = settings.debaters.find(d => d !== debater);
    ui.setSpeaking(debater.side);
    ui.status(`${debater.name} is thinking…`);
    const thinking = ui.addThinking(debater.side, debater.name);

    let text;
    try {
      const res = await this.api.argument({
        provider: debater.provider,
        topic: settings.topic,
        side: debater.side,
        name: debater.name,
        opponentName: opponent.name,
        roundIndex,
        transcript: this.transcript
      });
      text = res.text;
    } catch (err) {
      thinking.remove();
      if (this.aborted) throw new AbortedError();
      ui.status(`${debater.name} lost their voice: ${err.message}`, true);
      throw err;
    }

    thinking.remove();
    if (!this.checkFlow()) return false;

    this.transcript.push({
      round: roundIndex + 1,
      roundName: ROUNDS[roundIndex].name,
      name: debater.name,
      side: debater.side,
      text
    });

    ui.status(`${debater.name} has the floor — ${ROUNDS[roundIndex].name}`);
    const el = ui.addArgument(debater.side, `Round ${roundIndex + 1} · ${ROUNDS[roundIndex].name}`);
    await ui.typewrite(el, text);
    return this.checkFlow();
  }

  // ----------------------------------------------------------
  //  Verdicts
  // ----------------------------------------------------------

  async finalVerdict() {
    return this.settings.judgeType === 'user'
      ? this.crowdVerdict()
      : this.aiVerdict();
  }

  async aiVerdict() {
    const { settings, ui } = this;
    ui.status('The judge is deliberating…');
    const { verdict } = await this.api.judge({
      provider: settings.judgeProvider,
      topic: settings.topic,
      debaters: settings.debaters.map(d => ({ name: d.name, side: d.side })),
      transcript: this.transcript
    });

    return {
      winner: verdict.winner,
      method: 'ai',
      roundScores: (verdict.roundScores || []).slice(0, 5).map((r, i) => ({
        round: r.round || i + 1,
        name: r.name || ROUNDS[i].name,
        for: this.clampScore(r.for),
        against: this.clampScore(r.against),
        note: r.note || ''
      })),
      bestArgument: verdict.bestArgument || null,
      reasoning: verdict.reasoning || '',
      verdictSentence: verdict.verdictSentence || this.fallbackSentence(verdict.winner)
    };
  }

  crowdVerdict() {
    const { settings } = this;
    const forVotes = this.votes.filter(v => v === 'FOR').length;
    const againstVotes = this.votes.filter(v => v === 'AGAINST').length;
    const winner = forVotes > againstVotes ? 'FOR' : againstVotes > forVotes ? 'AGAINST' : 'DRAW';

    const roundScores = this.votes.map((v, i) => ({
      round: i + 1,
      name: ROUNDS[i].name,
      for: v === 'FOR' ? 1 : 0,
      against: v === 'AGAINST' ? 1 : 0,
      note: `The crowd gave this round to ${v === 'FOR' ? settings.debaters[0].name : settings.debaters[1].name}.`
    }));

    return {
      winner,
      method: 'crowd',
      roundScores,
      bestArgument: this.pickBestArgument(winner),
      reasoning: winner === 'DRAW'
        ? 'The crowd split its verdict straight down the middle. Neither side could land the killing blow — the arena falls silent, unsatisfied and thrilled.'
        : `The crowd has spoken: ${forVotes}–${againstVotes} across the rounds. Applause decides what logic could not.`,
      verdictSentence: this.fallbackSentence(winner)
    };
  }

  concessionVerdict() {
    const { settings } = this;
    const loser = settings.debaters.find(d => d.side === this.concededBy);
    const winner = settings.debaters.find(d => d.side !== this.concededBy);

    return {
      winner: winner.side,
      method: 'concession',
      roundScores: [],
      bestArgument: this.pickBestArgument(winner.side),
      reasoning: `${loser.name} threw in the towel mid-battle. In the arena, a white flag speaks louder than any rebuttal.`,
      verdictSentence: `${winner.name} stands victorious as ${loser.name} concedes the arena!`
    };
  }

  pickBestArgument(winnerSide) {
    const side = winnerSide === 'DRAW' ? 'FOR' : winnerSide;
    const speeches = this.transcript.filter(t => t.side === side);
    if (!speeches.length) return null;
    const best = speeches[speeches.length - 1]; // their latest, most refined blow
    const quote = best.text.length > 220 ? best.text.slice(0, 217).trimEnd() + '…' : best.text;
    return { side, quote };
  }

  fallbackSentence(winnerSide) {
    if (winnerSide === 'DRAW') {
      return 'The arena holds its breath — tonight, there is no victor, only two warriors still standing.';
    }
    const w = this.settings.debaters.find(d => d.side === winnerSide);
    return `By force of wit and fury of argument, ${w.name} conquers the arena!`;
  }

  clampScore(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 5;
    return Math.min(10, Math.max(0, Math.round(n)));
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
