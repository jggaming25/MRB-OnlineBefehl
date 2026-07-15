// ---------- Konstanten ----------
const ROLE_LABEL = { tf: "Tf", fdl: "Fdl", hr: "HR" };
const STATUS_LABEL = {
  FREIGEGEBEN: "Freigegeben",
  STANDORT_GESENDET: "Standort gesendet",
  STANDORT_BESTAETIGT: "Gültig",
  ABGESCHLOSSEN: "Abgeschlossen",
  UNGUELTIG: "Ungültig"
};

const NAV_ITEMS = [
  { hash: "#/start", label: "Start", roles: ["tf", "fdl", "hr"], desc: "Übersicht und Rollen-Erklärung." },
  { hash: "#/erstellen", label: "Befehl erstellen", roles: ["fdl", "hr"], desc: "Neuen Befehl anlegen und sofort freigeben." },
  { hash: "#/alle", label: "Alle Befehle", roles: ["fdl", "hr"], desc: "Alle laufenden und abgeschlossenen Befehle einsehen." },
  { hash: "#/archiv", label: "Archiv", roles: ["hr"], desc: "Alle Befehle schreibgeschützt mit aktuellem Stand einsehen." },
  { hash: "#/benutzer", label: "Benutzer", roles: ["hr"], desc: "Benutzerkonten anlegen und verwalten." },
  { hash: "#/abrufen", label: "Befehl abrufen", roles: ["tf", "hr"], desc: "Einen Befehl per Zugnummer und Anzeige-Code abrufen." },
  { hash: "#/meine", label: "Meine Befehle", roles: ["fdl", "hr"], desc: "Die von dir erstellten Befehle einsehen." },
  { href: "ris.html", label: "Online Fahrplan", roles: ["tf", "fdl", "hr"], desc: "Bahnhöfe, Zugsuche, Meldungen und Fahrtverläufe einsehen." },
];

let currentUser = null;
let currentProfile = null;
let allCommandsInterval = null;
let detailUnsub = null;
let protokollUnsub = null;

const appEl = document.getElementById("app");

// ---------- Hilfsfunktionen ----------
function fmtDate(ms) {
  if (!ms) return "–";
  return new Date(ms).toLocaleString("de-DE");
}
function genBefehlsnummer() {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `OB-${ymd}-${rand}`;
}
function genAccessCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function genUniqueAccessCode() {
  for (let i = 0; i < 25; i++) {
    const code = genAccessCode();
    const snap = await db.collection("commands").where("zugriffscode", "==", code).get();
    const collision = snap.docs.some(d => d.data().status !== "ABGESCHLOSSEN");
    if (!collision) return code;
  }
  throw new Error("Konnte keinen eindeutigen Anzeige-Code erzeugen. Bitte erneut versuchen.");
}
function genTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}
function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// ---------- Auth ----------
auth.onAuthStateChanged(async (user) => {
  stopAllCommandsPolling();
  stopDetailListeners();
  if (!user) {
    currentUser = null;
    currentProfile = null;
    renderNav();
    renderUserBadge();
    location.hash = "#/login";
    route();
    return;
  }
  currentUser = user;
  try {
    const snap = await db.collection("users").doc(user.uid).get();
    if (!snap.exists) {
      await auth.signOut();
      alert("Zu diesem Konto existiert kein Benutzerprofil mehr. Bitte wende dich an einen HR.");
      return;
    }
    currentProfile = { uid: user.uid, ...snap.data() };
  } catch (e) {
    console.error(e);
    return;
  }
  renderNav();
  renderUserBadge();
  if (currentProfile.mustChangePassword) {
    renderForcePassword();
  } else {
    if (location.hash === "#/login" || !location.hash) location.hash = "#/start";
    route();
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "loginForm") { e.preventDefault(); doLogin(); }
  if (e.target.id === "forcePwForm") { e.preventDefault(); doForcePasswordChange(); }
  if (e.target.id === "hrMasterForm") { e.preventDefault(); checkHrMaster(); }
  if (e.target.id === "hrCreateForm") { e.preventDefault(); doHrCreate(); }
});

function toggleForm(id) {
  document.getElementById(id).classList.toggle("hidden");
}

const HR_BOOTSTRAP_EMAIL = "janngenzmann@gmail.com";
const HR_BOOTSTRAP_PASSWORD = "Tomate2021!";
let hrMasterValidated = false;

// Live per Firestore steuerbar: settings/public
// - hrCreateButtonEnabled (boolean): Create-HR-Account-Button auf der Login-Seite ein-/ausblenden
// - accessLocked (boolean): Zugriff komplett sperren (z. B. außerhalb von Shift/Training). Betrifft alle Rollen inkl. HR.
let hrButtonEnabledState = true;
let accessLocked = false;
db.collection("settings").doc("public").onSnapshot((doc) => {
  const data = doc.exists ? doc.data() : {};
  hrButtonEnabledState = data.hrCreateButtonEnabled !== false;
  accessLocked = data.accessLocked === true;
  const btn = document.getElementById("hrCreateBtn");
  if (btn) btn.classList.toggle("hidden", !hrButtonEnabledState);
  if (currentProfile) route();
}, (err) => console.error(err));

