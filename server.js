// server.js (perbaikan kecil + lebih banyak log)
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const ROOM_ID = "booth";
const room = {
  id: ROOM_ID,
  players: [],
  status: "waiting",
};

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  let idCounter = 1;
  for (const s of suits) {
    for (const r of ranks) {
      deck.push({ id: `c${idCounter++}`, suit: s, rank: r });
    }
  }
  deck.push({ id: `c${idCounter++}`, suit: "joker", rank: "JOKER" });
  return deck;
}
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function broadcastRoomUpdate() {
  io.to(room.id).emit("room_update", {
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand ? p.hand.length : 0, // <-- kirim jumlah kartu juga
    })),
  });
}

function broadcastOpponentsSummary() {
  io.to(room.id).emit(
    "opponents_summary",
    room.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length, // jumlah kartu yang tersisa
    }))
  );
}

function broadcastOpponentsHands() {
  room.players.forEach((p) => {
    const opponentsHands = room.players
      .filter((o) => o.id !== p.id)
      .map((o) => ({
        id: o.id,
        // kirim jumlah kartu terbaru, jangan pakai array lama
        cards: o.hand.map(() => ({ back: true })),
      }));
    io.to(p.socketId).emit("your_opponents_hand", { opponentsHands });
  });
}

io.on("connection", (socket) => {
  console.log("[server] connected:", socket.id);

  // create player object and add to room
  const defaultName = `Player${room.players.length + 1}`;
  const player = { id: socket.id, name: defaultName, socketId: socket.id, hand: [] };
  room.players.push(player);
  socket.join(room.id);

  console.log(`[server] added player ${player.id} as '${player.name}'`);
  // explicitly emit joined with name
  io.to(socket.id).emit("joined", { id: socket.id, name: player.name });
  broadcastRoomUpdate();

  socket.on("set_name", ({ name }) => {
    const old = player.name;
    player.name = name && name.trim().length ? name.trim() : player.name;
    console.log(`[server] player ${player.id} changed name '${old}' -> '${player.name}'`);
    broadcastRoomUpdate();
    io.to(player.socketId).emit("name_set", { success: true, name: player.name });
  });

  socket.on("start_game", () => {
    console.log(`[server] start_game requested by ${socket.id}`);
    if (room.players.length < 2) {
      io.to(socket.id).emit("error_msg", "Need at least 2 players to start");
      return;
    }
    room.players.forEach((p) => (p.hand = []));
    room.currentTurn = room.players[0]?.id || null;
    startGame();
  });

  socket.on("disconnect", () => {
    console.log("[server] disconnect:", socket.id);
    const idx = room.players.findIndex((p) => p.id === socket.id);
    if (idx >= 0) {
      console.log(`[server] removing player ${room.players[idx].id} (${room.players[idx].name})`);
      room.players.splice(idx, 1);
      broadcastRoomUpdate();
    }
  });

  // Saat client meminta lawan
  socket.on("request_opponents_hand", () => {
    const p = room.players.find((p) => p.id === socket.id);
    if (!p) return;
    const opponentsHands = room.players
      .filter((o) => o.id !== p.id)
      .map((o) => ({
        id: o.id,
        cardCount: o.hand.length,
        cards: o.hand.map(() => ({ back: true })),
      }));
  });

  socket.on("draw_card", ({ from, index }) => {
    const currentPlayer = room.players.find((p) => p.id === room.currentTurn);
    if (!currentPlayer || currentPlayer.id !== socket.id) return;

    const target = room.players.find((p) => p.id === from);
    if (!target || index < 0 || index >= target.hand.length) return;

    // Ambil kartu
    const card = target.hand.splice(index, 1)[0];
    currentPlayer.hand.push(card);

    // Hapus pair jika ada
    const { newHand } = removePairsFromHand(currentPlayer.hand);
    currentPlayer.hand = newHand;

    // Kirim hand terbaru ke pemain terkait
    io.to(currentPlayer.socketId).emit("your_hand", { hand: currentPlayer.hand });
    io.to(target.socketId).emit("your_hand", { hand: target.hand });

    // **Broadcast lawan update** menggunakan hand terbaru
    broadcastOpponentsHands();
    broadcastOpponentsSummary();
    broadcastRoomUpdate();

    // Giliran berikutnya
    room.currentTurn = getNextPlayerId(currentPlayer.id);
    const nextTarget = getNextPlayerId(room.currentTurn);
    io.to(room.id).emit("turn_update", {
      currentTurn: room.currentTurn,
      targetId: nextTarget,
      players: room.players.map((p) => ({ id: p.id, name: p.name, cardCount: p.hand.length })),
    });
  });
});

function getNextPlayerId(currentId) {
  const idx = room.players.findIndex((p) => p.id === currentId);
  if (idx === -1) return null;
  return room.players[(idx + 1) % room.players.length].id;
}

function startGame() {
  console.log("[server] Starting game...");
  room.status = "playing";
  room.currentTurn = room.players[0].id;
  const deck = createDeck();
  shuffle(deck);

  // deal round-robin (full hand)
  room.players.forEach((p) => (p.hand = []));
  let i = 0;
  while (deck.length > 0) {
    const card = deck.shift();
    room.players[i % room.players.length].hand.push(card);
    i++;
  }

  // hitung pasangan (tapi jangan ubah p.hand sekarang) — simpan finalHand pada temp store
  const summary = [];
  for (const p of room.players) {
    const { newHand, discarded } = removePairsFromHand(p.hand);
    p.hand = newHand;
    summary.push({ id: p.id, name: p.name, discarded });
  }

  for (const p of room.players) {
    io.to(p.socketId).emit("your_hand", { hand: p.hand });
  }

  io.to(room.id).emit("game_started", {
    pairRemovalSummary: summary.map((s) => ({
      id: s.id,
      name: s.name,
      discarded: s.discarded,
    })),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.hand.length, // jumlah saat dealing (full)
    })),
  });

  io.to(room.id).emit(
    "opponents_summary",
    room.players.map((p) => ({ id: p.id, name: p.name, cardCount: p.hand.length }))
  );

  // kirim hand masing-masing player
  room.players.forEach((p) => {
    io.to(p.socketId).emit("your_hand", { hand: p.hand });
  });

  // broadcast summary lawan (jumlah kartu)
  broadcastOpponentsSummary();
  broadcastOpponentsHands();

  broadcastRoomUpdate();
}

// Buang pair dari hand
// Input: hand = [{id, suit, rank}, ...]
// Output: { newHand: [...], discarded: [...] }
function removePairsFromHand(hand) {
  const counts = {};
  hand.forEach((c) => {
    const key = c.rank === "JOKER" ? c.id : c.rank; // Joker unik, jangan di-pair
    if (!counts[key]) counts[key] = [];
    counts[key].push(c);
  });

  const newHand = [];
  const discarded = [];

  Object.values(counts).forEach((cards) => {
    if (cards.length % 2 === 0) {
      // semua kartu dalam pair dibuang
      discarded.push(...cards);
    } else {
      // jika ganjil, sisakan 1 kartu
      discarded.push(...cards.slice(0, cards.length - 1));
      newHand.push(cards[cards.length - 1]);
    }
  });

  return { newHand, discarded };
}

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
