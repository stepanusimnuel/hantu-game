document.addEventListener("DOMContentLoaded", () => {
  const socket = io();

  const statusEl = document.getElementById("status");
  const handEl = document.getElementById("yourHand");
  const logEl = document.getElementById("log");
  const startBtn = document.getElementById("startBtn");
  const setNameBtn = document.getElementById("setNameBtn");
  const nameInput = document.getElementById("nameInput");

  let myId = null;
  let myName = null;

  function log(msg) {
    const now = new Date().toLocaleTimeString();
    logEl.textContent += `[${now}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }

  socket.on("connect", () => {
    log("Connected to server (socket id: " + socket.id + ")");
    statusEl.textContent = "Connected — waiting...";
  });

  socket.on("joined", (data) => {
    myId = data.id;
    myName = data.name;
    statusEl.textContent = `Connected as ${myName} (${myId})`;
    log(`You joined as ${myName}`);
  });

  setNameBtn.addEventListener("click", () => {
    const v = nameInput.value.trim();
    if (!v) {
      alert("Masukkan nama terlebih dahulu");
      return;
    }
    socket.emit("set_name", { name: v });
  });

  socket.on("name_set", (data) => {
    if (data.success) {
      myName = data.name;
      statusEl.textContent = `Connected as ${myName} (${myId})`;
      log(`Name set to ${myName}`);
      nameInput.value = "";
    }
  });

  startBtn.addEventListener("click", () => {
    log("Requesting start_game...");
    socket.emit("start_game");
  });

  socket.on("error_msg", (m) => {
    log("[server error] " + m);
    alert(m);
  });

  socket.on("game_started", (info) => {
    log("Game started — pairs removed on server side");
    // langsung render pemain & hand
    if (info.players) renderPlayers(info.players, myId);
    animateDealing(info.players, myId);
    if (info.pairRemovalSummary) {
      info.pairRemovalSummary.forEach((s) => {
        log(`${s.name} discarded ${s.discarded.length} cards as pairs`);
      });
    }

    socket.emit("request_opponents_hand");
  });

  socket.on("your_hand", (data) => {
    renderYourHand(data.hand);
  });

  socket.on("room_update", (data) => {
    const players = data.players.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.cardCount ?? 0,
    }));
    renderPlayers(players, myId);
  });

  socket.on("opponents_summary", (data) => {
    const players = data.map((p) => ({
      id: p.id,
      name: p.name,
      cardCount: p.cardCount,
    }));
    renderPlayers(players, myId);
  });

  socket.on("turn_update", (data) => {
    const currentTurn = data.currentTurn;
    data.players.forEach((p) => {
      // renderOpponentHand(p, currentTurn === myId && p.id !== myId);
    });
    log(`Giliran: ${currentTurn}`);
  });

  socket.on("disconnect", () => {
    log("Disconnected from server");
    statusEl.textContent = "Disconnected";
  });

  function renderYourHand(hand) {
    console.log("adsad");
    handEl.innerHTML = "";
    if (!hand || hand.length === 0) {
      handEl.textContent = "(no cards)";
      return;
    }
    hand.forEach((c) => {
      const d = document.createElement("div");
      d.className = "card";
      d.textContent = `${c.rank}${c.suit === "joker" ? " 👻" : c.suit}`;
      handEl.appendChild(d);
    });
  }

  function renderPlayers(players, myId) {
    const container = document.getElementById("playersContainer");
    container.innerHTML = "";

    const n = players.length;
    const radius = 200;
    const centerX = 300;
    const centerY = 300;

    players.forEach((p, i) => {
      const slot = document.createElement("div");
      slot.className = "playerSlot";
      slot.dataset.id = p.id;

      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);

      slot.style.left = `${cx - 80}px`;
      slot.style.top = `${cy - 50}px`;

      slot.innerHTML = `
      <img class="avatar" src="avatar.png" />
      <div class="info">
        <span class="name">${p.name}${p.id === myId ? " (You)" : ""}</span><br>
        <span class="cards">${p.cardCount ?? 0} cards</span>
      </div>
      <div class="opponentCards"></div>
    `;

      // Render kartu lawan kalau bukan saya
      if (p.id !== myId) {
        const oppContainer = slot.querySelector(".opponentCards");
        for (let k = 0; k < p.cardCount; k++) {
          const cardEl = document.createElement("div");
          cardEl.className = "card back";
          cardEl.dataset.index = k;

          cardEl.addEventListener("click", () => {
            socket.emit("draw_card", { from: p.id, index: k });
          });

          oppContainer.appendChild(cardEl);
        }
      }

      container.appendChild(slot);
    });
  }
});

function renderOpponentHand(player, isMyTurn) {
  const container = document.getElementById("playersContainer");
  const slot = container.querySelector(`.playerSlot[data-id="${player.id}"]`);
  if (!slot) return;

  // render jumlah kartu lawan
  slot.querySelector(".cards").innerHTML = "";
  for (let i = 0; i < player.cardCount; i++) {
    const cardEl = document.createElement("div");
    cardEl.className = "card back";
    cardEl.dataset.index = i;

    if (isMyTurn) {
      // hanya giliran saya bisa klik
      data.opponentsHands.forEach((op) => {
        const opDiv = document.createElement("div");
        opDiv.className = "opponentHand";
        opDiv.dataset.id = op.id;

        op.cards.forEach((c, idx) => {
          const cardEl = document.createElement("div");
          cardEl.className = "card back";
          cardEl.dataset.index = idx;

          cardEl.addEventListener("click", () => {
            socket.emit("draw_card", { from: op.id, index: idx });
          });

          opDiv.appendChild(cardEl);
        });
      });
    }

    slot.querySelector(".cards").appendChild(cardEl);
  }
}

// pangkas/replace implementasi animasi lama dengan yang ini
function animateDealing(players, myId, onDone) {
  const table = document.getElementById("table");
  const deck = document.getElementById("centerDeck");
  if (!table || !deck) {
    if (onDone) onDone();
    return;
  }

  const tableRect = table.getBoundingClientRect();
  const deckRect = deck.getBoundingClientRect();

  const CARD_W = 40;
  const CARD_H = 60;

  // posisi awal (di tengah deck) relatif ke table
  const startX = deckRect.left - tableRect.left + deckRect.width / 2 - CARD_W / 2;
  const startY = deckRect.top - tableRect.top + deckRect.height / 2 - CARD_H / 2;

  // pastikan semua opponentCards kosong dulu supaya kita bisa "menaruh" kartu setelah animasi
  players.forEach((p) => {
    const slot = document.querySelector(`.playerSlot[data-id="${p.id}"]`);
    if (slot) {
      const opp = slot.querySelector(".opponentCards");
      if (opp) opp.innerHTML = "";
    }
  });

  // order round-robin: cari max count dan bagi per ronde
  const maxCards = Math.max(...players.map((p) => p.cardCount || 0));
  let delay = 0;
  const perCardDelay = 120; // ms antar kartu

  for (let round = 0; round < maxCards; round++) {
    for (let pi = 0; pi < players.length; pi++) {
      const p = players[pi];
      if (!p || (p.cardCount || 0) <= round) continue;

      // snapshot slot & rect sekarang (DOM harus sudah ada)
      const slot = document.querySelector(`.playerSlot[data-id="${p.id}"]`);
      if (!slot) continue;
      const slotRect = slot.getBoundingClientRect();

      // posisi target relatif ke table (pusat slot, dikurangi half card agar center)
      const targetX = slotRect.left - tableRect.left + slotRect.width / 2 - CARD_W / 2;
      const targetY = slotRect.top - tableRect.top + slotRect.height / 2 - CARD_H / 2;

      // schedule animasi tiap kartu
      setTimeout(() => {
        // flying card (temp)
        const flying = document.createElement("div");
        flying.className = "card dealAnim back";
        flying.style.position = "absolute";
        flying.style.left = `${startX}px`;
        flying.style.top = `${startY}px`;
        flying.style.width = `${CARD_W}px`;
        flying.style.height = `${CARD_H}px`;
        flying.style.zIndex = 2000;
        table.appendChild(flying);

        // trigger move in next frame
        requestAnimationFrame(() => {
          // translate delta (target - start)
          const dx = targetX - startX;
          const dy = targetY - startY;
          flying.style.transform = `translate(${dx}px, ${dy}px)`;
          flying.style.opacity = "0.95";
        });

        // after animation remove flying and append one back-card to slot's .opponentCards
        setTimeout(() => {
          flying.remove();
          const opp = slot.querySelector(".opponentCards");
          if (opp) {
            const back = document.createElement("div");
            back.className = "card back";
            // dataset-index real bisa disesuaikan nanti oleh server; untuk UI ini kita hanya menampilkan back
            back.dataset.index = opp.children.length;
            // jangan pasang click handler di sini — clickable logic tetap harus dikontrol oleh turn/permission
            opp.appendChild(back);
          }
        }, 500); // harus sama/lebih besar dari transition duration di CSS
      }, delay);

      delay += perCardDelay;
    }
  }

  // setelah semua kartu 'dibagikan', sembunyikan tumpukan tengah
  setTimeout(() => {
    deck.style.transition = "opacity 0.35s ease";
    deck.style.opacity = "0";
    setTimeout(() => {
      deck.style.display = "none";
      if (typeof onDone === "function") onDone();
    }, 400);
  }, delay + 80);
}