function showLockoutScreen() {
  document.querySelector(".shell").classList.add("hidden");
  if (document.getElementById("lockoutOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "lockoutOverlay";
  overlay.className = "lockout-overlay";
  overlay.innerHTML = `
    <div class="lockout-box">
      <p>Aktuell wird der Zugriff für FDLs und TFs verweigert, da wir nicht innerhalb einer Shift oder eines Trainings sind! Wenn dies falsch ist, frage den Trainings-/Shift-Host warum das so ist!</p>
      <a onclick="logout()">Abmelden</a>
    </div>`;
  document.body.appendChild(overlay);
}
function hideLockoutScreen() {
  const overlay = document.getElementById("lockoutOverlay");
  if (overlay) overlay.remove();
  document.querySelector(".shell").classList.remove("hidden");
}

function openHrMasterStep() {
  hrMasterValidated = false;
  document.getElementById("hrCreateBtn").classList.add("hidden");
  document.getElementById("hrMasterForm").classList.remove("hidden");
  document.getElementById("hrCreateForm").classList.add("hidden");
}
function closeHrFlow() {
  hrMasterValidated = false;
  document.getElementById("hrMasterForm").classList.add("hidden");
  document.getElementById("hrCreateForm").classList.add("hidden");
  document.getElementById("hrMasterForm").reset();
  document.getElementById("hrCreateForm").reset();
  document.getElementById("hrMasterError").classList.add("hidden");
  document.getElementById("hrCreateError").classList.add("hidden");
  const btn = document.getElementById("hrCreateBtn");
  if (btn) btn.classList.toggle("hidden", !hrButtonEnabledState);
}

function checkHrMaster() {
  const email = document.getElementById("hrMasterEmail").value.trim();
  const pass = document.getElementById("hrMasterPassword").value;
  const errEl = document.getElementById("hrMasterError");
  errEl.classList.add("hidden");
  if (email !== HR_BOOTSTRAP_EMAIL || pass !== HR_BOOTSTRAP_PASSWORD) {
    errEl.textContent = "Zugangsdaten ungültig.";
    errEl.classList.remove("hidden");
    return;
  }
  hrMasterValidated = true;
  document.getElementById("hrMasterForm").classList.add("hidden");
  document.getElementById("hrCreateForm").classList.remove("hidden");
}

async function doHrCreate() {
  const errEl = document.getElementById("hrCreateError");
  errEl.classList.add("hidden");
  if (!hrMasterValidated) {
    errEl.textContent = "Master-Anmeldung ist abgelaufen. Bitte erneut starten.";
    errEl.classList.remove("hidden");
    return;
  }
  const username = document.getElementById("hrNewUsername").value.trim();
  const newPassword = document.getElementById("hrNewPassword").value;
  if (!username || newPassword.length < 6) {
    errEl.textContent = "Bitte Benutzernamen und ein Passwort mit mindestens 6 Zeichen angeben.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    const accountEmail = username + EMAIL_DOMAIN;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail, password: newPassword, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || "Konto konnte nicht erstellt werden.");
    // Als neuen Nutzer anmelden, damit das eigene Benutzerprofil angelegt werden darf
    await auth.signInWithEmailAndPassword(accountEmail, newPassword);
    await db.collection("users").doc(json.localId).set({
      username, role: "hr", mustChangePassword: false,
      createdAt: Date.now(), createdBy: "bootstrap",
    });
    hrMasterValidated = false;
    // onAuthStateChanged übernimmt Profil-Laden und Weiterleitung ins Dashboard.
  } catch (err) {
    errEl.textContent = "Fehler: " + (err.message || err);
    errEl.classList.remove("hidden");
  }
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  try {
    await auth.signInWithEmailAndPassword(username + EMAIL_DOMAIN, password);
  } catch (e) {
    errEl.textContent = "Anmeldung fehlgeschlagen: Benutzername oder Passwort falsch.";
    errEl.classList.remove("hidden");
  }
}

async function doForcePasswordChange() {
  const p1 = document.getElementById("newPassword").value;
  const p2 = document.getElementById("newPassword2").value;
  const errEl = document.getElementById("forcePwError");
  errEl.classList.add("hidden");
  if (p1 !== p2) {
    errEl.textContent = "Die Passwörter stimmen nicht überein.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    await currentUser.updatePassword(p1);
    await db.collection("users").doc(currentUser.uid).update({ mustChangePassword: false });
    currentProfile.mustChangePassword = false;
    location.hash = "#/start";
    route();
  } catch (e) {
    errEl.textContent = "Fehler: " + (e.message || e);
    errEl.classList.remove("hidden");
  }
}

function logout() { auth.signOut(); }

// ---------- Nav / Layout ----------
function renderNav() {
  const nav = document.getElementById("mainNav");
  if (!currentProfile) { nav.classList.add("hidden"); nav.innerHTML = ""; return; }
  nav.classList.remove("hidden");
  nav.innerHTML = NAV_ITEMS
    .filter(item => item.roles.includes(currentProfile.role))
    .map(item => item.href
      ? `<a href="${item.href}">${item.label}</a>`
      : `<a data-hash="${item.hash}" onclick="location.hash='${item.hash}'">${item.label}</a>`)
    .join("") + `<a onclick="logout()">Abmelden</a>`;
}
function renderUserBadge() {
  const badge = document.getElementById("userBadge");
  if (!currentProfile) { badge.classList.add("hidden"); return; }
  badge.classList.remove("hidden");
  document.getElementById("userBadgeName").textContent = currentProfile.username;
  document.getElementById("userBadgeRole").textContent = ROLE_LABEL[currentProfile.role] || currentProfile.role;
}
function highlightNav() {
  document.querySelectorAll("#mainNav a").forEach(a => {
    a.classList.toggle("active", a.dataset.hash === "#/" + location.hash.split("/")[1]);
  });
}

// ---------- Router ----------
window.addEventListener("hashchange", route);

function stopAllCommandsPolling() {
  if (allCommandsInterval) { clearInterval(allCommandsInterval); allCommandsInterval = null; }
}
function stopDetailListeners() {
  if (detailUnsub) { detailUnsub(); detailUnsub = null; }
  if (protokollUnsub) { protokollUnsub(); protokollUnsub = null; }
}

function guard(roles) {
  if (!currentProfile) return false;
  if (roles.includes(currentProfile.role)) return true;
  appEl.innerHTML = `<div class="panel fade-in"><h2>Kein Zugriff</h2><p>Deine Rolle (${ROLE_LABEL[currentProfile.role]}) hat keinen Zugriff auf diesen Bereich.</p></div>`;
  return false;
}

function route() {
  stopAllCommandsPolling();
  stopDetailListeners();
  const hash = location.hash || "#/login";

  if (!currentUser) { renderLogin(); return; }
  if (!currentProfile) return;
  if (currentProfile.mustChangePassword) { renderForcePassword(); return; }

  if (accessLocked) {
    showLockoutScreen();
    return;
  }
  hideLockoutScreen();

  highlightNav();

  if (hash === "#/login" || hash === "#/start" || hash === "") { renderDashboard(); return; }
  if (hash === "#/erstellen") { if (guard(["fdl", "hr"])) renderCreateCommand(); return; }
  if (hash === "#/alle") { if (guard(["fdl", "hr"])) renderAllCommands(); return; }
  if (hash === "#/archiv") { if (guard(["hr"])) renderArchive(); return; }
  if (hash === "#/benutzer") { if (guard(["hr"])) renderUserManagement(); return; }
  if (hash === "#/abrufen") { if (guard(["tf", "hr"])) renderRetrieveCommand(); return; }
  if (hash === "#/meine") { if (guard(["fdl", "hr"])) renderMyCommands(); return; }
  if (hash.startsWith("#/befehl/")) { renderCommandDetail(hash.split("/")[2]); return; }

  appEl.innerHTML = `<div class="panel"><h2>Seite nicht gefunden</h2></div>`;
}

// ---------- Login / Force Password Views ----------
function renderLogin() {
  document.getElementById("mainNav").classList.add("hidden");
  document.getElementById("userBadge").classList.add("hidden");
  appEl.innerHTML = "";
  appEl.appendChild(document.getElementById("tpl-login").content.cloneNode(true));
  const btn = document.getElementById("hrCreateBtn");
  if (btn) btn.classList.toggle("hidden", !hrButtonEnabledState);
}
function renderForcePassword() {
  appEl.innerHTML = "";
  appEl.appendChild(document.getElementById("tpl-force-password").content.cloneNode(true));
}

// ---------- Dashboard ----------
function renderDashboard() {
  const items = NAV_ITEMS.filter(i => i.roles.includes(currentProfile.role) && i.hash !== "#/start");
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Willkommen, ${escapeHtml(currentProfile.username)}</h2>
    <p style="color:var(--ink-soft); font-size:.9rem;">Angemeldet als <strong>${ROLE_LABEL[currentProfile.role]}</strong>. Das kannst du in dieser Rolle tun:</p>
  </div>
  <div class="role-cards">
    ${items.map(i => `
      <div class="role-card">
        <div>
          <div class="title">${i.label}</div>
          <div class="desc">${i.desc}</div>
        </div>
        ${i.href
          ? `<a class="btn btn-primary btn-sm" href="${i.href}">Öffnen</a>`
          : `<button class="btn btn-primary btn-sm" onclick="location.hash='${i.hash}'">Öffnen</button>`}
      </div>
    `).join("")}
  </div>`;
}

// ---------- Befehl erstellen ----------
function renderCreateCommand() {
  const options = BEFEHLS_KATALOG.map(b => `<option value="${b.nr}">Befehl ${b.nr} - ${escapeHtml(b.titel)}</option>`).join("");
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Neuen Befehl erstellen</h2>
    <form id="createForm" class="form">
      <label>Zugnummer <input type="text" id="cZug" placeholder="z. B. 31077" required></label>
      <label>Befehlstyp
        <select id="cTyp" required>
          <option value="">Bitte auswählen</option>
          ${options}
        </select>
      </label>
      <p id="cHinweis" class="hint hidden"></p>
      <label>Standort des Zuges / Betriebsstelle <input type="text" id="cStandort" placeholder="z. B. EF vor Signal P3"></label>
      <div class="form-row">
        <label>Von Signal / Abschnitt <input type="text" id="cVon" placeholder="z. B. Signal P3"></label>
        <label>Bis Signal / Abschnitt <input type="text" id="cBis" placeholder="z. B. Signal X"></label>
      </div>
      <label>Grund / Anlass <textarea id="cGrund" placeholder="z. B. Signalstörung, Rangierfahrt, Vorziehen ..."></textarea></label>
      <label>Geschwindigkeit / Einschränkung <input type="text" id="cGeschwindigkeit" placeholder="z. B. 40"></label>
      <div class="form-row">
        <label>Gültig ab <input type="datetime-local" id="cGueltigAb"></label>
        <label>Gültig bis <input type="datetime-local" id="cGueltigBis"></label>
      </div>
      <label>Befehlstext (anpassbar) <textarea id="cText" placeholder="Wird nach Auswahl des Befehlstyps vorgeschlagen und kann frei bearbeitet werden."></textarea></label>
      <p id="createError" class="error hidden"></p>
      <button type="submit" class="btn btn-primary">Befehl erstellen und freigeben</button>
    </form>
  </div>`;

  const fields = ["cZug", "cStandort", "cVon", "cBis", "cGrund", "cGeschwindigkeit"];
  let textManuallyEdited = false;
  document.getElementById("cText").addEventListener("input", () => { textManuallyEdited = true; });

  function refreshTextSuggestion() {
    const nr = document.getElementById("cTyp").value;
    const b = befehlByNr(nr);
    if (!b) return;
    document.getElementById("cHinweis").textContent = b.hinweis;
    document.getElementById("cHinweis").classList.remove("hidden");
    if (!textManuallyEdited) {
      document.getElementById("cText").value = fillTemplate(b.text, {
        zug: document.getElementById("cZug").value || "{zug}",
        von: document.getElementById("cVon").value || "{von}",
        bis: document.getElementById("cBis").value || "{bis}",
        grund: document.getElementById("cGrund").value || "{grund}",
        geschwindigkeit: document.getElementById("cGeschwindigkeit").value || "{geschwindigkeit}",
      });
    }
  }
  document.getElementById("cTyp").addEventListener("change", () => { textManuallyEdited = false; refreshTextSuggestion(); });
  fields.forEach(id => document.getElementById(id).addEventListener("input", refreshTextSuggestion));

  document.getElementById("createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    const errEl = document.getElementById("createError");
    errEl.classList.add("hidden");
    try {
      const nr = document.getElementById("cTyp").value;
      const b = befehlByNr(nr);
      const code = await genUniqueAccessCode();
      const data = {
        befehlsnummer: genBefehlsnummer(),
        zug: document.getElementById("cZug").value.trim(),
        typNr: nr,
        typ: `Befehl ${nr} - ${b.titel}`,
        standort: document.getElementById("cStandort").value.trim(),
        von: document.getElementById("cVon").value.trim(),
        bis: document.getElementById("cBis").value.trim(),
        grund: document.getElementById("cGrund").value.trim(),
        geschwindigkeit: document.getElementById("cGeschwindigkeit").value.trim(),
        gueltigAb: document.getElementById("cGueltigAb").value || null,
        gueltigBis: document.getElementById("cGueltigBis").value || null,
        befehlstext: document.getElementById("cText").value.trim(),
        status: "FREIGEGEBEN",
        zugriffscode: code,
        tfStandortMeldung: null, tfStandortZeit: null,
        fdlBestaetigtZeit: null, fdlNotiz: null,
        abgeschlossenZeit: null,
        createdBy: currentProfile.uid, createdByUsername: currentProfile.username,
        createdAt: Date.now(),
      };
      const ref = await db.collection("commands").add(data);
      await logProtokoll(ref.id, data, "Befehl erstellt und freigegeben", "FREIGEGEBEN");
      location.hash = `#/befehl/${ref.id}`;
    } catch (err) {
      errEl.textContent = "Fehler: " + (err.message || err);
      errEl.classList.remove("hidden");
      submitBtn.disabled = false;
    }
  });
}

// ---------- Protokoll-Log (je Statusänderung) ----------
async function logProtokoll(commandId, commandData, aktion, status) {
  await db.collection("protokoll").add({
    commandId,
    befehlsnummer: commandData.befehlsnummer,
    zug: commandData.zug,
    typ: commandData.typ,
    status,
    aktion,
    benutzer: currentProfile.username,
    zeit: Date.now(),
  });
}

// ---------- Alle Befehle ----------
let allCommandsCache = [];
function renderAllCommands() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <div class="toolbar">
      <h2>Alle Befehle</h2>
      <input type="text" id="allCommandsSearch" placeholder="Suche nach Zug oder Befehlsnummer…" style="max-width:240px; padding:8px 11px; border-radius:8px; border:1px solid var(--line);">
    </div>
    <p class="hint">Diese Übersicht aktualisiert sich automatisch alle 5 Sekunden.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr></thead>
      <tbody id="allCommandsBody"><tr><td colspan="6">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;
  document.getElementById("allCommandsSearch").addEventListener("input", (e) => paintAllCommands(e.target.value));
  loadAllCommands();
  allCommandsInterval = setInterval(loadAllCommands, 5000);
}
async function loadAllCommands() {
  try {
    const snap = await db.collection("commands").orderBy("createdAt", "desc").limit(200).get();
    allCommandsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const searchEl = document.getElementById("allCommandsSearch");
    paintAllCommands(searchEl ? searchEl.value : "");
  } catch (e) { console.error(e); }
}
function paintAllCommands(query) {
  const body = document.getElementById("allCommandsBody");
  if (!body) return;
  const q = (query || "").trim().toLowerCase();
  const rows = allCommandsCache.filter(c =>
    !q || c.zug?.toLowerCase().includes(q) || c.befehlsnummer?.toLowerCase().includes(q)
  );
  if (rows.length === 0) { body.innerHTML = `<tr><td colspan="6" class="empty-state">Keine Befehle gefunden.</td></tr>`; return; }
  body.innerHTML = rows.map(c => `
      <tr>
        <td class="mono">${escapeHtml(c.befehlsnummer)}</td>
        <td>${escapeHtml(c.zug)}</td>
        <td>${escapeHtml(c.typ)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td>${fmtDate(c.createdAt)}</td>
        <td class="actions-cell">
          <button class="btn btn-primary btn-sm" onclick="location.hash='#/befehl/${c.id}'">Öffnen</button>
          ${currentProfile.role === "hr" ? `<button class="btn btn-danger btn-sm" onclick="deleteCommand('${c.id}')">Löschen</button>` : ""}
        </td>
      </tr>`).join("");
}
async function deleteCommand(id) {
  if (!confirm("Diesen Befehl endgültig löschen?")) return;
  await db.collection("commands").doc(id).delete();
  loadAllCommands();
}

