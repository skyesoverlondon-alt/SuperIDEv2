const SUITS = ["S", "H", "D", "C"];
const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SEAT_NAMES = ["South", "West", "North", "East"];
const TEAM_SEATS = [[0, 2], [1, 3]];
const WIN_SCORE = 150;
const STORAGE_KEY = "skyeace-progress-v1";

const LEVELS = [
  {
    id: 1,
    name: "Level 1 · Street Table",
    blurb: "Loose reads, softer defense, perfect for learning the rhythm.",
    difficulty: 0.28,
    hp: 60,
    enemyName: "Street Table"
  },
  {
    id: 2,
    name: "Level 2 · Gold Smoke",
    blurb: "Sharper bids, cleaner trick steals, less forgiving nonsense.",
    difficulty: 0.48,
    hp: 70,
    enemyName: "Gold Smoke"
  },
  {
    id: 3,
    name: "Level 3 · Night Crown",
    blurb: "These bots start counting like they pay rent here.",
    difficulty: 0.68,
    hp: 80,
    enemyName: "Night Crown"
  },
  {
    id: 4,
    name: "Level 4 · Sovereign Rift",
    blurb: "The mean table. Nil pressure. Trump traps. Ugly business.",
    difficulty: 0.88,
    hp: 95,
    enemyName: "Sovereign Rift"
  }
];

const ui = {
  modeBadge: document.getElementById("modeBadge"),
  levelName: document.getElementById("levelName"),
  levelBlurb: document.getElementById("levelBlurb"),
  unlockBadge: document.getElementById("unlockBadge"),
  levelButtons: document.getElementById("levelButtons"),
  newGameBtn: document.getElementById("newGameBtn"),
  rulesBtn: document.getElementById("rulesBtn"),
  closeRulesBtn: document.getElementById("closeRulesBtn"),
  rulesDialog: document.getElementById("rulesDialog"),
  modeAiBtn: document.getElementById("modeAiBtn"),
  modePvpBtn: document.getElementById("modePvpBtn"),
  phaseLabel: document.getElementById("phaseLabel"),
  handNumber: document.getElementById("handNumber"),
  trickNumber: document.getElementById("trickNumber"),
  leaderName: document.getElementById("leaderName"),
  turnBanner: document.getElementById("turnBanner"),
  trickLeadInfo: document.getElementById("trickLeadInfo"),
  messageBox: document.getElementById("messageBox"),
  bidPanel: document.getElementById("bidPanel"),
  bidPrompt: document.getElementById("bidPrompt"),
  bidSelect: document.getElementById("bidSelect"),
  confirmBidBtn: document.getElementById("confirmBidBtn"),
  handPanel: document.getElementById("handPanel"),
  activeHandLabel: document.getElementById("activeHandLabel"),
  handHint: document.getElementById("handHint"),
  handCards: document.getElementById("handCards"),
  passOverlay: document.getElementById("passOverlay"),
  passTitle: document.getElementById("passTitle"),
  passText: document.getElementById("passText"),
  passContinueBtn: document.getElementById("passContinueBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  logBox: document.getElementById("logBox"),
  team0HpBar: document.getElementById("team0HpBar"),
  team1HpBar: document.getElementById("team1HpBar"),
  team0HpText: document.getElementById("team0HpText"),
  team1HpText: document.getElementById("team1HpText"),
  team0Score: document.getElementById("team0Score"),
  team1Score: document.getElementById("team1Score"),
  team0Bags: document.getElementById("team0Bags"),
  team1Bags: document.getElementById("team1Bags"),
  team0Bid: document.getElementById("team0Bid"),
  team1Bid: document.getElementById("team1Bid"),
  team0Tricks: document.getElementById("team0Tricks"),
  team1Tricks: document.getElementById("team1Tricks"),
  bidSeat0: document.getElementById("bidSeat0"),
  bidSeat1: document.getElementById("bidSeat1"),
  bidSeat2: document.getElementById("bidSeat2"),
  bidSeat3: document.getElementById("bidSeat3"),
  tricksSeat0: document.getElementById("tricksSeat0"),
  tricksSeat1: document.getElementById("tricksSeat1"),
  tricksSeat2: document.getElementById("tricksSeat2"),
  tricksSeat3: document.getElementById("tricksSeat3"),
  play0: document.getElementById("play0"),
  play1: document.getElementById("play1"),
  play2: document.getElementById("play2"),
  play3: document.getElementById("play3"),
  seatRole0: document.getElementById("seatRole0"),
  seatRole1: document.getElementById("seatRole1"),
  seatRole2: document.getElementById("seatRole2"),
  seatRole3: document.getElementById("seatRole3")
};

let state = {
  mode: "ai",
  selectedLevel: 1,
  unlockedLevel: 1,
  game: null,
  pendingHumanAction: null,
  passGate: null,
  busy: false
};

for (let i = 0; i <= 13; i += 1) {
  const option = document.createElement("option");
  option.value = String(i);
  option.textContent = i === 0 ? "0 (Nil)" : String(i);
  ui.bidSelect.appendChild(option);
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.unlockedLevel = Math.max(1, Math.min(LEVELS.length, Number(parsed.unlockedLevel) || 1));
  } catch {
    state.unlockedLevel = 1;
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ unlockedLevel: state.unlockedLevel }));
}

function createDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `c${id++}`, suit, rank });
    }
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sortHand(hand) {
  const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
  return [...hand].sort((a, b) => {
    if (suitOrder[a.suit] !== suitOrder[b.suit]) return suitOrder[a.suit] - suitOrder[b.suit];
    return b.rank - a.rank;
  });
}

function rankLabel(rank) {
  if (rank === 14) return "A";
  if (rank === 13) return "K";
  if (rank === 12) return "Q";
  if (rank === 11) return "J";
  return String(rank);
}

function cardLabel(card) {
  return `${rankLabel(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

function cardPower(card) {
  return card.rank + (card.suit === "S" ? 0.35 : 0);
}

function teamOfSeat(seat) {
  return seat % 2 === 0 ? 0 : 1;
}

function partnerOf(seat) {
  return (seat + 2) % 4;
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function makeFreshGame() {
  const level = LEVELS.find((item) => item.id === state.selectedLevel) || LEVELS[0];
  return {
    level,
    winner: null,
    handNumber: 0,
    startingLeader: 0,
    phase: "idle",
    players: SEAT_NAMES.map((name, seat) => ({
      seat,
      name,
      hand: [],
      bid: null,
      tricks: 0,
      human: isHumanSeat(seat),
      ai: !isHumanSeat(seat)
    })),
    teams: [
      { score: 0, bags: 0, hp: level.hp },
      { score: 0, bags: 0, hp: level.hp }
    ],
    currentTurn: 0,
    trickLeader: 0,
    currentTrick: [],
    trickCount: 0,
    spadesBroken: false,
    journal: []
  };
}

function isHumanSeat(seat) {
  if (state.mode === "ai") return seat === 0;
  return seat === 0 || seat === 3;
}

function syncHumanRoles(game) {
  game.players.forEach((player) => {
    player.human = isHumanSeat(player.seat);
    player.ai = !player.human;
  });
}

function addLog(text, important = false) {
  const stamp = state.game ? `H${state.game.handNumber}` : "Log";
  const line = important ? `⚔️ ${text}` : text;
  if (state.game) {
    state.game.journal.unshift(`${stamp} · ${line}`);
    state.game.journal = state.game.journal.slice(0, 80);
  }
  renderLog();
}

function renderLog() {
  const lines = state.game?.journal ?? [];
  ui.logBox.innerHTML = "";
  if (!lines.length) {
    const empty = document.createElement("div");
    empty.className = "log-line";
    empty.textContent = "Battle journal is quiet. Start a hand and make some noise.";
    ui.logBox.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const node = document.createElement("div");
    node.className = "log-line";
    node.textContent = line;
    ui.logBox.appendChild(node);
  }
}

function updateHeader() {
  const level = LEVELS.find((item) => item.id === state.selectedLevel) || LEVELS[0];
  ui.levelName.textContent = level.name;
  ui.levelBlurb.textContent = level.blurb;
  ui.modeBadge.textContent = state.mode === "ai" ? "AI Battle" : "Couch PvP";
  ui.unlockBadge.textContent = `Unlocked: ${state.unlockedLevel}`;
}

function renderLevelButtons() {
  ui.levelButtons.innerHTML = "";
  LEVELS.forEach((level) => {
    const btn = document.createElement("button");
    btn.className = `level-btn ${state.selectedLevel === level.id ? "active" : ""}`;
    btn.disabled = level.id > state.unlockedLevel;
    btn.innerHTML = `<strong>${level.name}</strong><br><span class="muted small">${level.blurb}</span>`;
    btn.addEventListener("click", () => {
      state.selectedLevel = level.id;
      updateHeader();
      renderLevelButtons();
      if (state.game) {
        state.game.level = level;
      }
    });
    ui.levelButtons.appendChild(btn);
  });
}

function describeSeatRole(seat) {
  if (seat === 0) return state.mode === "ai" ? "You" : "South Player";
  if (seat === 3 && state.mode === "pvp") return "East Player";
  return "AI";
}

function renderScoreboard() {
  const game = state.game;
  if (!game) return;
  const teamBids = [0, 1].map((team) => TEAM_SEATS[team].reduce((sum, seat) => sum + Math.max(0, game.players[seat].bid || 0), 0));
  const teamTricks = [0, 1].map((team) => TEAM_SEATS[team].reduce((sum, seat) => sum + game.players[seat].tricks, 0));

  ui.team0Score.textContent = game.teams[0].score;
  ui.team1Score.textContent = game.teams[1].score;
  ui.team0Bags.textContent = game.teams[0].bags;
  ui.team1Bags.textContent = game.teams[1].bags;
  ui.team0Bid.textContent = teamBids[0];
  ui.team1Bid.textContent = teamBids[1];
  ui.team0Tricks.textContent = teamTricks[0];
  ui.team1Tricks.textContent = teamTricks[1];

  const maxHp = game.level.hp;
  ui.team0HpText.textContent = game.teams[0].hp;
  ui.team1HpText.textContent = game.teams[1].hp;
  ui.team0HpBar.style.width = `${Math.max(0, (game.teams[0].hp / maxHp) * 100)}%`;
  ui.team1HpBar.style.width = `${Math.max(0, (game.teams[1].hp / maxHp) * 100)}%`;

  game.players.forEach((player) => {
    ui[`bidSeat${player.seat}`].textContent = `Bid: ${player.bid ?? "—"}`;
    ui[`tricksSeat${player.seat}`].textContent = `Tricks: ${player.tricks}`;
    ui[`seatRole${player.seat}`].textContent = describeSeatRole(player.seat);
  });
}

function renderCenter() {
  const game = state.game;
  if (!game) {
    ui.phaseLabel.textContent = "Choose a mode to start";
    ui.handNumber.textContent = "0";
    ui.trickNumber.textContent = "0";
    ui.leaderName.textContent = "—";
    ui.turnBanner.textContent = "Ready";
    ui.trickLeadInfo.textContent = "Spades sleeping.";
    return;
  }
  ui.handNumber.textContent = String(game.handNumber);
  ui.trickNumber.textContent = String(game.trickCount);
  ui.leaderName.textContent = SEAT_NAMES[game.trickLeader] || "—";

  const phaseText = {
    bidding: "Bidding Phase",
    playing: "Battle Phase",
    resolved: "Round Resolved",
    gameover: "Battle Finished",
    idle: "Ready"
  };
  ui.phaseLabel.textContent = phaseText[game.phase] || "Ready";

  if (game.phase === "bidding") {
    ui.turnBanner.textContent = `${SEAT_NAMES[game.currentTurn]} is choosing a bid`;
  } else if (game.phase === "playing") {
    ui.turnBanner.textContent = `${SEAT_NAMES[game.currentTurn]} to play`;
  } else if (game.phase === "gameover") {
    ui.turnBanner.textContent = game.winner === 0 ? "South/North Win" : "West/East Win";
  } else {
    ui.turnBanner.textContent = "Ready";
  }
  ui.trickLeadInfo.textContent = game.spadesBroken ? "Spades are live." : "Spades sleeping.";
}

function renderPlayedCards() {
  const game = state.game;
  [0, 1, 2, 3].forEach((seat) => {
    const node = ui[`play${seat}`];
    if (!game) {
      node.className = "played-card placeholder-card";
      node.textContent = "?";
      return;
    }
    const entry = game.currentTrick.find((item) => item.seat === seat);
    if (!entry) {
      node.className = "played-card placeholder-card";
      node.textContent = "?";
      return;
    }
    node.className = `played-card ${entry.card.suit === "H" || entry.card.suit === "D" ? "red" : ""}`;
    node.textContent = cardLabel(entry.card);
  });
}

function renderHand() {
  ui.handCards.innerHTML = "";
  const game = state.game;
  if (!game) {
    ui.activeHandLabel.textContent = "Your Hand";
    ui.handHint.textContent = "Start a battle to deal cards.";
    return;
  }

  if (state.mode === "pvp" && !state.passGate && !game.players[game.currentTurn]?.human && game.phase !== "gameover") {
    ui.activeHandLabel.textContent = "Hands Hidden";
    ui.handHint.textContent = "AI turns are running. Human hands stay hidden so nobody gets free sauce.";
    return;
  }

  const seat = activeVisibleSeat();
  const player = game.players[seat];
  if (!player) return;

  ui.activeHandLabel.textContent = `${SEAT_NAMES[seat]} Hand`;
  if (game.phase === "bidding") {
    ui.handHint.textContent = player.human ? "Study your hand and choose your bid." : "AI is thinking.";
  } else if (game.phase === "playing") {
    ui.handHint.textContent = player.human
      ? "Playable cards glow. Follow suit unless you like being denied by physics."
      : `${SEAT_NAMES[seat]} is waiting.`;
  } else {
    ui.handHint.textContent = "Round is being resolved.";
  }

  const legalIds = new Set(player.human && game.phase === "playing" && game.currentTurn === seat
    ? getLegalCards(game, seat).map((card) => card.id)
    : []);

  player.hand.forEach((card) => {
    const btn = document.createElement("button");
    const playable = legalIds.has(card.id);
    btn.className = `card ${card.suit === "H" || card.suit === "D" ? "red" : ""} ${playable ? "playable" : "disabled"} ${card.suit === "S" ? "trump" : ""}`;
    btn.disabled = !(player.human && game.phase === "playing" && game.currentTurn === seat && playable && !state.passGate);
    btn.innerHTML = `
      <div class="card-corner"><span class="card-rank">${rankLabel(card.rank)}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span></div>
      <div class="card-center">${SUIT_SYMBOLS[card.suit]}</div>
      <div class="card-corner"><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span><span class="card-rank">${rankLabel(card.rank)}</span></div>
    `;
    btn.addEventListener("click", () => {
      if (!btn.disabled) {
        handleHumanPlay(card.id);
      }
    });
    ui.handCards.appendChild(btn);
  });
}

function activeVisibleSeat() {
  if (!state.game) return 0;
  if (state.mode === "ai") return 0;
  if (state.passGate && typeof state.passGate.seat === "number") return state.passGate.seat;
  if (state.game.players[state.game.currentTurn]?.human) return state.game.currentTurn;
  return 0;
}

function renderMessage(text) {
  ui.messageBox.textContent = text;
}

function showPassOverlay(seat) {
  state.passGate = { seat };
  ui.passTitle.textContent = `Pass to ${SEAT_NAMES[seat]}`;
  ui.passText.textContent = `${SEAT_NAMES[seat]} is up. Let them see only their hand, not your spicy nonsense.`;
  ui.passOverlay.classList.remove("hidden");
  renderHand();
}

function hidePassOverlay() {
  state.passGate = null;
  ui.passOverlay.classList.add("hidden");
  renderHand();
}

function renderBidPanel() {
  const game = state.game;
  if (!game || game.phase !== "bidding") {
    ui.bidPanel.classList.add("hidden");
    return;
  }
  const current = game.players[game.currentTurn];
  if (current.human && !state.passGate) {
    ui.bidPanel.classList.remove("hidden");
    ui.bidPrompt.textContent = `${SEAT_NAMES[current.seat]} — choose your bid`;
  } else {
    ui.bidPanel.classList.add("hidden");
  }
}

function renderAll() {
  updateHeader();
  renderLevelButtons();
  renderScoreboard();
  renderCenter();
  renderPlayedCards();
  renderBidPanel();
  renderHand();
  renderLog();
}

function getLegalCards(game, seat) {
  const hand = game.players[seat].hand;
  if (!game.currentTrick.length) {
    const nonSpades = hand.filter((card) => card.suit !== "S");
    if (!game.spadesBroken && nonSpades.length) return nonSpades;
    return hand;
  }
  const leadSuit = game.currentTrick[0].card.suit;
  const follow = hand.filter((card) => card.suit === leadSuit);
  return follow.length ? follow : hand;
}

function winnerOfTrick(trick) {
  const leadSuit = trick[0].card.suit;
  let best = trick[0];
  for (const entry of trick.slice(1)) {
    const current = entry.card;
    const bestCard = best.card;
    const currentTrump = current.suit === "S";
    const bestTrump = bestCard.suit === "S";
    if (currentTrump && !bestTrump) {
      best = entry;
      continue;
    }
    if (currentTrump === bestTrump) {
      const currentFollowsLead = current.suit === leadSuit;
      const bestFollowsLead = bestCard.suit === leadSuit;
      if ((currentTrump || (currentFollowsLead && bestFollowsLead)) && current.rank > bestCard.rank) {
        best = entry;
      }
    }
  }
  return best.seat;
}

function estimateBid(hand, difficulty) {
  const bySuit = { S: [], H: [], D: [], C: [] };
  hand.forEach((card) => bySuit[card.suit].push(card));
  Object.values(bySuit).forEach((cards) => cards.sort((a, b) => b.rank - a.rank));

  const spades = bySuit.S;
  const aces = hand.filter((card) => card.rank === 14).length;
  const kings = hand.filter((card) => card.rank === 13 && bySuit[card.suit].length >= 2).length;
  const queens = hand.filter((card) => card.rank === 12 && bySuit[card.suit].length >= 3).length;
  const highSpades = spades.filter((card) => card.rank >= 11).length;
  const longSuits = ["H", "D", "C"].filter((suit) => bySuit[suit].length >= 4).length;
  const lowCards = hand.filter((card) => card.rank <= 6 && card.suit !== "S").length;
  const weakSpades = spades.filter((card) => card.rank <= 8).length;

  const nilShot = aces === 0 && highSpades === 0 && spades.length <= 2 && lowCards >= 8 && difficulty > 0.6;
  if (nilShot && Math.random() < difficulty) return 0;

  let estimate = 0;
  estimate += spades.length * 0.42;
  estimate += highSpades * 0.85;
  estimate += aces * 0.95;
  estimate += kings * 0.58;
  estimate += queens * 0.3;
  estimate += longSuits * 0.25;
  estimate -= weakSpades * 0.06;

  const noise = (Math.random() - 0.5) * (1.1 - difficulty);
  const bid = Math.round(estimate + noise);
  return Math.max(1, Math.min(8, bid));
}

function currentWinningEntry(trick) {
  let best = trick[0];
  const leadSuit = trick[0].card.suit;
  for (const entry of trick.slice(1)) {
    const cur = entry.card;
    const bestCard = best.card;
    if (cur.suit === "S" && bestCard.suit !== "S") {
      best = entry;
    } else if (cur.suit === bestCard.suit && cur.rank > bestCard.rank) {
      best = entry;
    } else if (cur.suit === "S" && bestCard.suit === "S" && cur.rank > bestCard.rank) {
      best = entry;
    } else if (bestCard.suit !== "S" && cur.suit === leadSuit && bestCard.suit === leadSuit && cur.rank > bestCard.rank) {
      best = entry;
    }
  }
  return best;
}

function chooseAiCard(game, seat) {
  const difficulty = game.level.difficulty;
  const player = game.players[seat];
  const legal = getLegalCards(game, seat);
  const team = teamOfSeat(seat);
  const partnerSeat = partnerOf(seat);
  const teamBid = TEAM_SEATS[team].reduce((sum, s) => sum + Math.max(0, game.players[s].bid || 0), 0);
  const teamTricks = TEAM_SEATS[team].reduce((sum, s) => sum + game.players[s].tricks, 0);
  const needTricks = teamTricks < teamBid;

  const sortedLow = [...legal].sort((a, b) => cardPower(a) - cardPower(b));
  const sortedHigh = [...legal].sort((a, b) => cardPower(b) - cardPower(a));

  if (!game.currentTrick.length) {
    if (!needTricks) {
      return sortedLow[0];
    }
    const aggressive = sortedHigh.find((card) => card.suit !== "S" && card.rank >= 12)
      || sortedHigh.find((card) => card.suit === "S" && game.spadesBroken)
      || sortedHigh[0];
    if (Math.random() > difficulty) return sortedLow[Math.floor(Math.random() * Math.min(2, sortedLow.length))];
    return aggressive;
  }

  const winning = currentWinningEntry(game.currentTrick);
  const partnerWinning = winning.seat === partnerSeat;
  const leadSuit = game.currentTrick[0].card.suit;
  const winningOptions = legal.filter((card) => beatsCard(card, winning.card, leadSuit));

  if (partnerWinning && !needTricks) {
    return sortedLow[0];
  }

  if (winningOptions.length) {
    const lowestWinner = winningOptions.sort((a, b) => cardPower(a) - cardPower(b))[0];
    const highestWinner = winningOptions.sort((a, b) => cardPower(b) - cardPower(a))[0];
    if (!partnerWinning && needTricks) {
      return Math.random() < difficulty ? lowestWinner : highestWinner;
    }
    if (!partnerWinning && Math.random() < difficulty * 0.55) {
      return lowestWinner;
    }
  }

  if (!legal.some((card) => card.suit === leadSuit) && legal.some((card) => card.suit === "S") && !partnerWinning && needTricks) {
    const trumpWinners = legal.filter((card) => card.suit === "S");
    return trumpWinners.sort((a, b) => cardPower(a) - cardPower(b))[0];
  }

  return sortedLow[0];
}

function beatsCard(candidate, bestCard, leadSuit) {
  const candidateTrump = candidate.suit === "S";
  const bestTrump = bestCard.suit === "S";
  if (candidateTrump && !bestTrump) return true;
  if (candidateTrump && bestTrump) return candidate.rank > bestCard.rank;
  if (!candidateTrump && bestTrump) return false;
  if (candidate.suit !== leadSuit) return false;
  if (bestCard.suit !== leadSuit) return true;
  return candidate.rank > bestCard.rank;
}

function beginHand() {
  state.busy = false;
  hidePassOverlay();
  const game = state.game;
  syncHumanRoles(game);
  game.handNumber += 1;
  game.phase = "bidding";
  game.currentTrick = [];
  game.trickCount = 0;
  game.spadesBroken = false;
  game.players.forEach((player) => {
    player.bid = null;
    player.tricks = 0;
    player.hand = [];
  });

  const deck = shuffle(createDeck());
  for (let i = 0; i < 13; i += 1) {
    for (let seat = 0; seat < 4; seat += 1) {
      state.game.players[seat].hand.push(deck.pop());
    }
  }
  game.players.forEach((player) => { player.hand = sortHand(player.hand); });

  game.currentTurn = game.startingLeader;
  game.trickLeader = game.startingLeader;
  renderMessage(`Hand ${game.handNumber} dealt. ${SEAT_NAMES[game.currentTurn]} starts the bids.`);
  addLog(`New hand dealt. ${SEAT_NAMES[game.currentTurn]} opens bidding.`);
  renderAll();
  stepGame();
}

function startNewBattle() {
  state.game = makeFreshGame();
  renderAll();
  beginHand();
}

function resolveBidsDone() {
  const game = state.game;
  game.phase = "playing";
  game.currentTurn = game.startingLeader;
  game.trickLeader = game.startingLeader;
  renderMessage(`${SEAT_NAMES[game.currentTurn]} leads the first trick.`);
  addLog(`Bids locked. Battle phase begins.`);
  renderAll();
  stepGame();
}

function allBidsPlaced(game) {
  return game.players.every((player) => player.bid !== null);
}

function allCardsGone(game) {
  return game.players.every((player) => player.hand.length === 0);
}

function stepGame() {
  if (!state.game || state.busy) return;
  const game = state.game;
  renderAll();

  if (game.phase === "bidding") {
    if (allBidsPlaced(game)) {
      resolveBidsDone();
      return;
    }
    const player = game.players[game.currentTurn];
    if (player.human) {
      if (state.mode === "pvp" && state.passGate?.seat !== player.seat) {
        showPassOverlay(player.seat);
        renderMessage(`Pass to ${SEAT_NAMES[player.seat]} for bidding.`);
        return;
      }
      renderMessage(`${SEAT_NAMES[player.seat]}, choose your bid.`);
      renderBidPanel();
      renderAll();
      return;
    }
    state.busy = true;
    setTimeout(() => {
      const bid = estimateBid(player.hand, game.level.difficulty);
      player.bid = bid;
      addLog(`${player.name} bids ${bid === 0 ? "Nil" : bid}.`);
      game.currentTurn = nextSeat(game.currentTurn);
      state.busy = false;
      renderAll();
      stepGame();
    }, 450);
    return;
  }

  if (game.phase === "playing") {
    if (game.currentTrick.length === 4) {
      finishTrick();
      return;
    }

    const player = game.players[game.currentTurn];
    if (player.human) {
      if (state.mode === "pvp" && state.passGate?.seat !== player.seat) {
        showPassOverlay(player.seat);
        renderMessage(`Pass to ${SEAT_NAMES[player.seat]} to play.`);
        return;
      }
      renderMessage(`${SEAT_NAMES[player.seat]} to play.`);
      renderAll();
      return;
    }

    state.busy = true;
    setTimeout(() => {
      const card = chooseAiCard(game, player.seat);
      state.busy = false;
      if (!card) {
        renderMessage(`${SEAT_NAMES[player.seat]} stalled. Reset the battle — the table goblin escaped.`);
        return;
      }
      playCard(player.seat, card.id);
    }, 550);
    return;
  }

  if (game.phase === "resolved") {
    setTimeout(() => {
      if (checkGameWinner()) {
        renderAll();
        return;
      }
      game.startingLeader = nextSeat(game.startingLeader);
      beginHand();
    }, 1200);
  }
}

function handleHumanPlay(cardId) {
  if (!state.game) return;
  const seat = state.game.currentTurn;
  playCard(seat, cardId);
}

function playCard(seat, cardId) {
  const game = state.game;
  const player = game.players[seat];
  const legal = getLegalCards(game, seat);
  const card = player.hand.find((item) => item.id === cardId);
  if (!card) return;
  if (!legal.some((item) => item.id === card.id)) {
    renderMessage("That card is illegal right now. Follow suit. The table has standards.");
    return;
  }

  player.hand = player.hand.filter((item) => item.id !== cardId);
  game.currentTrick.push({ seat, card });
  if (card.suit === "S" && (!game.currentTrick.length || game.currentTrick[0].card.suit !== "S" || game.spadesBroken === false)) {
    game.spadesBroken = true;
  }
  if (card.suit === "S") game.spadesBroken = true;

  addLog(`${player.name} plays ${cardLabel(card)}.`);

  if (game.currentTrick.length === 4) {
    renderAll();
    stepGame();
    return;
  }

  game.currentTurn = nextSeat(game.currentTurn);
  hidePassOverlay();
  renderAll();
  stepGame();
}

function finishTrick() {
  const game = state.game;
  const winnerSeat = winnerOfTrick(game.currentTrick);
  game.players[winnerSeat].tricks += 1;
  game.trickCount += 1;
  game.currentTurn = winnerSeat;
  game.trickLeader = winnerSeat;
  addLog(`${SEAT_NAMES[winnerSeat]} wins the trick.`, true);
  renderMessage(`${SEAT_NAMES[winnerSeat]} takes the trick.`);
  renderAll();

  setTimeout(() => {
    game.currentTrick = [];
    hidePassOverlay();
    if (allCardsGone(game)) {
      resolveHand();
      return;
    }
    renderAll();
    stepGame();
  }, 950);
}

function resolveHand() {
  const game = state.game;
  const teamRoundScores = [0, 0];
  const setFlags = [false, false];
  const nilSuccess = [0, 0];

  [0, 1].forEach((team) => {
    const seats = TEAM_SEATS[team];
    const bidSum = seats.reduce((sum, seat) => sum + Math.max(0, game.players[seat].bid || 0), 0);
    const tricks = seats.reduce((sum, seat) => sum + game.players[seat].tricks, 0);
    let roundScore = 0;
    let newBags = 0;

    seats.forEach((seat) => {
      const bid = game.players[seat].bid || 0;
      const won = game.players[seat].tricks;
      if (bid === 0) {
        if (won === 0) {
          roundScore += 100;
          nilSuccess[team] += 1;
        } else {
          roundScore -= 100;
        }
      }
    });

    if (tricks >= bidSum) {
      roundScore += bidSum * 10;
      newBags = tricks - bidSum;
      roundScore += newBags;
      game.teams[team].bags += newBags;
      if (game.teams[team].bags >= 10) {
        roundScore -= 100;
        game.teams[team].bags -= 10;
        addLog(`${team === 0 ? "South/North" : "West/East"} got bagged for 100.`);
      }
    } else {
      roundScore -= bidSum * 10;
      setFlags[team] = true;
    }

    teamRoundScores[team] = roundScore;
    game.teams[team].score += roundScore;
  });

  const diff = teamRoundScores[0] - teamRoundScores[1];
  if (diff > 0) {
    const damage = Math.max(5, Math.floor(diff / 12) + nilSuccess[0] * 6 + (setFlags[1] ? 5 : 0));
    game.teams[1].hp = Math.max(0, game.teams[1].hp - damage);
    addLog(`South/North deal ${damage} damage.`, true);
    renderMessage(`South/North win the hand and hit for ${damage}.`);
  } else if (diff < 0) {
    const damage = Math.max(5, Math.floor(Math.abs(diff) / 12) + nilSuccess[1] * 6 + (setFlags[0] ? 5 : 0));
    game.teams[0].hp = Math.max(0, game.teams[0].hp - damage);
    addLog(`West/East deal ${damage} damage.`, true);
    renderMessage(`West/East win the hand and hit for ${damage}.`);
  } else {
    renderMessage("The hand is a draw. Nobody gets chopped this round.");
    addLog("Hand ends tied. No damage dealt.");
  }

  addLog(`Round score — South/North ${teamRoundScores[0]}, West/East ${teamRoundScores[1]}.`, true);
  game.phase = "resolved";
  renderAll();
  stepGame();
}

function checkGameWinner() {
  const game = state.game;
  let winner = null;
  if (game.teams[0].hp <= 0) winner = 1;
  if (game.teams[1].hp <= 0) winner = 0;
  if (winner === null && game.teams[0].score >= WIN_SCORE) winner = 0;
  if (winner === null && game.teams[1].score >= WIN_SCORE) winner = 1;
  if (winner === null) return false;

  game.phase = "gameover";
  game.winner = winner;
  const victoryText = winner === 0 ? "South/North win the battle." : "West/East win the battle.";
  renderMessage(victoryText);
  addLog(victoryText, true);

  if (winner === 0 && state.mode === "ai" && state.selectedLevel === state.unlockedLevel && state.unlockedLevel < LEVELS.length) {
    state.unlockedLevel += 1;
    saveProgress();
    addLog(`Level ${state.unlockedLevel} unlocked.`, true);
  }

  renderAll();
  return true;
}

ui.confirmBidBtn.addEventListener("click", () => {
  if (!state.game) return;
  const game = state.game;
  const seat = game.currentTurn;
  const player = game.players[seat];
  if (!player?.human || game.phase !== "bidding") return;
  player.bid = Number(ui.bidSelect.value);
  hidePassOverlay();
  addLog(`${player.name} bids ${player.bid === 0 ? "Nil" : player.bid}.`);
  game.currentTurn = nextSeat(game.currentTurn);
  renderAll();
  stepGame();
});

ui.newGameBtn.addEventListener("click", startNewBattle);
ui.modeAiBtn.addEventListener("click", () => {
  state.mode = "ai";
  updateHeader();
  renderLevelButtons();
  startNewBattle();
});
ui.modePvpBtn.addEventListener("click", () => {
  state.mode = "pvp";
  updateHeader();
  renderLevelButtons();
  startNewBattle();
});
ui.rulesBtn.addEventListener("click", () => ui.rulesDialog.showModal());
ui.closeRulesBtn.addEventListener("click", () => ui.rulesDialog.close());
ui.passContinueBtn.addEventListener("click", hidePassOverlay);
ui.clearLogBtn.addEventListener("click", () => {
  if (state.game) state.game.journal = [];
  renderLog();
});

loadProgress();
updateHeader();
renderLevelButtons();
renderAll();
