import React, { useReducer, useState, useEffect, useRef } from "react";
import { CircleDot, Trophy, Undo2, RotateCcw, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

// localStorage-backed shim so this works outside Claude.ai (which provides window.storage natively)
const storage = {
  async get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return null;
      return { key, value: raw };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
  async delete(key) {
    try {
      window.localStorage.removeItem(key);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },
};


const PLAYERS = ["A1", "A2", "B1", "B2"];
const TEAM_OF = { A1: "A", A2: "A", B1: "B", B2: "B" };
const PARTNER = { A1: "A2", A2: "A1", B1: "B2", B2: "B1" };
const OPP = { A: "B", B: "A" };

function emptyShotStats() {
  return { winners: 0, unforced: 0, forced: 0 };
}

function emptyStats() {
  return {
    firstAtt: 0,
    firstIn: 0,
    secondAtt: 0,
    secondIn: 0,
    doubleFaults: 0,
    aces: 0,
    winners: 0,
    unforced: 0,
    forced: 0,
    shots: {
      forehand: emptyShotStats(),
      backhand: emptyShotStats(),
      volley: emptyShotStats(),
      overhead: emptyShotStats(),
      forehandLob: emptyShotStats(),
      backhandLob: emptyShotStats(),
      dropShot: emptyShotStats(),
    },
  };
}

function cloneStats(stats) {
  const out = {};
  PLAYERS.forEach((p) => {
    out[p] = { ...stats[p], shots: {} };
    Object.keys(stats[p].shots).forEach((shot) => {
      out[p].shots[shot] = { ...stats[p].shots[shot] };
    });
  });
  return out;
}

function initialStateFactory() {
  return {
    screen: "setup",
    names: { A1: "", A2: "", B1: "", B2: "" },
    teamNames: { A: "Team A", B: "Team B" },
    order: ["A1", "B1", "A2", "B2"],
    returnSides: { A: { deuce: "A1", ad: "A2" }, B: { deuce: "B1", ad: "B2" } },
    thirdSetMode: "full",
    trackShotType: false,
    serverIdx: 0,
    tbStartIdx: 0,
    sets: [],
    gamesA: 0,
    gamesB: 0,
    ptsA: 0,
    ptsB: 0,
    tiebreak: false,
    matchTB: false,
    serveStage: "first",
    servePhase: null,
    awaitingThirdSetFormat: false,
    stats: { A1: emptyStats(), A2: emptyStats(), B1: emptyStats(), B2: emptyStats() },
    winner: null,
    pointLog: [],
    history: [],
  };
}

function pointSide(ptsA, ptsB) {
  return (ptsA + ptsB) % 2 === 0 ? "deuce" : "ad";
}

function pointScoreLabel(ptsA, ptsB, tiebreak) {
  if (tiebreak) return `${ptsA}-${ptsB}`;
  const labels = ["0", "15", "30", "40"];
  if (ptsA < 4 && ptsB < 4) return `${labels[ptsA]}-${labels[ptsB]}`;
  if (ptsA === ptsB) return "Deuce";
  return ptsA > ptsB ? "Ad-40" : "40-Ad";
}

function setScoreString(s) {
  if (s.matchTB) return `[${s.tbA}-${s.tbB}]`;
  let str = `${s.a}-${s.b}`;
  if (s.tbA != null) {
    const loser = s.a > s.b ? s.tbB : s.tbA;
    str += `(${loser})`;
  }
  return str;
}

function currentServer(state) {
  if (state.tiebreak || state.matchTB) {
    const played = state.ptsA + state.ptsB;
    const offset = played === 0 ? 0 : 1 + Math.floor((played - 1) / 2);
    const idx = (state.tbStartIdx + offset) % 4;
    return state.order[idx];
  }
  return state.order[state.serverIdx];
}

function pushHistory(state) {
  const { history, ...rest } = state;
  const snap = {
    ...rest,
    stats: cloneStats(rest.stats),
    names: { ...rest.names },
    teamNames: { ...rest.teamNames },
    order: [...rest.order],
    returnSides: { A: { ...rest.returnSides.A }, B: { ...rest.returnSides.B } },
    sets: rest.sets.map((s) => ({ ...s })),
    pointLog: [...rest.pointLog],
  };
  const newHistory = [...history, snap].slice(-50);
  return { ...state, history: newHistory };
}

function awardPoint(state, team) {
  const s = { ...state };
  if (s.tiebreak || s.matchTB) {
    let ptsA = s.ptsA + (team === "A" ? 1 : 0);
    let ptsB = s.ptsB + (team === "B" ? 1 : 0);
    const target = s.matchTB ? 10 : 7;
    const winnerPts = team === "A" ? ptsA : ptsB;
    const isWin = winnerPts >= target && Math.abs(ptsA - ptsB) >= 2;
    if (!isWin) {
      return { ...s, ptsA, ptsB, serveStage: "first", servePhase: null };
    }
    let setEntry;
    if (s.matchTB) {
      setEntry = { a: null, b: null, tbA: ptsA, tbB: ptsB, matchTB: true };
    } else {
      setEntry = {
        a: team === "A" ? 7 : 6,
        b: team === "B" ? 7 : 6,
        tbA: ptsA,
        tbB: ptsB,
        matchTB: false,
      };
    }
    const sets = [...s.sets, setEntry];
    const setsWonA = sets.filter((x) => (x.matchTB ? x.tbA > x.tbB : x.a > x.b)).length;
    const setsWonB = sets.length - setsWonA;
    let winner = null;
    if (setsWonA === 2) winner = "A";
    else if (setsWonB === 2) winner = "B";
    if (winner) {
      return {
        ...s,
        sets,
        ptsA: 0,
        ptsB: 0,
        tiebreak: false,
        matchTB: false,
        serveStage: "first",
        servePhase: null,
        winner,
      };
    }
    const nextSetNumber = sets.length + 1;
    const nextIsDeciding = nextSetNumber === 3;
    const nextServerIdx = (s.tbStartIdx + 1) % 4;
    return {
      ...s,
      sets,
      gamesA: 0,
      gamesB: 0,
      ptsA: 0,
      ptsB: 0,
      tiebreak: false,
      matchTB: false,
      serverIdx: nextServerIdx,
      serveStage: "first",
      servePhase: null,
      awaitingThirdSetFormat: nextIsDeciding,
    };
  }

  let ptsA = s.ptsA + (team === "A" ? 1 : 0);
  let ptsB = s.ptsB + (team === "B" ? 1 : 0);
  const winnerPts = team === "A" ? ptsA : ptsB;
  const isGameWin = winnerPts >= 4 && Math.abs(ptsA - ptsB) >= 2;
  if (!isGameWin) {
    return { ...s, ptsA, ptsB, serveStage: "first", servePhase: null };
  }
  const gamesA = s.gamesA + (team === "A" ? 1 : 0);
  const gamesB = s.gamesB + (team === "B" ? 1 : 0);
  const newServerIdx = (s.serverIdx + 1) % 4;

  if (gamesA === 6 && gamesB === 6) {
    return {
      ...s,
      gamesA,
      gamesB,
      ptsA: 0,
      ptsB: 0,
      serverIdx: newServerIdx,
      tiebreak: true,
      tbStartIdx: newServerIdx,
      serveStage: "first",
      servePhase: null,
    };
  }

  const teamGames = team === "A" ? gamesA : gamesB;
  const isSetWin = teamGames >= 6 && Math.abs(gamesA - gamesB) >= 2;
  if (isSetWin) {
    const setEntry = { a: gamesA, b: gamesB, tbA: null, tbB: null, matchTB: false };
    const sets = [...s.sets, setEntry];
    const setsWonA = sets.filter((x) => x.a > x.b).length;
    const setsWonB = sets.length - setsWonA;
    let winner = null;
    if (setsWonA === 2) winner = "A";
    else if (setsWonB === 2) winner = "B";
    if (winner) {
      return {
        ...s,
        sets,
        gamesA: 0,
        gamesB: 0,
        ptsA: 0,
        ptsB: 0,
        serverIdx: newServerIdx,
        serveStage: "first",
        servePhase: null,
        winner,
      };
    }
    const nextSetNumber = sets.length + 1;
    const nextIsDeciding = nextSetNumber === 3;
    return {
      ...s,
      sets,
      gamesA: 0,
      gamesB: 0,
      ptsA: 0,
      ptsB: 0,
      serverIdx: newServerIdx,
      serveStage: "first",
      servePhase: null,
      awaitingThirdSetFormat: nextIsDeciding,
    };
  }

  return {
    ...s,
    gamesA,
    gamesB,
    ptsA: 0,
    ptsB: 0,
    serverIdx: newServerIdx,
    serveStage: "first",
    servePhase: null,
  };
}

function awardPointWithLog(state, team, meta) {
  const before = state;
  const next = awardPoint(state, team);
  const side = pointSide(before.ptsA, before.ptsB);
  const scoreLabel = pointScoreLabel(before.ptsA, before.ptsB, before.tiebreak || before.matchTB);
  const setNumber = before.sets.length + 1;
  const receiverTeam = OPP[TEAM_OF[meta.server]];
  const receiver = before.returnSides[receiverTeam][side];

  let tag = null;
  if (next.winner && !before.winner) tag = "match";
  else if (next.sets.length > before.sets.length) tag = "set";
  else if (next.gamesA + next.gamesB > before.gamesA + before.gamesB) tag = "game";

  const entry = {
    seq: before.pointLog.length + 1,
    entryKind: "point",
    setNumber,
    scoreLabel,
    side,
    server: meta.server,
    receiver,
    servePhase: meta.servePhase,
    type: meta.type,
    player: meta.player,
    shotType: meta.shotType || null,
    winningTeam: team,
    tag,
  };

  return { ...next, pointLog: [...before.pointLog, entry] };
}

function reducer(state, action) {
  switch (action.type) {
    case "START": {
      return {
        ...initialStateFactory(),
        screen: "match",
        names: action.payload.names,
        teamNames: action.payload.teamNames,
        order: action.payload.order,
        returnSides: action.payload.returnSides,
        thirdSetMode: action.payload.thirdSetMode,
        trackShotType: action.payload.trackShotType,
      };
    }
    case "FIRST_IN": {
      const s = pushHistory(state);
      const server = currentServer(s);
      const stats = cloneStats(s.stats);
      stats[server].firstAtt++;
      stats[server].firstIn++;
      return { ...s, stats, serveStage: "outcome", servePhase: "first" };
    }
    case "FIRST_FAULT": {
      const s = pushHistory(state);
      const server = currentServer(s);
      const stats = cloneStats(s.stats);
      stats[server].firstAtt++;
      return { ...s, stats, serveStage: "second", servePhase: null };
    }
    case "SECOND_IN": {
      const s = pushHistory(state);
      const server = currentServer(s);
      const stats = cloneStats(s.stats);
      stats[server].secondAtt++;
      stats[server].secondIn++;
      return { ...s, stats, serveStage: "outcome", servePhase: "second" };
    }
    case "DOUBLE_FAULT": {
      let s = pushHistory(state);
      const server = currentServer(s);
      const stats = cloneStats(s.stats);
      stats[server].secondAtt++;
      stats[server].doubleFaults++;
      s = { ...s, stats };
      return awardPointWithLog(s, OPP[TEAM_OF[server]], {
        type: "doubleFault",
        player: server,
        server,
        servePhase: "second",
      });
    }
    case "ACE": {
      let s = pushHistory(state);
      const server = currentServer(s);
      const stats = cloneStats(s.stats);
      stats[server].aces++;
      s = { ...s, stats };
      return awardPointWithLog(s, TEAM_OF[server], {
        type: "ace",
        player: server,
        server,
        servePhase: s.servePhase,
      });
    }
    case "OUTCOME": {
      let s = pushHistory(state);
      const { kind, player, shotType } = action.payload;
      const stats = cloneStats(s.stats);
      let winningTeam;
      if (kind === "winner") {
        stats[player].winners++;
        winningTeam = TEAM_OF[player];
      } else if (kind === "unforced") {
        stats[player].unforced++;
        winningTeam = OPP[TEAM_OF[player]];
      } else {
        stats[player].forced++;
        winningTeam = OPP[TEAM_OF[player]];
      }
      if (shotType && stats[player].shots[shotType]) {
        const bucket = kind === "winner" ? "winners" : kind === "unforced" ? "unforced" : "forced";
        stats[player].shots[shotType][bucket]++;
      }
      s = { ...s, stats };
      const server = currentServer(s);
      return awardPointWithLog(s, winningTeam, { type: kind, player, server, servePhase: s.servePhase, shotType: shotType || null });
    }
    case "TOGGLE_SHOT_TRACKING": {
      return { ...state, trackShotType: !state.trackShotType };
    }
    case "SET_THIRD_SET_MODE": {
      if (state.sets.length >= 2) return state;
      const s = pushHistory(state);
      return { ...s, thirdSetMode: action.payload.mode };
    }
    case "SET_RETURN_SIDE": {
      const { team, deucePlayer } = action.payload;
      if (state.winner) return state;
      const s = pushHistory(state);
      const adPlayer = PARTNER[deucePlayer];
      const setNumber = s.sets.length + 1;
      const scoreLabel = pointScoreLabel(s.ptsA, s.ptsB, s.tiebreak || s.matchTB);
      const entry = {
        seq: s.pointLog.length + 1,
        entryKind: "event",
        eventType: "returnSideChange",
        setNumber,
        scoreLabel,
        team,
        deucePlayer,
        adPlayer,
      };
      return {
        ...s,
        returnSides: { ...s.returnSides, [team]: { deuce: deucePlayer, ad: adPlayer } },
        pointLog: [...s.pointLog, entry],
      };
    }
    case "CHOOSE_THIRD_SET_FORMAT": {
      const s = pushHistory(state);
      const mode = action.payload.mode;
      if (mode === "tb10") {
        return {
          ...s,
          thirdSetMode: mode,
          matchTB: true,
          tiebreak: false,
          ptsA: 0,
          ptsB: 0,
          tbStartIdx: s.serverIdx,
          awaitingThirdSetFormat: false,
        };
      }
      return {
        ...s,
        thirdSetMode: mode,
        matchTB: false,
        awaitingThirdSetFormat: false,
      };
    }
    case "SET_SERVER": {
      if (state.winner || state.awaitingThirdSetFormat) return state;
      const player = action.payload.player;
      let slotIndex;
      if (state.tiebreak || state.matchTB) {
        const played = state.ptsA + state.ptsB;
        const offset = played === 0 ? 0 : 1 + Math.floor((played - 1) / 2);
        slotIndex = (state.tbStartIdx + offset) % 4;
      } else {
        slotIndex = state.serverIdx;
      }
      const playerIdx = state.order.indexOf(player);
      if (playerIdx === -1 || playerIdx === slotIndex) return state;
      const s = pushHistory(state);
      const order = [...s.order];
      const tmp = order[slotIndex];
      order[slotIndex] = order[playerIdx];
      order[playerIdx] = tmp;
      const setNumber = s.sets.length + 1;
      const scoreLabel = pointScoreLabel(s.ptsA, s.ptsB, s.tiebreak || s.matchTB);
      const entry = {
        seq: s.pointLog.length + 1,
        entryKind: "event",
        eventType: "serverChange",
        setNumber,
        scoreLabel,
        player,
      };
      return { ...s, order, pointLog: [...s.pointLog, entry] };
    }
    case "UNDO": {
      if (state.history.length === 0) return state;
      const hist = state.history.slice(0, -1);
      const prev = state.history[state.history.length - 1];
      return { ...prev, history: hist };
    }
    case "RESET": {
      return {
        ...initialStateFactory(),
        names: state.names,
        teamNames: state.teamNames,
        returnSides: state.returnSides,
        trackShotType: state.trackShotType,
      };
    }
    case "LOAD_STATE": {
      return { ...initialStateFactory(), ...action.payload, history: [] };
    }
    default:
      return state;
  }
}

function pct(made, att) {
  if (!att) return 0;
  return Math.round((made / att) * 100);
}

function nameOf(state, key) {
  return state.names[key] || key;
}

export default function TennisDoublesTracker() {
  const [state, dispatch] = useReducer(reducer, undefined, initialStateFactory);
  const [showStats, setShowStats] = useState(false);
  const [showReturnSettings, setShowReturnSettings] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [pendingOutcome, setPendingOutcome] = useState(null);
  const [copyStatus, setCopyStatus] = useState("idle");
  const [savedMatchAvailable, setSavedMatchAvailable] = useState(false);
  const [matchArchive, setMatchArchive] = useState([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);

  // SPA routing: reflect the current screen in the URL hash (#/setup, #/match)
  // and let browser back/forward move between them.
  useEffect(() => {
    const desired = state.screen === "match" ? "#/match" : "#/setup";
    if (window.location.hash !== desired) {
      window.history.pushState(null, "", desired);
    }
  }, [state.screen]);

  useEffect(() => {
    function onPopState() {
      const hash = window.location.hash;
      if (hash === "#/setup" && state.screen === "match" && state.winner) {
        dispatch({ type: "RESET" });
      } else if (hash !== (state.screen === "match" ? "#/match" : "#/setup")) {
        window.history.replaceState(null, "", state.screen === "match" ? "#/match" : "#/setup");
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [state.screen, state.winner]);

  useEffect(() => {
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setInstallPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }
  const saveTimeoutRef = useRef(null);
  const archivedRef = useRef(false);

  useEffect(() => {
    setPendingOutcome(null);
  }, [state.pointLog.length, state.serveStage, state.screen]);

  // load any saved in-progress match + match history on first mount
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("current-match");
        if (res && res.value) {
          const saved = JSON.parse(res.value);
          if (saved && saved.screen === "match" && !saved.winner) {
            setSavedMatchAvailable(true);
          }
        }
      } catch (e) {
        // no saved match, or storage unavailable
      }
      try {
        const arch = await storage.get("match-archive");
        if (arch && arch.value) {
          setMatchArchive(JSON.parse(arch.value));
        }
      } catch (e) {
        // no history yet
      }
      setStorageReady(true);
    })();
  }, []);

  // debounce-save the in-progress match so it survives a refresh
  useEffect(() => {
    if (state.screen !== "match" || state.winner) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const { history, ...toSave } = state;
      storage.set("current-match", JSON.stringify(toSave)).catch(() => {});
    }, 1000);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [state]);

  // archive a match once it's won, and clear the in-progress save
  useEffect(() => {
    if (state.winner && !archivedRef.current) {
      archivedRef.current = true;
      const summary = {
        id: Date.now(),
        date: new Date().toISOString(),
        teamNames: state.teamNames,
        names: state.names,
        winner: state.winner,
        finalScore: state.sets.map(setScoreString).join(", "),
        stats: state.stats,
        trackShotType: state.trackShotType,
      };
      (async () => {
        try {
          const res = await storage.get("match-archive");
          const arr = res && res.value ? JSON.parse(res.value) : [];
          const newArr = [summary, ...arr].slice(0, 50);
          await storage.set("match-archive", JSON.stringify(newArr));
          setMatchArchive(newArr);
        } catch (e) {
          // ignore, archive is best-effort
        }
        storage.delete("current-match").catch(() => {});
      })();
    }
    if (!state.winner) archivedRef.current = false;
  }, [state.winner]);

  async function handleResumeMatch() {
    try {
      const res = await storage.get("current-match");
      if (res && res.value) {
        const saved = JSON.parse(res.value);
        dispatch({ type: "LOAD_STATE", payload: saved });
      }
    } catch (e) {
      // nothing to resume
    }
    setSavedMatchAvailable(false);
  }

  async function handleDiscardSavedMatch() {
    try {
      await storage.delete("current-match");
    } catch (e) {}
    setSavedMatchAvailable(false);
  }

  async function handleClearHistory() {
    try {
      await storage.delete("match-archive");
    } catch (e) {}
    setMatchArchive([]);
  }

  const [form, setForm] = useState({
    teamAName: "Team A",
    a1: "",
    a2: "",
    teamBName: "Team B",
    b1: "",
    b2: "",
    firstServer: "A1",
    secondServerOpp: "B1",
    aDeuceReturner: "A1",
    bDeuceReturner: "B1",
    thirdSetMode: "full",
    trackShotType: false,
  });

  const formName = (key) => {
    const map = {
      A1: form.a1 || "Player 1",
      A2: form.a2 || "Player 2",
      B1: form.b1 || "Player 3",
      B2: form.b2 || "Player 4",
    };
    return map[key];
  };

  const oppTeam = OPP[TEAM_OF[form.firstServer]];
  const oppPlayers = PLAYERS.filter((p) => TEAM_OF[p] === oppTeam);

  function handleStart() {
    const names = {
      A1: form.a1 || "Player 1",
      A2: form.a2 || "Player 2",
      B1: form.b1 || "Player 3",
      B2: form.b2 || "Player 4",
    };
    const teamNames = { A: form.teamAName || "Team A", B: form.teamBName || "Team B" };
    const first = form.firstServer;
    const partner = PARTNER[first];
    const theirTeam = OPP[TEAM_OF[first]];
    const teamPlayers = PLAYERS.filter((p) => TEAM_OF[p] === theirTeam);
    const second = teamPlayers.includes(form.secondServerOpp) ? form.secondServerOpp : teamPlayers[0];
    const remaining = teamPlayers.find((p) => p !== second);
    const order = [first, second, partner, remaining];
    const returnSides = {
      A: { deuce: form.aDeuceReturner, ad: PARTNER[form.aDeuceReturner] },
      B: { deuce: form.bDeuceReturner, ad: PARTNER[form.bDeuceReturner] },
    };
    dispatch({
      type: "START",
      payload: { names, teamNames, order, returnSides, thirdSetMode: form.thirdSetMode, trackShotType: form.trackShotType },
    });
  }

  const fontImport = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
      .tdt-root { --navy:#0B1D33; --panel:#12283F; --panel2:#173151; --line:#E7ECF2; --muted:#7C93AC; --ball:#D3EA55; --ball-dim:#96A93E; --coral:#FF7A6E; --amber:#F2A65A; --teamA:#5AC8E8; --teamB:#F2A65A;
        font-family:'Inter',sans-serif; background:var(--navy); color:var(--line);
      }
      .tdt-display { font-family:'Oswald',sans-serif; letter-spacing:0.02em; }
      .tdt-panel { background:var(--panel); border:1px solid rgba(255,255,255,0.07); }
      .tdt-panel2 { background:var(--panel2); border:1px solid rgba(255,255,255,0.08); }
      .tdt-btn { font-family:'Inter',sans-serif; font-weight:600; transition:transform .08s ease, background .15s ease; }
      .tdt-btn:active { transform:scale(0.96); }
      .tdt-btn-ball { background:var(--ball); color:#12280A; }
      .tdt-btn-ball:hover { background:var(--ball-dim); }
      .tdt-btn-outline { background:transparent; border:1.5px solid rgba(255,255,255,0.18); color:var(--line); }
      .tdt-btn-outline:hover { border-color:var(--ball); }
      .tdt-btn-coral { background:rgba(255,122,110,0.15); color:var(--coral); border:1px solid rgba(255,122,110,0.35); }
      .tdt-btn-coral:hover { background:rgba(255,122,110,0.28); }
      .tdt-btn-amber { background:rgba(242,166,90,0.15); color:var(--amber); border:1px solid rgba(242,166,90,0.35); }
      .tdt-btn-amber:hover { background:rgba(242,166,90,0.28); }
      .tdt-btn-green { background:rgba(211,234,85,0.15); color:var(--ball); border:1px solid rgba(211,234,85,0.35); }
      .tdt-btn-green:hover { background:rgba(211,234,85,0.28); }
      .tdt-team-a { color:var(--teamA); }
      .tdt-team-b { color:var(--teamB); }
      .tdt-border-a { border-color:var(--teamA); }
      .tdt-border-b { border-color:var(--teamB); }
      .tdt-dot { color:var(--ball); animation:tdtpulse 1.4s ease-in-out infinite; }
      @keyframes tdtpulse { 0%,100%{opacity:1;} 50%{opacity:0.35;} }
      .tdt-sb-head { background:rgba(255,255,255,0.03); border-bottom:1px solid rgba(255,255,255,0.08); }
      .tdt-sb-livehead { color:var(--ball); }
      .tdt-sb-row { border-bottom:1px solid rgba(255,255,255,0.06); }
      .tdt-sb-row:last-child { border-bottom:none; }
      .tdt-sb-row-a { background:linear-gradient(90deg, rgba(90,200,232,0.14), transparent 65%); box-shadow: inset 3px 0 0 var(--teamA); }
      .tdt-sb-row-b { background:linear-gradient(90deg, rgba(242,166,90,0.14), transparent 65%); box-shadow: inset 3px 0 0 var(--teamB); }
      .tdt-info-row-a { background:linear-gradient(90deg, rgba(90,200,232,0.14), transparent 75%); box-shadow: inset 3px 0 0 var(--teamA); }
      .tdt-info-row-b { background:linear-gradient(90deg, rgba(242,166,90,0.14), transparent 75%); box-shadow: inset 3px 0 0 var(--teamB); }
      .tdt-sb-livecol { background:rgba(211,234,85,0.08); box-shadow: inset 0 0 0 1px rgba(211,234,85,0.25); }
      .tdt-sb-pts { background:var(--ball); color:#12280A; min-width:2.4rem; }
      .tdt-input { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:var(--line); }
      .tdt-input:focus { outline:none; border-color:var(--ball); }
      .tdt-muted { color:var(--muted); }
      @media (prefers-reduced-motion: reduce) { .tdt-dot { animation:none; } }
    `}</style>
  );

  if (state.screen === "setup") {
    return (
      <div className="tdt-root min-h-screen w-full flex items-center justify-center p-4">
        {fontImport}
        <div className="w-full max-w-md space-y-4">
        <div className="tdt-panel rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <CircleDot size={22} className="tdt-dot" />
            <h1 className="tdt-display text-2xl font-semibold">Doubles Match Setup</h1>
          </div>
          <p className="tdt-muted text-sm mb-6">Enter both teams, pick the first server, and set the match format.</p>

          {installPrompt && (
            <div className="tdt-panel2 rounded-xl p-4 mb-5 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Install this app</div>
                <div className="tdt-muted text-xs">Add it to your home screen for quick, full-screen access.</div>
              </div>
              <button
                className="tdt-btn tdt-btn-ball rounded-lg px-3 py-2 text-sm flex-shrink-0"
                onClick={handleInstall}
              >
                Install
              </button>
            </div>
          )}

          {savedMatchAvailable && (
            <div className="tdt-panel2 rounded-xl p-4 mb-5">
              <div className="text-sm font-medium mb-1">You have a match in progress</div>
              <div className="tdt-muted text-xs mb-3">Pick up where you left off, or discard it and start fresh.</div>
              <div className="grid grid-cols-2 gap-3">
                <button className="tdt-btn tdt-btn-ball rounded-lg px-3 py-2 text-sm" onClick={handleResumeMatch}>
                  Resume Match
                </button>
                <button className="tdt-btn tdt-btn-outline rounded-lg px-3 py-2 text-sm" onClick={handleDiscardSavedMatch}>
                  Discard
                </button>
              </div>
            </div>
          )}

          <div className="space-y-5">
            <div className="rounded-xl p-4 tdt-panel2 border-l-4 tdt-border-a" style={{ borderLeftWidth: 4 }}>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Team name</label>
              <input
                className="tdt-input rounded-lg px-3 py-2 w-full mb-3 text-sm"
                value={form.teamAName}
                onChange={(e) => setForm({ ...form, teamAName: e.target.value })}
                placeholder="Team A"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Player 1</label>
                  <input
                    className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                    value={form.a1}
                    onChange={(e) => setForm({ ...form, a1: e.target.value })}
                    placeholder="Name"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Player 2</label>
                  <input
                    className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                    value={form.a2}
                    onChange={(e) => setForm({ ...form, a2: e.target.value })}
                    placeholder="Name"
                  />
                </div>
              </div>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1 mt-3">Deuce-court returner</label>
              <select
                className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                value={form.aDeuceReturner}
                onChange={(e) => setForm({ ...form, aDeuceReturner: e.target.value })}
              >
                <option value="A1">{formName("A1")}</option>
                <option value="A2">{formName("A2")}</option>
              </select>
            </div>

            <div className="rounded-xl p-4 tdt-panel2 border-l-4 tdt-border-b" style={{ borderLeftWidth: 4 }}>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Team name</label>
              <input
                className="tdt-input rounded-lg px-3 py-2 w-full mb-3 text-sm"
                value={form.teamBName}
                onChange={(e) => setForm({ ...form, teamBName: e.target.value })}
                placeholder="Team B"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Player 1</label>
                  <input
                    className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                    value={form.b1}
                    onChange={(e) => setForm({ ...form, b1: e.target.value })}
                    placeholder="Name"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Player 2</label>
                  <input
                    className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                    value={form.b2}
                    onChange={(e) => setForm({ ...form, b2: e.target.value })}
                    placeholder="Name"
                  />
                </div>
              </div>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1 mt-3">Deuce-court returner</label>
              <select
                className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                value={form.bDeuceReturner}
                onChange={(e) => setForm({ ...form, bDeuceReturner: e.target.value })}
              >
                <option value="B1">{formName("B1")}</option>
                <option value="B2">{formName("B2")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">Serves first</label>
              <select
                className="tdt-input rounded-lg px-3 py-2 w-full text-sm mb-3"
                value={form.firstServer}
                onChange={(e) => {
                  const val = e.target.value;
                  const newOppTeam = OPP[TEAM_OF[val]];
                  const newOppPlayers = PLAYERS.filter((p) => TEAM_OF[p] === newOppTeam);
                  setForm({ ...form, firstServer: val, secondServerOpp: newOppPlayers[0] });
                }}
              >
                {PLAYERS.map((p) => (
                  <option key={p} value={p}>
                    {formName(p)} ({TEAM_OF[p] === "A" ? form.teamAName || "Team A" : form.teamBName || "Team B"})
                  </option>
                ))}
              </select>

              <label className="block text-xs uppercase tracking-wide tdt-muted mb-1">
                Serves game 2 (opposing team)
              </label>
              <select
                className="tdt-input rounded-lg px-3 py-2 w-full text-sm"
                value={form.secondServerOpp}
                onChange={(e) => setForm({ ...form, secondServerOpp: e.target.value })}
              >
                {oppPlayers.map((p) => (
                  <option key={p} value={p}>
                    {formName(p)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-2">3rd set format</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                    form.thirdSetMode === "full" ? "tdt-btn-ball" : "tdt-btn-outline"
                  }`}
                  onClick={() => setForm({ ...form, thirdSetMode: "full" })}
                >
                  Full Set
                </button>
                <button
                  className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                    form.thirdSetMode === "tb10" ? "tdt-btn-ball" : "tdt-btn-outline"
                  }`}
                  onClick={() => setForm({ ...form, thirdSetMode: "tb10" })}
                >
                  10-Point Tiebreak
                </button>
              </div>
              <p className="tdt-muted text-xs mt-2">
                {form.thirdSetMode === "full"
                  ? "Third set plays out normally, with a tiebreak at 6 games all."
                  : "Third set is replaced by a single tiebreak to 10, win by 2."}
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide tdt-muted mb-2">Track shot type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                    !form.trackShotType ? "tdt-btn-ball" : "tdt-btn-outline"
                  }`}
                  onClick={() => setForm({ ...form, trackShotType: false })}
                >
                  Off
                </button>
                <button
                  className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                    form.trackShotType ? "tdt-btn-ball" : "tdt-btn-outline"
                  }`}
                  onClick={() => setForm({ ...form, trackShotType: true })}
                >
                  On
                </button>
              </div>
              <p className="tdt-muted text-xs mt-2">
                When on, winners and errors also ask for forehand / backhand / volley / overhead.
              </p>
            </div>

            <button
              className="tdt-btn tdt-btn-ball rounded-xl px-4 py-3 w-full text-base tdt-display font-semibold"
              onClick={handleStart}
            >
              Start Match
            </button>
          </div>
        </div>

        {matchArchive.length > 0 && (
          <div className="tdt-panel rounded-2xl p-4">
            <button className="flex items-center justify-between w-full" onClick={() => setShowHistoryPanel(!showHistoryPanel)}>
              <span className="tdt-display font-semibold text-sm">Match History ({matchArchive.length})</span>
              {showHistoryPanel ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {showHistoryPanel && (
              <div className="mt-4 space-y-2 max-h-72 overflow-y-auto">
                {matchArchive.map((m) => (
                  <div key={m.id} className="tdt-panel2 rounded-lg px-3 py-2">
                    <div className="tdt-muted text-xs">{new Date(m.date).toLocaleDateString()}</div>
                    <div className="text-sm mt-0.5">
                      <span className={m.winner === "A" ? "tdt-team-a font-semibold" : ""}>{m.teamNames.A}</span>
                      <span className="tdt-muted"> vs </span>
                      <span className={m.winner === "B" ? "tdt-team-b font-semibold" : ""}>{m.teamNames.B}</span>
                    </div>
                    <div className="tdt-muted text-xs mt-0.5">
                      {m.teamNames[m.winner]} won · {m.finalScore}
                    </div>
                  </div>
                ))}
                <button
                  className="tdt-btn tdt-btn-outline rounded-lg px-3 py-2 text-xs w-full mt-2"
                  onClick={handleClearHistory}
                >
                  Clear History
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    );
  }

  // ---- MATCH SCREEN ----
  const server = state.winner ? null : currentServer(state);
  const serverTeam = server ? TEAM_OF[server] : null;
  const setsWonA = state.sets.filter((x) => (x.matchTB ? x.tbA > x.tbB : x.a > x.b)).length;
  const setsWonB = state.sets.length - setsWonA;

  const liveSet = state.winner
    ? null
    : {
        a: state.matchTB ? null : state.gamesA,
        b: state.matchTB ? null : state.gamesB,
        tbA: state.tiebreak || state.matchTB ? state.ptsA : null,
        tbB: state.tiebreak || state.matchTB ? state.ptsB : null,
        matchTB: state.matchTB,
        live: true,
      };
  const tiles = [...state.sets.map((s) => ({ ...s, live: false })), ...(liveSet ? [liveSet] : [])];

  const isDeuce = !state.tiebreak && !state.matchTB && state.ptsA >= 3 && state.ptsB >= 3 && state.ptsA === state.ptsB;
  const adTeam =
    !state.tiebreak && !state.matchTB && state.ptsA >= 3 && state.ptsB >= 3 && Math.abs(state.ptsA - state.ptsB) === 1
      ? state.ptsA > state.ptsB
        ? "A"
        : "B"
      : null;
  const labels = ["0", "15", "30", "40"];

  const currentSide = pointSide(state.ptsA, state.ptsB);
  const receiverTeam = serverTeam ? OPP[serverTeam] : null;
  const receiver = receiverTeam ? state.returnSides[receiverTeam][currentSide] : null;

  const finalScore = state.sets.map(setScoreString).join(", ");

  function buildExportText() {
    const lines = [];
    lines.push(`${state.teamNames.A} vs ${state.teamNames.B}`);
    if (state.winner) {
      lines.push(`Result: ${state.teamNames[state.winner]} won ${finalScore}`);
    } else {
      const liveStr = state.sets.map(setScoreString).concat(
        state.matchTB ? [`(in progress) ${state.ptsA}-${state.ptsB}`] : [`(in progress) ${state.gamesA}-${state.gamesB}`]
      ).join(", ");
      lines.push(`Score so far: ${liveStr}`);
    }
    lines.push("");
    lines.push("-- Match Statistics --");
    PLAYERS.forEach((p) => {
      const st = state.stats[p];
      lines.push(
        `${nameOf(state, p)}: 1st Serve ${pct(st.firstIn, st.firstAtt)}% | 2nd Serve ${pct(
          st.secondIn,
          st.secondAtt
        )}% | Aces ${st.aces} | DF ${st.doubleFaults} | Winners ${st.winners} | UE ${st.unforced} | FE ${st.forced}`
      );
    });
    if (state.trackShotType) {
      lines.push("");
      lines.push("-- Shot Breakdown --");
      PLAYERS.forEach((p) => {
        const shots = ["forehand", "backhand", "volley", "overhead", "forehandLob", "backhandLob", "dropShot"]
          .map((shot) => {
            const sh = state.stats[p].shots[shot];
            if (!sh.winners && !sh.unforced && !sh.forced) return null;
            return `${shot}: W${sh.winners}/UE${sh.unforced}/FE${sh.forced}`;
          })
          .filter(Boolean);
        if (shots.length) lines.push(`${nameOf(state, p)}: ${shots.join(", ")}`);
      });
    }
    lines.push("");
    lines.push("-- Point History --");
    state.pointLog.forEach((entry) => {
      if (entry.entryKind === "event") {
        const eventText =
          entry.eventType === "serverChange"
            ? `Server manually set to ${nameOf(state, entry.player)}`
            : `Return sides updated for ${state.teamNames[entry.team]}: Deuce ${nameOf(
                state,
                entry.deucePlayer
              )}, Ad ${nameOf(state, entry.adPlayer)}`;
        lines.push(`Set ${entry.setNumber} · ${entry.scoreLabel} · ${eventText}`);
        return;
      }
      const actionText =
        entry.type === "ace"
          ? `${nameOf(state, entry.server)} — Ace`
          : entry.type === "doubleFault"
          ? `${nameOf(state, entry.server)} — Double Fault`
          : entry.type === "winner"
          ? `${nameOf(state, entry.player)} — Winner${entry.shotType ? ` (${entry.shotType})` : ""}`
          : entry.type === "unforced"
          ? `${nameOf(state, entry.player)} — Unforced Error${entry.shotType ? ` (${entry.shotType})` : ""}`
          : `${nameOf(state, entry.player)} — Forced Error${entry.shotType ? ` (${entry.shotType})` : ""}`;
      const tagLabel = entry.tag === "match" ? " [MATCH]" : entry.tag === "set" ? " [SET]" : entry.tag === "game" ? " [GAME]" : "";
      lines.push(
        `Set ${entry.setNumber} · ${entry.scoreLabel} · ${nameOf(state, entry.server)} serving (${entry.side}) to ${nameOf(
          state,
          entry.receiver
        )} · ${actionText}${tagLabel}`
      );
    });
    return lines.join("\n");
  }

  function handleExport() {
    const text = buildExportText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopyStatus("copied");
          setTimeout(() => setCopyStatus("idle"), 2000);
        })
        .catch(() => {
          setCopyStatus("failed");
          setTimeout(() => setCopyStatus("idle"), 2000);
        });
    } else {
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 2000);
    }
  }

  const SHOT_TYPES = [
    { key: "forehand", label: "Forehand" },
    { key: "backhand", label: "Backhand" },
    { key: "volley", label: "Volley" },
    { key: "overhead", label: "Overhead" },
    { key: "forehandLob", label: "Forehand Lob" },
    { key: "backhandLob", label: "Backhand Lob" },
    { key: "dropShot", label: "Drop Shot" },
  ];

  function handleOutcomeTap(kind, player) {
    if (state.trackShotType) {
      setPendingOutcome({ kind, player });
    } else {
      dispatch({ type: "OUTCOME", payload: { kind, player, shotType: null } });
    }
  }

  function handleShotTypeTap(shotType) {
    if (!pendingOutcome) return;
    dispatch({ type: "OUTCOME", payload: { ...pendingOutcome, shotType } });
    setPendingOutcome(null);
  }

  const kindLabel = { winner: "Winner", unforced: "Unforced Error", forced: "Forced Error" };
  const kindClass = { winner: "tdt-btn-green", unforced: "tdt-btn-coral", forced: "tdt-btn-amber" };
  const outcomeDisabled = state.serveStage !== "outcome" || !!pendingOutcome;

  return (
    <div className="tdt-root min-h-screen w-full p-3 sm:p-5">
      {fontImport}
      <div className="max-w-lg mx-auto space-y-4">
        {/* Broadcast-style scoreboard */}
        <div className="tdt-panel rounded-2xl overflow-hidden sticky top-0 z-20 shadow-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="tdt-sb-head">
                <th className="text-left font-normal"></th>
                {tiles.map((t, i) => (
                  <th
                    key={i}
                    className={`tdt-display text-center font-normal text-xs px-2 py-1.5 ${t.live ? "tdt-sb-livehead" : "tdt-muted"}`}
                  >
                    {t.matchTB ? "MTB" : `SET ${i + 1}`}
                  </th>
                ))}
                <th className="tdt-display text-center font-normal text-xs px-2 py-1.5 tdt-muted">PTS</th>
              </tr>
            </thead>
            <tbody>
              {["A", "B"].map((team) => {
                const isServing = serverTeam === team;
                return (
                  <tr key={team} className={`tdt-sb-row ${isServing ? `tdt-sb-row-${team.toLowerCase()}` : ""}`}>
                    <td className="py-2 pl-3 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 flex-shrink-0 flex justify-center">
                          {isServing && <CircleDot size={10} className="tdt-dot" />}
                        </span>
                        <div className="min-w-0">
                          <div className={`tdt-display text-sm font-semibold truncate tdt-team-${team.toLowerCase()}`}>
                            {state.teamNames[team]}
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            {PLAYERS.filter((p) => TEAM_OF[p] === team).map((p, idx) => (
                              <React.Fragment key={p}>
                                {idx > 0 && <span className="tdt-muted">/</span>}
                                <button
                                  className={`truncate ${server === p ? `tdt-team-${team.toLowerCase()} font-semibold` : "tdt-muted"}`}
                                  onClick={() =>
                                    !state.winner &&
                                    !state.awaitingThirdSetFormat &&
                                    dispatch({ type: "SET_SERVER", payload: { player: p } })
                                  }
                                  disabled={!!state.winner || state.awaitingThirdSetFormat}
                                >
                                  {nameOf(state, p)}
                                </button>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    {tiles.map((t, i) => {
                      let main, sup;
                      if (t.matchTB) {
                        main = team === "A" ? t.tbA : t.tbB;
                        sup = null;
                      } else {
                        main = team === "A" ? t.a : t.b;
                        sup = null;
                        if (!t.live && t.tbA != null) {
                          const loserTeam = t.a > t.b ? "B" : "A";
                          if (team === loserTeam) sup = team === "A" ? t.tbA : t.tbB;
                        }
                      }
                      return (
                        <td
                          key={i}
                          className={`tdt-display text-center text-lg px-2 ${t.live ? "tdt-sb-livecol" : ""}`}
                        >
                          {main ?? "-"}
                          {sup != null && <sup className="tdt-muted text-xs ml-0.5">{sup}</sup>}
                        </td>
                      );
                    })}
                    <td className="px-2">
                      <div
                        className={`tdt-display text-center text-lg font-semibold rounded-md py-1 ${
                          !state.winner && !state.awaitingThirdSetFormat && !state.matchTB ? "tdt-sb-pts" : ""
                        }`}
                      >
                        {state.winner || state.awaitingThirdSetFormat
                          ? "-"
                          : state.matchTB
                          ? "-"
                          : state.tiebreak
                          ? team === "A"
                            ? state.ptsA
                            : state.ptsB
                          : isDeuce
                          ? "40"
                          : adTeam
                          ? adTeam === team
                            ? "AD"
                            : "40"
                          : labels[team === "A" ? state.ptsA : state.ptsB]}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="px-4 pb-4 pt-1">
            {!state.winner && !state.awaitingThirdSetFormat && (
              <div>
                {(state.tiebreak || state.matchTB) && (
                  <div className="tdt-muted text-xs mb-1 text-center">
                    {state.matchTB ? "Match tiebreak · first to 10" : "Tiebreak · first to 7"}
                  </div>
                )}
                <div className={`tdt-info-row-${serverTeam.toLowerCase()} rounded-lg px-3 py-2 mb-1.5 flex items-center gap-1.5`}>
                  <span className="w-3 flex-shrink-0 flex justify-center">
                    <CircleDot size={10} className="tdt-dot" />
                  </span>
                  <div className="min-w-0">
                    <div className="tdt-muted text-xs uppercase tracking-wide">Serving</div>
                    <div className={`tdt-display text-sm font-semibold truncate tdt-team-${serverTeam.toLowerCase()}`}>
                      {nameOf(state, server)}
                      {state.serveStage === "second" && (
                        <span className="tdt-muted text-xs font-normal"> · 2nd serve</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className={`tdt-info-row-${receiverTeam.toLowerCase()} rounded-lg px-3 py-2 flex items-center gap-1.5`}>
                  <span className="w-3 flex-shrink-0"></span>
                  <div className="min-w-0">
                    <div className="tdt-muted text-xs uppercase tracking-wide">Returning</div>
                    <div className={`tdt-display text-sm font-semibold truncate tdt-team-${receiverTeam.toLowerCase()}`}>
                      {nameOf(state, receiver)}
                      <span className="tdt-muted text-xs font-normal"> · {currentSide} court</span>
                    </div>
                  </div>
                </div>
                <div className="tdt-muted text-xs mt-1.5 text-center">tap a player name above to change the server</div>
              </div>
            )}

            {!state.winner && state.awaitingThirdSetFormat && (
              <div className="text-center py-2">
                <div className="tdt-display text-lg">Sets are tied 1-1</div>
                <div className="tdt-muted text-xs mt-1">Choose the deciding-set format below to continue</div>
              </div>
            )}

            {state.winner && (
              <div className="text-center py-2">
                <Trophy size={36} className="mx-auto mb-2 tdt-dot animate-bounce" style={{ animationIterationCount: 3 }} />
                <div className="tdt-display text-2xl font-semibold mb-1">
                  {state.teamNames[state.winner]} wins the match
                </div>
                <div className="tdt-muted text-sm">{finalScore}</div>
              </div>
            )}
          </div>
        </div>


        {/* third-set format chooser */}
        {!state.winner && state.awaitingThirdSetFormat && (
          <div className="tdt-panel rounded-2xl p-4">
            <div className="tdt-display font-semibold text-sm mb-1">Deciding set format</div>
            <div className="tdt-muted text-xs mb-3">
              Sets are tied 1-1. Pick how the 3rd set will be played.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="tdt-btn tdt-btn-ball rounded-xl px-4 py-3 text-sm"
                onClick={() => dispatch({ type: "CHOOSE_THIRD_SET_FORMAT", payload: { mode: "full" } })}
              >
                Full Set
              </button>
              <button
                className="tdt-btn tdt-btn-outline rounded-xl px-4 py-3 text-sm"
                onClick={() => dispatch({ type: "CHOOSE_THIRD_SET_FORMAT", payload: { mode: "tb10" } })}
              >
                10-Point Tiebreak
              </button>
            </div>
          </div>
        )}

        {/* controls */}
        {!state.winner && !state.awaitingThirdSetFormat && (
          <div className="tdt-panel rounded-2xl p-4 space-y-4">
            {/* first serve */}
            <div className="grid grid-cols-2 gap-3">
              <button
                className="tdt-btn tdt-btn-ball rounded-xl px-4 py-3 text-sm disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => dispatch({ type: "FIRST_IN" })}
                disabled={state.serveStage !== "first"}
              >
                1st Serve In
              </button>
              <button
                className="tdt-btn tdt-btn-outline rounded-xl px-4 py-3 text-sm disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => dispatch({ type: "FIRST_FAULT" })}
                disabled={state.serveStage !== "first"}
              >
                1st Serve Fault
              </button>
            </div>

            {/* second serve */}
            <div className="grid grid-cols-2 gap-3">
              <button
                className="tdt-btn tdt-btn-ball rounded-xl px-4 py-3 text-sm disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => dispatch({ type: "SECOND_IN" })}
                disabled={state.serveStage !== "second"}
              >
                2nd Serve In
              </button>
              <button
                className="tdt-btn tdt-btn-coral rounded-xl px-4 py-3 text-sm disabled:opacity-30 disabled:pointer-events-none"
                onClick={() => dispatch({ type: "DOUBLE_FAULT" })}
                disabled={state.serveStage !== "second"}
              >
                Double Fault
              </button>
            </div>

            {/* ace + outcome grid */}
            {!pendingOutcome && (
              <div className="space-y-3">
                <button
                  className="tdt-btn tdt-btn-green rounded-lg px-4 py-2.5 w-full text-sm disabled:opacity-30 disabled:pointer-events-none"
                  onClick={() => dispatch({ type: "ACE" })}
                  disabled={outcomeDisabled}
                >
                  Ace
                </button>
                <div className={`grid grid-cols-2 gap-3 ${outcomeDisabled ? "opacity-40" : ""}`}>
                  {["A", "B"].map((team) => (
                    <div key={team} className={`rounded-xl p-3 tdt-panel2 border-t-2 tdt-border-${team.toLowerCase()}`}>
                      <div className={`text-xs font-semibold mb-2 tdt-team-${team.toLowerCase()}`}>{state.teamNames[team]}</div>
                      {PLAYERS.filter((p) => TEAM_OF[p] === team).map((p) => (
                        <div key={p} className="mb-2 last:mb-0">
                          <div className="text-xs tdt-muted mb-1 truncate">{nameOf(state, p)}</div>
                          <div className="flex gap-1">
                            <button
                              className="tdt-btn tdt-btn-green rounded px-1.5 py-1.5 flex-1 text-xs disabled:pointer-events-none"
                              onClick={() => handleOutcomeTap("winner", p)}
                              disabled={outcomeDisabled}
                            >
                              Winner
                            </button>
                            <button
                              className="tdt-btn tdt-btn-coral rounded px-1.5 py-1.5 flex-1 text-xs disabled:pointer-events-none"
                              onClick={() => handleOutcomeTap("unforced", p)}
                              disabled={outcomeDisabled}
                            >
                              UE
                            </button>
                            <button
                              className="tdt-btn tdt-btn-amber rounded px-1.5 py-1.5 flex-1 text-xs disabled:pointer-events-none"
                              onClick={() => handleOutcomeTap("forced", p)}
                              disabled={outcomeDisabled}
                            >
                              FE
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* shot type */}
            {state.trackShotType && pendingOutcome && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs min-w-0">
                    <span className="truncate block">
                      <span className="tdt-display font-semibold">{kindLabel[pendingOutcome.kind]}</span>
                      <span className="tdt-muted"> — {nameOf(state, pendingOutcome.player)} · pick the shot</span>
                    </span>
                  </div>
                  <button
                    className="tdt-btn tdt-btn-outline rounded-lg px-2 py-1 text-xs flex-shrink-0"
                    onClick={() => setPendingOutcome(null)}
                  >
                    Back
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {SHOT_TYPES.map((shot) => (
                    <button
                      key={shot.key}
                      className={`tdt-btn ${kindClass[pendingOutcome.kind]} rounded-lg px-4 py-3 text-sm`}
                      onClick={() => handleShotTypeTap(shot.key)}
                    >
                      {shot.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* undo */}
        <button
          className="tdt-btn tdt-btn-outline rounded-xl px-4 py-2.5 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-30"
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={state.history.length === 0}
        >
          <Undo2 size={15} /> Undo
        </button>

        {/* point history log */}
        <div className="tdt-panel rounded-2xl p-4">
          <button className="flex items-center justify-between w-full" onClick={() => setShowLog(!showLog)}>
            <span className="tdt-display font-semibold text-sm">Point History ({state.pointLog.length})</span>
            {showLog ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showLog && (
            <div className="mt-4 max-h-80 overflow-y-auto space-y-2">
              {state.pointLog.length === 0 && <div className="tdt-muted text-xs">No points recorded yet.</div>}
              {[...state.pointLog].reverse().map((entry) => {
                if (entry.entryKind === "event") {
                  const eventText =
                    entry.eventType === "serverChange"
                      ? `Server manually set to ${nameOf(state, entry.player)}`
                      : `Return sides updated for ${state.teamNames[entry.team]}: Deuce — ${nameOf(
                          state,
                          entry.deucePlayer
                        )}, Ad — ${nameOf(state, entry.adPlayer)}`;
                  return (
                    <div
                      key={entry.seq}
                      className="tdt-panel2 rounded-lg px-3 py-2 flex items-center gap-2"
                      style={{ borderLeft: "2px dashed rgba(255,255,255,0.2)" }}
                    >
                      <div className="min-w-0">
                        <div className="tdt-muted text-xs">
                          Set {entry.setNumber} · {entry.scoreLabel}
                        </div>
                        <div className="text-xs mt-0.5 tdt-muted italic truncate">{eventText}</div>
                      </div>
                    </div>
                  );
                }
                const actionText =
                  entry.type === "ace"
                    ? `${nameOf(state, entry.server)} — Ace`
                    : entry.type === "doubleFault"
                    ? `${nameOf(state, entry.server)} — Double Fault`
                    : entry.type === "winner"
                    ? `${nameOf(state, entry.player)} — Winner${entry.shotType ? ` (${entry.shotType})` : ""}`
                    : entry.type === "unforced"
                    ? `${nameOf(state, entry.player)} — Unforced Error${entry.shotType ? ` (${entry.shotType})` : ""}`
                    : `${nameOf(state, entry.player)} — Forced Error${entry.shotType ? ` (${entry.shotType})` : ""}`;
                const tagLabel = entry.tag === "match" ? "Match" : entry.tag === "set" ? "Set" : entry.tag === "game" ? "Game" : null;
                return (
                  <div key={entry.seq} className="tdt-panel2 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="tdt-muted text-xs">
                        Set {entry.setNumber} · {entry.scoreLabel} · {nameOf(state, entry.server)} serving ({entry.side}) to{" "}
                        {nameOf(state, entry.receiver)}
                      </div>
                      <div className="text-xs mt-0.5 truncate">{actionText}</div>
                    </div>
                    {tagLabel && (
                      <span className="tdt-btn-ball rounded-full px-2 py-0.5 text-xs whitespace-nowrap" style={{ flexShrink: 0 }}>
                        {tagLabel}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* stats */}
        <div className="tdt-panel rounded-2xl p-4">
          <button className="flex items-center justify-between w-full" onClick={() => setShowStats(!showStats)}>
            <span className="tdt-display font-semibold text-sm">Match Statistics</span>
            {showStats ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showStats && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="tdt-muted text-left">
                    <th className="pb-2 pr-2 font-medium">Player</th>
                    <th className="pb-2 px-2 font-medium text-center">1st Serve%</th>
                    <th className="pb-2 px-2 font-medium text-center">2nd Serve%</th>
                    <th className="pb-2 px-2 font-medium text-center">Aces</th>
                    <th className="pb-2 px-2 font-medium text-center">DF</th>
                    <th className="pb-2 px-2 font-medium text-center">Winners</th>
                    <th className="pb-2 px-2 font-medium text-center">UE</th>
                    <th className="pb-2 pl-2 font-medium text-center">FE</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAYERS.map((p) => {
                    const st = state.stats[p];
                    return (
                      <tr key={p} className="border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                        <td className={`py-2 pr-2 font-medium tdt-team-${TEAM_OF[p].toLowerCase()}`}>{nameOf(state, p)}</td>
                        <td className="py-2 px-2 text-center">{pct(st.firstIn, st.firstAtt)}%</td>
                        <td className="py-2 px-2 text-center">{pct(st.secondIn, st.secondAtt)}%</td>
                        <td className="py-2 px-2 text-center">{st.aces}</td>
                        <td className="py-2 px-2 text-center">{st.doubleFaults}</td>
                        <td className="py-2 px-2 text-center">{st.winners}</td>
                        <td className="py-2 px-2 text-center">{st.unforced}</td>
                        <td className="py-2 pl-2 text-center">{st.forced}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {showStats && state.trackShotType && (
            <div className="mt-5 space-y-4">
              <div className="tdt-display text-xs font-semibold">Shot Breakdown</div>
              {PLAYERS.map((p) => {
                const rows = SHOT_TYPES.map((s) => s.key).filter((shot) => {
                  const sh = state.stats[p].shots[shot];
                  return sh.winners || sh.unforced || sh.forced;
                });
                if (rows.length === 0) return null;
                return (
                  <div key={p} className="overflow-x-auto">
                    <div className={`text-xs font-medium mb-1 tdt-team-${TEAM_OF[p].toLowerCase()}`}>{nameOf(state, p)}</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="tdt-muted text-left">
                          <th className="pb-1 pr-2 font-medium">Shot</th>
                          <th className="pb-1 px-2 font-medium text-center">Winners</th>
                          <th className="pb-1 px-2 font-medium text-center">UE</th>
                          <th className="pb-1 pl-2 font-medium text-center">FE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((shot) => {
                          const sh = state.stats[p].shots[shot];
                          const shotLabel = SHOT_TYPES.find((s) => s.key === shot)?.label || shot;
                          return (
                            <tr key={shot} className="border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                              <td className="py-1.5 pr-2 tdt-muted">{shotLabel}</td>
                              <td className="py-1.5 px-2 text-center">{sh.winners}</td>
                              <td className="py-1.5 px-2 text-center">{sh.unforced}</td>
                              <td className="py-1.5 pl-2 text-center">{sh.forced}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {PLAYERS.every((p) =>
                SHOT_TYPES.map((s) => s.key).every((shot) => {
                  const sh = state.stats[p].shots[shot];
                  return !sh.winners && !sh.unforced && !sh.forced;
                })
              ) && <p className="tdt-muted text-xs">No shot-tagged points recorded yet.</p>}
            </div>
          )}
        </div>

        {/* match settings */}
        <div className="tdt-panel rounded-2xl p-4">
          <button className="flex items-center justify-between w-full" onClick={() => setShowReturnSettings(!showReturnSettings)}>
            <span className="tdt-display font-semibold text-sm">Match Settings</span>
            {showReturnSettings ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
          {showReturnSettings && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide tdt-muted mb-2">Return positions</div>
                <div className="grid grid-cols-2 gap-3">
                  {["A", "B"].map((team) => {
                    const deuceP = state.returnSides[team].deuce;
                    const adP = state.returnSides[team].ad;
                    return (
                      <div key={team} className="tdt-panel2 rounded-lg p-3">
                        <div className={`text-xs font-semibold mb-2 tdt-team-${team.toLowerCase()}`}>
                          {state.teamNames[team]}
                        </div>
                        <div className="text-xs tdt-muted mb-0.5">Deuce: {nameOf(state, deuceP)}</div>
                        <div className="text-xs tdt-muted mb-2">Ad: {nameOf(state, adP)}</div>
                        <button
                          className="tdt-btn tdt-btn-outline rounded-lg px-2 py-1.5 w-full text-xs"
                          onClick={() => dispatch({ type: "SET_RETURN_SIDE", payload: { team, deucePlayer: adP } })}
                        >
                          Swap Sides
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide tdt-muted mb-2">3rd set format</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`tdt-btn rounded-lg px-3 py-2 text-sm disabled:opacity-30 disabled:pointer-events-none ${
                      state.thirdSetMode === "full" ? "tdt-btn-ball" : "tdt-btn-outline"
                    }`}
                    onClick={() => dispatch({ type: "SET_THIRD_SET_MODE", payload: { mode: "full" } })}
                    disabled={state.sets.length >= 2}
                  >
                    Full Set
                  </button>
                  <button
                    className={`tdt-btn rounded-lg px-3 py-2 text-sm disabled:opacity-30 disabled:pointer-events-none ${
                      state.thirdSetMode === "tb10" ? "tdt-btn-ball" : "tdt-btn-outline"
                    }`}
                    onClick={() => dispatch({ type: "SET_THIRD_SET_MODE", payload: { mode: "tb10" } })}
                    disabled={state.sets.length >= 2}
                  >
                    10-Point Tiebreak
                  </button>
                </div>
                <p className="tdt-muted text-xs mt-2">
                  {state.sets.length >= 2
                    ? "The deciding set has already started, so this can't change now."
                    : "Applies if the match reaches a 3rd set."}
                </p>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wide tdt-muted mb-2">Track shot type</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                      !state.trackShotType ? "tdt-btn-ball" : "tdt-btn-outline"
                    }`}
                    onClick={() => state.trackShotType && dispatch({ type: "TOGGLE_SHOT_TRACKING" })}
                  >
                    Off
                  </button>
                  <button
                    className={`tdt-btn rounded-lg px-3 py-2 text-sm ${
                      state.trackShotType ? "tdt-btn-ball" : "tdt-btn-outline"
                    }`}
                    onClick={() => !state.trackShotType && dispatch({ type: "TOGGLE_SHOT_TRACKING" })}
                  >
                    On
                  </button>
                </div>
                <p className="tdt-muted text-xs mt-2">Ask forehand / backhand / volley / overhead</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  className="tdt-btn tdt-btn-outline rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-2"
                  onClick={handleExport}
                >
                  {copyStatus === "copied" ? (
                    <>
                      <Check size={15} /> Copied
                    </>
                  ) : copyStatus === "failed" ? (
                    <>Copy failed</>
                  ) : (
                    <>
                      <Copy size={15} /> Export to Clipboard
                    </>
                  )}
                </button>
                <button
                  className="tdt-btn tdt-btn-coral rounded-xl px-4 py-2.5 text-sm flex items-center justify-center gap-2"
                  onClick={async () => {
                    try {
                      await storage.delete("current-match");
                    } catch (e) {}
                    dispatch({ type: "RESET" });
                  }}
                >
                  <RotateCcw size={15} /> New Match
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