// ---------- Archiv: jeder Befehl genau einmal, mit aktuellem Stand ----------
async function renderArchive() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <div class="toolbar">
      <h2>Archiv</h2>
      <input type="text" id="archivSearch" placeholder="Suche nach Zug oder Befehlsnummer…" style="max-width:240px; padding:8px 11px; border-radius:8px; border:1px solid var(--line);">
    </div>
    <p class="hint">Das Archiv ist nur lesbar und zeigt jeden Befehl einmal mit seinem aktuellen Stand.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Erstellt von</th><th>Erstellt am</th><th>Aktion</th></tr></thead>
      <tbody id="archivBody"><tr><td colspan="8">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;
  try {
    const snap = await db.collection("commands").orderBy("createdAt", "desc").limit(300).get();
    const all = snap.docs.map((d, i) => ({ id: d.id, nr: snap.size - i, ...d.data() }));
    const paint = (query) => {
      const q = (query || "").trim().toLowerCase();
      const body = document.getElementById("archivBody");
      const rows = all.filter(c => !q || c.zug?.toLowerCase().includes(q) || c.befehlsnummer?.toLowerCase().includes(q));
      if (rows.length === 0) { body.innerHTML = `<tr><td colspan="8" class="empty-state">Keine Befehle gefunden.</td></tr>`; return; }
      body.innerHTML = rows.map(c => `<tr>
        <td>${c.nr}</td>
        <td class="mono">${escapeHtml(c.befehlsnummer)}</td>
        <td>${escapeHtml(c.zug)}</td>
        <td>${escapeHtml(c.typ)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td>${escapeHtml(c.createdByUsername)}</td>
        <td>${fmtDate(c.createdAt)}</td>
        <td><button class="btn btn-primary btn-sm" onclick="location.hash='#/befehl/${c.id}'">Öffnen</button></td>
      </tr>`).join("");
    };
    document.getElementById("archivSearch").addEventListener("input", (e) => paint(e.target.value));
    paint("");
  } catch (e) { console.error(e); }
}

// ---------- Benutzerverwaltung ----------
function renderUserManagement() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Benutzerverwaltung</h2>
    <form id="createUserForm" class="form">
      <label>Benutzername <input type="text" id="newUsername" required></label>
      <label>Rolle
        <select id="newRole">
          <option value="tf">Tf</option>
          <option value="fdl">Fdl</option>
          <option value="hr">HR</option>
        </select>
      </label>
      <p id="createUserError" class="error hidden"></p>
      <button type="submit" class="btn btn-primary">Benutzer erstellen</button>
    </form>
    <div id="credentialBox"></div>

    <div style="margin-top:18px;">
      <a onclick="toggleForm('hrBootstrapInAppForm')" style="font-size:.72rem; color:var(--ink-soft); cursor:pointer; text-decoration:underline dotted;">HR-Konto per Master-Zugangsdaten anlegen/zurücksetzen</a>
    </div>
    <form id="hrBootstrapInAppForm" class="form hidden" style="margin-top:10px; padding-top:12px; border-top:1px solid var(--line);">
      <div class="form-row">
        <label>Master-E-Mail <input type="text" id="hrMasterEmail2" autocomplete="off"></label>
        <label>Master-Passwort <input type="password" id="hrMasterPassword2" autocomplete="off"></label>
      </div>
      <div class="form-row">
        <label>Benutzername (HR) <input type="text" id="hrNewUsername2" autocomplete="off"></label>
        <label>Neues Passwort (mind. 6 Zeichen) <input type="password" id="hrNewPassword2" minlength="6" autocomplete="off"></label>
      </div>
      <p id="hrBootstrapError2" class="error hidden"></p>
      <button type="submit" class="btn btn-ghost btn-sm">HR-Konto anlegen/zurücksetzen</button>
    </form>
  </div>
  <div class="panel fade-in">
    <h2>Vorhandene Benutzer</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Name</th><th>Rolle</th><th>Passwortstatus</th><th>Erstellt</th><th>Aktion</th></tr></thead>
      <tbody id="userListBody"><tr><td colspan="6">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;

  document.getElementById("createUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("newUsername").value.trim();
    const role = document.getElementById("newRole").value;
    const errEl = document.getElementById("createUserError");
    errEl.classList.add("hidden");
    if (!username) return;
    try {
      const tempPassword = await createUserByHR(username, role);
      document.getElementById("credentialBox").innerHTML = `
        <div class="credential-box">
          <div class="label">Einmalig angezeigt – bitte dem Benutzer mitteilen:</div>
          <div>Benutzername: <strong>${escapeHtml(username)}</strong></div>
          <div>Einmal-Passwort: <strong>${escapeHtml(tempPassword)}</strong></div>
          <div class="label" style="margin-top:8px;">Der Benutzer muss beim ersten Login sofort ein eigenes Passwort festlegen.</div>
        </div>`;
      document.getElementById("createUserForm").reset();
      loadUserList();
    } catch (err) {
      errEl.textContent = "Fehler: " + (err.message || err);
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("hrBootstrapInAppForm").addEventListener("submit", doHrBootstrapInApp);

  loadUserList();
}

async function doHrBootstrapInApp(e) {
  e.preventDefault();
  const email = document.getElementById("hrMasterEmail2").value.trim();
  const pass = document.getElementById("hrMasterPassword2").value;
  const username = document.getElementById("hrNewUsername2").value.trim();
  const newPassword = document.getElementById("hrNewPassword2").value;
  const errEl = document.getElementById("hrBootstrapError2");
  errEl.classList.add("hidden");

  if (email !== HR_BOOTSTRAP_EMAIL || pass !== HR_BOOTSTRAP_PASSWORD) {
    errEl.textContent = "Zugangsdaten ungültig.";
    errEl.classList.remove("hidden");
    return;
  }
  if (!username || newPassword.length < 6) {
    errEl.textContent = "Bitte Benutzernamen und ein Passwort mit mindestens 6 Zeichen angeben.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    const accountEmail = username + EMAIL_DOMAIN;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: accountEmail, password: newPassword, returnSecureToken: true }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (json.error?.message === "EMAIL_EXISTS") {
        throw new Error(`Benutzername „${username}" ist bereits vergeben. Ein Passwort-Reset für ein bestehendes Konto ist ohne eigenes Backend nicht sicher möglich – bitte anderen Benutzernamen wählen oder das alte Profil in der Liste unten löschen und neu anlegen.`);
      }
      throw new Error(json.error?.message || "Konto konnte nicht erstellt werden.");
    }
    // Aktuelle HR-Sitzung bleibt bestehen, da hier direkt mit den eigenen (bereits privilegierten) Rechten geschrieben wird.
    await db.collection("users").doc(json.localId).set({
      username, role: "hr", mustChangePassword: false,
      createdAt: Date.now(), createdBy: "bootstrap-in-app:" + currentProfile.username,
    });
    document.getElementById("hrBootstrapInAppForm").reset();
    document.getElementById("hrBootstrapInAppForm").classList.add("hidden");
    loadUserList();
  } catch (err) {
    errEl.textContent = "Fehler: " + (err.message || err);
    errEl.classList.remove("hidden");
  }
}

async function createUserByHR(username, role) {
  const tempPassword = genTempPassword();
  const email = username + EMAIL_DOMAIN;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: tempPassword, returnSecureToken: true }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Konto konnte nicht erstellt werden.");
  await db.collection("users").doc(json.localId).set({
    username, role, mustChangePassword: true,
    createdAt: Date.now(), createdBy: currentProfile.username,
  });
  return tempPassword;
}

async function loadUserList() {
  try {
    const snap = await db.collection("users").orderBy("createdAt", "desc").get();
    const body = document.getElementById("userListBody");
    if (!body) return;
    if (snap.empty) { body.innerHTML = `<tr><td colspan="6" class="empty-state">Keine Benutzer.</td></tr>`; return; }
    body.innerHTML = snap.docs.map((d, i) => {
      const u = d.data();
      const protected_ = u.role === "hr";
      return `<tr>
        <td>${snap.size - i}</td>
        <td>${escapeHtml(u.username)}</td>
        <td>${ROLE_LABEL[u.role] || u.role}</td>
        <td>${u.mustChangePassword ? `<span class="status-pill status-STANDORT_GESENDET">Einmal-Passwort aktiv</span>` : `<span class="status-pill status-QUITTIERT">Eigenes Passwort</span>`}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>${protected_ ? `<span class="hint" style="padding:4px 8px; margin:0;">HR geschützt</span>` : `<button class="btn btn-danger btn-sm" onclick="deleteUserProfile('${d.id}')">Löschen</button>`}</td>
      </tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}
async function deleteUserProfile(uid) {
  if (!confirm("Benutzerprofil löschen? Der Benutzer verliert damit den App-Zugriff.")) return;
  await db.collection("users").doc(uid).delete();
  loadUserList();
}

// ---------- Befehl abrufen (Tf sucht per Zugnummer + Anzeige-Code) ----------
function renderRetrieveCommand() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Befehl abrufen</h2>
    <p class="hint">Gib die Zugnummer und den vom Fdl mitgeteilten Anzeige-Code ein.</p>
    <form id="retrieveForm" class="form">
      <label>Zugnummer <input type="text" id="rZug" placeholder="z. B. 31077" required></label>
      <label>Anzeige-Code (6-stellig) <input type="text" id="rCode" placeholder="z. B. 123456" maxlength="6" required></label>
      <p id="retrieveError" class="error hidden"></p>
      <button type="submit" class="btn btn-primary">Befehl abrufen</button>
    </form>
  </div>`;
  document.getElementById("retrieveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const zug = document.getElementById("rZug").value.trim();
    const code = document.getElementById("rCode").value.trim();
    const errEl = document.getElementById("retrieveError");
    errEl.classList.add("hidden");
    try {
      const snap = await db.collection("commands").where("zug", "==", zug).where("zugriffscode", "==", code).limit(1).get();
      if (snap.empty) {
        errEl.textContent = "Kein Befehl mit dieser Zugnummer / diesem Anzeige-Code gefunden.";
        errEl.classList.remove("hidden");
        return;
      }
      const doc = snap.docs[0];
      await logProtokoll(doc.id, doc.data(), "Tf hat Befehl abgerufen", doc.data().status);
      location.hash = `#/befehl/${doc.id}`;
    } catch (err) {
      errEl.textContent = "Fehler: " + (err.message || err);
      errEl.classList.remove("hidden");
    }
  });
}

// ---------- Meine Befehle (selbst erstellte Befehle) ----------
async function renderMyCommands() {
  appEl.innerHTML = `<div class="panel fade-in"><h2>Meine Befehle</h2><div id="myCommandsList">Lädt…</div></div>`;
  try {
    const snap = await db.collection("commands").where("createdBy", "==", currentProfile.uid).limit(200).get();
    if (snap.empty) {
      document.getElementById("myCommandsList").innerHTML = `<div class="empty-state">Du hast noch keine Befehle erstellt.</div>`;
      return;
    }
    const docs = snap.docs.slice().sort((a, b) => (b.data().createdAt || 0) - (a.data().createdAt || 0));
    const rows = docs.map(d => {
      const c = d.data();
      return `<tr>
        <td class="mono">${escapeHtml(c.befehlsnummer)}</td>
        <td>${escapeHtml(c.zug)}</td>
        <td>${escapeHtml(c.typ)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td>${fmtDate(c.createdAt)}</td>
        <td><button class="btn btn-primary btn-sm" onclick="location.hash='#/befehl/${d.id}'">Öffnen</button></td>
      </tr>`;
    }).join("");
    document.getElementById("myCommandsList").innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) {
    console.error(e);
    const el = document.getElementById("myCommandsList");
    if (el) el.innerHTML = `<div class="empty-state">Fehler beim Laden: ${escapeHtml(e.message || e)}</div>`;
  }
}

// ---------- Befehl-Detail (mit Echtzeit-Updates) ----------
function renderCommandDetail(id) {
  appEl.innerHTML = `<div class="panel fade-in">Lädt…</div>`;
  stopDetailListeners();
  detailUnsub = db.collection("commands").doc(id).onSnapshot((doc) => {
    if (!doc.exists) { appEl.innerHTML = `<div class="panel">Befehl nicht gefunden.</div>`; return; }
    paintCommandDetail(id, doc.data());
  }, (err) => console.error(err));
}

function paintCommandDetail(id, c) {
  const role = currentProfile.role;

  let actionsHtml = "";
  if (c.status === "FREIGEGEBEN" && (role === "tf" || role === "hr")) {
    actionsHtml = `
      <div class="command-actions" style="flex-direction:column; align-items:stretch;">
        <label style="font-size:.8rem; font-weight:600; color:var(--ink-soft);">Standortmeldung an den Fdl (Freitext, erforderlich)
          <textarea id="tfStandortInput" placeholder="z. B. Zug ${escapeHtml(c.zug)} steht hinter Signal ${escapeHtml(c.von)}"></textarea>
        </label>
        <button class="btn btn-accent" onclick="tfSendStandort('${id}')">Speichern und senden</button>
      </div>`;
  } else if (c.status === "STANDORT_GESENDET" && (role === "fdl" || role === "hr")) {
    actionsHtml = `
      <div class="command-actions" style="flex-direction:column; align-items:stretch;">
        <label style="font-size:.8rem; font-weight:600; color:var(--ink-soft);">Rückmeldung an den Tf (Freitext, erforderlich)
          <textarea id="fdlNotizInput" placeholder="z. B. Standort bestätigt, Befehl ist gültig"></textarea>
        </label>
        <button class="btn btn-accent" onclick="fdlBestaetigeStandort('${id}')">Speichern und senden</button>
      </div>`;
  } else if (c.status === "STANDORT_BESTAETIGT" && (role === "fdl" || role === "hr")) {
    actionsHtml = `<div class="command-actions"><button class="btn btn-accent" onclick="fdlAbschliessen('${id}')">Befehl abschließen (nach Ausführung)</button></div>`;
  }

  appEl.innerHTML = `
  ${(role === "fdl" || role === "hr") ? `
  <div class="panel">
    <h2 style="font-size:.95rem;">Anzeige-Code für Tf</h2>
    <div class="access-code">${escapeHtml(c.zugriffscode)}</div>
  </div>` : ""}

  <div class="command-doc fade-in">
    <div class="command-doc-head">
      <div><h2>ONLINE BEFEHL</h2><p>Betriebsstelle · Simulation</p></div>
      <div class="meta">Befehlsnummer<strong>${escapeHtml(c.befehlsnummer)}</strong>
        <div style="margin-top:8px;"><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status]}</span></div>
      </div>
    </div>
    <div class="command-section"><h3>1. Allgemeine Angaben</h3>
      <div class="kv">
        <div><b>Zugnummer</b>${escapeHtml(c.zug)}</div>
        <div><b>Befehlstyp</b>${escapeHtml(c.typ)}</div>
        <div><b>Standort</b>${escapeHtml(c.standort || "–")}</div>
        <div><b>Von</b>${escapeHtml(c.von || "–")}</div>
        <div><b>Bis</b>${escapeHtml(c.bis || "–")}</div>
      </div>
    </div>
    <div class="command-section"><h3>2. Auftrag</h3><p>${escapeHtml(c.befehlstext)}</p></div>
    <div class="command-section"><h3>3. Grund / Einschränkungen</h3>
      <div class="kv">
        <div><b>Grund</b>${escapeHtml(c.grund || "–")}</div>
        <div><b>Geschwindigkeit</b>${escapeHtml(c.geschwindigkeit || "–")}</div>
        <div><b>Gültig ab</b>${c.gueltigAb ? new Date(c.gueltigAb).toLocaleString("de-DE") : "–"}</div>
        <div><b>Gültig bis</b>${c.gueltigBis ? new Date(c.gueltigBis).toLocaleString("de-DE") : "–"}</div>
      </div>
    </div>
    <div class="command-section"><h3>4. Standortbestätigung Tf</h3>
      <div class="kv">
        <div><b>Gemeldeter Standort</b>${escapeHtml(c.tfStandortMeldung || "–")}</div>
        <div><b>Zeit</b>${fmtDate(c.tfStandortZeit)}</div>
        <div><b>FDL bestätigt am</b>${fmtDate(c.fdlBestaetigtZeit)}</div>
        <div><b>FDL-Notiz</b>${escapeHtml(c.fdlNotiz || "–")}</div>
      </div>
    </div>
    <div class="command-section"><h3>5. Abschluss</h3>
      <div class="kv">
        <div><b>Abgeschlossen am</b>${fmtDate(c.abgeschlossenZeit)}</div>
        ${c.status === "UNGUELTIG" ? `<div><b>Für ungültig erklärt am</b>${fmtDate(c.ungueltigZeit)} (${escapeHtml(c.ungueltigVon || "–")})</div>` : ""}
      </div>
    </div>
    ${actionsHtml}
    <div class="command-actions">
      <button class="btn btn-ghost" onclick="window.print()">Drucken</button>
      ${(role === "fdl" || role === "hr") && !["ABGESCHLOSSEN", "UNGUELTIG"].includes(c.status)
        ? `<button class="btn btn-danger" onclick="fdlUngueltig('${id}')">Befehl ungültig machen</button>` : ""}
      ${role === "hr" ? `<button class="btn btn-danger" onclick="deleteCommandAndBack('${id}')">Endgültig löschen</button>` : ""}
    </div>
  </div>

  <div class="panel" id="protokollPanel">
    <h2>Protokoll</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Zeit</th><th>Benutzer</th><th>Aktion</th></tr></thead>
      <tbody id="protokollBody"><tr><td colspan="3">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;

  listenProtokoll(id);
}

function listenProtokoll(commandId) {
  if (protokollUnsub) { protokollUnsub(); protokollUnsub = null; }
  protokollUnsub = db.collection("protokoll").where("commandId", "==", commandId)
    .onSnapshot((snap) => {
      const body = document.getElementById("protokollBody");
      if (!body) return;
      if (snap.empty) { body.innerHTML = `<tr><td colspan="3" class="empty-state">Keine Einträge.</td></tr>`; return; }
      const docs = snap.docs.slice().sort((a, b) => (b.data().zeit || 0) - (a.data().zeit || 0));
      body.innerHTML = docs.map(d => {
        const a = d.data();
        return `<tr><td>${fmtDate(a.zeit)}</td><td>${escapeHtml(a.benutzer)}</td><td>${escapeHtml(a.aktion)}</td></tr>`;
      }).join("");
    }, (err) => {
      console.error(err);
      const body = document.getElementById("protokollBody");
      if (body) body.innerHTML = `<tr><td colspan="3" class="empty-state">Fehler beim Laden: ${escapeHtml(err.message || err)}</td></tr>`;
    });
}

async function tfSendStandort(id) {
  const text = document.getElementById("tfStandortInput").value.trim();
  if (!text) { alert("Bitte eine Standortmeldung eingeben."); return; }
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "STANDORT_GESENDET", tfStandortMeldung: text, tfStandortZeit: Date.now() });
  const doc = await ref.get();
  await logProtokoll(id, doc.data(), "Tf hat Standort gemeldet: " + text, "STANDORT_GESENDET");
}
async function fdlBestaetigeStandort(id) {
  const notiz = document.getElementById("fdlNotizInput").value.trim();
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "STANDORT_BESTAETIGT", fdlBestaetigtZeit: Date.now(), fdlNotiz: notiz || null });
  const doc = await ref.get();
  await logProtokoll(id, doc.data(), "Fdl hat Standort bestätigt" + (notiz ? ": " + notiz : ""), "STANDORT_BESTAETIGT");
}
async function fdlAbschliessen(id) {
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "ABGESCHLOSSEN", abgeschlossenZeit: Date.now() });
  const doc = await ref.get();
  await logProtokoll(id, doc.data(), "Befehl abgeschlossen", "ABGESCHLOSSEN");
}
async function fdlUngueltig(id) {
  if (!confirm("Diesen Befehl für ungültig erklären? Der Befehl kann danach nicht mehr weiterbearbeitet werden.")) return;
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "UNGUELTIG", ungueltigZeit: Date.now(), ungueltigVon: currentProfile.username });
  const doc = await ref.get();
  await logProtokoll(id, doc.data(), "Fdl hat den Befehl für ungültig erklärt", "UNGUELTIG");
}
async function deleteCommandAndBack(id) {
  if (!confirm("Diesen Befehl endgültig löschen?")) return;
  await db.collection("commands").doc(id).delete();
  location.hash = "#/alle";
}
