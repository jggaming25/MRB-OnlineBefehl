// ---------- Konstanten ----------
const ROLE_LABEL = { tf: "Tf", fdl: "Fdl", hr: "HR" };
const STATUS_LABEL = {
  FREIGEGEBEN: "Freigegeben",
  STANDORT_GESENDET: "Standort gesendet",
  STANDORT_BESTAETIGT: "Standort bestätigt",
  QUITTIERT: "Quittiert",
  ABGESCHLOSSEN: "Abgeschlossen"
};

const NAV_ITEMS = [
  { hash: "#/start", label: "Start", roles: ["tf", "fdl", "hr"] },
  { hash: "#/erstellen", label: "Befehl erstellen", roles: ["fdl", "hr"] },
  { hash: "#/alle", label: "Alle Befehle", roles: ["fdl", "hr"] },
  { hash: "#/archiv", label: "Archiv", roles: ["hr"] },
  { hash: "#/benutzer", label: "Benutzer", roles: ["hr"] },
  { hash: "#/abrufen", label: "Befehl abrufen", roles: ["tf", "hr"] },
  { hash: "#/meine", label: "Meine Befehle", roles: ["tf", "fdl", "hr"] },
];

let currentUser = null;
let currentProfile = null;
let allCommandsInterval = null;

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
  if (e.target.id === "loginForm") {
    e.preventDefault();
    doLogin();
  }
  if (e.target.id === "forcePwForm") {
    e.preventDefault();
    doForcePasswordChange();
  }
});

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

function logout() {
  auth.signOut();
}

// ---------- Nav / Layout ----------
function renderNav() {
  const nav = document.getElementById("mainNav");
  if (!currentProfile) {
    nav.classList.add("hidden");
    nav.innerHTML = "";
    return;
  }
  nav.classList.remove("hidden");
  nav.innerHTML = NAV_ITEMS
    .filter(item => item.roles.includes(currentProfile.role))
    .map(item => `<a data-hash="${item.hash}" onclick="location.hash='${item.hash}'">${item.label}</a>`)
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
    a.classList.toggle("active", a.dataset.hash === location.hash.split("/").slice(0, 2).join("/"));
  });
}

// ---------- Router ----------
window.addEventListener("hashchange", route);

function stopAllCommandsPolling() {
  if (allCommandsInterval) { clearInterval(allCommandsInterval); allCommandsInterval = null; }
}

function guard(roles) {
  if (!currentProfile) return false;
  if (roles.includes(currentProfile.role)) return true;
  appEl.innerHTML = `<div class="panel fade-in"><h2>Kein Zugriff</h2><p>Deine Rolle (${ROLE_LABEL[currentProfile.role]}) hat keinen Zugriff auf diesen Bereich.</p></div>`;
  return false;
}

function route() {
  stopAllCommandsPolling();
  const hash = location.hash || "#/login";

  if (!currentUser) { renderLogin(); return; }
  if (!currentProfile) return;
  if (currentProfile.mustChangePassword) { renderForcePassword(); return; }

  highlightNav();

  if (hash === "#/login" || hash === "#/start" || hash === "") { renderDashboard(); return; }
  if (hash === "#/erstellen") { if (guard(["fdl", "hr"])) renderCreateCommand(); return; }
  if (hash === "#/alle") { if (guard(["fdl", "hr"])) renderAllCommands(); return; }
  if (hash === "#/archiv") { if (guard(["hr"])) renderArchive(); return; }
  if (hash === "#/benutzer") { if (guard(["hr"])) renderUserManagement(); return; }
  if (hash === "#/abrufen") { if (guard(["tf", "hr"])) renderRetrieveCommand(); return; }
  if (hash === "#/meine") { renderMyCommands(); return; }
  if (hash.startsWith("#/befehl/")) { renderCommandDetail(hash.split("/")[2]); return; }

  appEl.innerHTML = `<div class="panel"><h2>Seite nicht gefunden</h2></div>`;
}

// ---------- Login / Force Password Views ----------
function renderLogin() {
  document.getElementById("mainNav").classList.add("hidden");
  document.getElementById("userBadge").classList.add("hidden");
  appEl.innerHTML = "";
  appEl.appendChild(document.getElementById("tpl-login").content.cloneNode(true));
}
function renderForcePassword() {
  appEl.innerHTML = "";
  appEl.appendChild(document.getElementById("tpl-force-password").content.cloneNode(true));
}

// ---------- Dashboard ----------
async function renderDashboard() {
  appEl.innerHTML = `<div class="panel fade-in"><h2>Willkommen, ${escapeHtml(currentProfile.username)}</h2>
    <p>Angemeldet als <strong>${ROLE_LABEL[currentProfile.role]}</strong>. Nutze die Navigation oben, um fortzufahren.</p>
  </div><div id="statCards" class="grid-cards"></div>`;

  if (currentProfile.role === "fdl" || currentProfile.role === "hr") {
    try {
      const snap = await db.collection("commands").get();
      const counts = { FREIGEGEBEN: 0, STANDORT_GESENDET: 0, STANDORT_BESTAETIGT: 0, QUITTIERT: 0, ABGESCHLOSSEN: 0 };
      snap.forEach(d => { const s = d.data().status; if (counts[s] !== undefined) counts[s]++; });
      document.getElementById("statCards").innerHTML = Object.entries(counts).map(([k, v]) => `
        <div class="stat-card"><div class="num">${v}</div><div class="label">${STATUS_LABEL[k]}</div></div>
      `).join("");
    } catch (e) { console.error(e); }
  }
}

// ---------- Befehl erstellen ----------
function renderCreateCommand() {
  const options = BEFEHLS_KATALOG.map(b => `<option value="${b.nr}">Befehl ${b.nr} - ${escapeHtml(b.titel)}</option>`).join("");
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Neuen digitalen Befehl erstellen</h2>
    <form id="createForm" class="form">
      <label>Zugnummer <input type="text" id="cZug" placeholder="z. B. 31077" required></label>
      <label>Befehlstyp
        <select id="cTyp" required>
          <option value="">Bitte auswählen</option>
          ${options}
        </select>
      </label>
      <p id="cHinweis" class="hint hidden"></p>
      <label>Standort des Zuges / Betriebsstelle <input type="text" id="cStandort" placeholder="z. B. BHBF vor Signal P3"></label>
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
      <label>Befehlstext <textarea id="cText" placeholder="Wird nach Auswahl des Befehlstyps automatisch vorgeschlagen."></textarea></label>
      <p id="createError" class="error hidden"></p>
      <button type="submit" class="btn btn-primary">Befehl erstellen und freigeben</button>
    </form>
  </div>`;

  const fields = ["cZug", "cStandort", "cVon", "cBis", "cGrund", "cGeschwindigkeit"];
  function refreshTextSuggestion() {
    const nr = document.getElementById("cTyp").value;
    const b = befehlByNr(nr);
    if (!b) return;
    document.getElementById("cHinweis").textContent = b.hinweis;
    document.getElementById("cHinweis").classList.remove("hidden");
    document.getElementById("cText").value = fillTemplate(b.text, {
      zug: document.getElementById("cZug").value || "{zug}",
      von: document.getElementById("cVon").value || "{von}",
      bis: document.getElementById("cBis").value || "{bis}",
      grund: document.getElementById("cGrund").value || "{grund}",
      geschwindigkeit: document.getElementById("cGeschwindigkeit").value || "{geschwindigkeit}",
    });
  }
  document.getElementById("cTyp").addEventListener("change", refreshTextSuggestion);
  fields.forEach(id => document.getElementById(id).addEventListener("input", refreshTextSuggestion));

  document.getElementById("createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nr = document.getElementById("cTyp").value;
    const b = befehlByNr(nr);
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
      zugriffscode: genAccessCode(),
      tfStandortMeldung: null, tfStandortZeit: null,
      fdlBestaetigtZeit: null, fdlNotiz: null,
      quittiertZeit: null, abgeschlossenZeit: null,
      createdBy: currentProfile.uid, createdByUsername: currentProfile.username,
      createdAt: Date.now(),
    };
    try {
      const ref = await db.collection("commands").add(data);
      await logArchiv(ref.id, data, "Befehl erstellt", "FREIGEGEBEN");
      await db.collection("users").doc(currentProfile.uid).collection("meine").doc(ref.id).set({ addedAt: Date.now() });
      location.hash = `#/befehl/${ref.id}`;
    } catch (err) {
      document.getElementById("createError").textContent = "Fehler: " + (err.message || err);
      document.getElementById("createError").classList.remove("hidden");
    }
  });
}

// ---------- Archiv-Log ----------
async function logArchiv(commandId, commandData, aktion, status) {
  await db.collection("archiv").add({
    commandId,
    befehlsnummer: commandData.befehlsnummer,
    zug: commandData.zug,
    typ: commandData.typ,
    status,
    grund: aktion,
    benutzer: currentProfile.username,
    zeit: Date.now(),
  });
}

// ---------- Alle Befehle ----------
function renderAllCommands() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <div class="toolbar"><h2>Alle Befehle</h2></div>
    <p class="hint">Diese Übersicht aktualisiert sich automatisch alle 5 Sekunden.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr></thead>
      <tbody id="allCommandsBody"><tr><td colspan="6">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;
  loadAllCommands();
  allCommandsInterval = setInterval(loadAllCommands, 5000);
}
async function loadAllCommands() {
  try {
    const snap = await db.collection("commands").orderBy("createdAt", "desc").limit(200).get();
    const body = document.getElementById("allCommandsBody");
    if (!body) return;
    if (snap.empty) { body.innerHTML = `<tr><td colspan="6" class="empty-state">Keine Befehle vorhanden.</td></tr>`; return; }
    body.innerHTML = snap.docs.map(d => {
      const c = d.data();
      return `<tr>
        <td class="mono">${escapeHtml(c.befehlsnummer)}</td>
        <td>${escapeHtml(c.zug)}</td>
        <td>${escapeHtml(c.typ)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td>${fmtDate(c.createdAt)}</td>
        <td class="actions-cell">
          <button class="btn btn-primary btn-sm" onclick="location.hash='#/befehl/${d.id}'">Öffnen</button>
          ${currentProfile.role === "hr" ? `<button class="btn btn-danger btn-sm" onclick="deleteCommand('${d.id}')">Löschen</button>` : ""}
        </td>
      </tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}
async function deleteCommand(id) {
  if (!confirm("Diesen Befehl endgültig löschen?")) return;
  await db.collection("commands").doc(id).delete();
  loadAllCommands();
}

// ---------- Archiv ----------
async function renderArchive() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Archiv</h2>
    <p class="hint">Das Archiv ist nur lesbar. Archivierte Einträge können hier nicht gelöscht werden.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Grund</th><th>Von</th><th>Zeit</th></tr></thead>
      <tbody id="archivBody"><tr><td colspan="8">Lädt…</td></tr></tbody>
    </table></div>
  </div>`;
  try {
    const snap = await db.collection("archiv").orderBy("zeit", "desc").limit(300).get();
    const body = document.getElementById("archivBody");
    if (snap.empty) { body.innerHTML = `<tr><td colspan="8" class="empty-state">Noch keine Einträge.</td></tr>`; return; }
    body.innerHTML = snap.docs.map((d, i) => {
      const a = d.data();
      return `<tr>
        <td>${snap.size - i}</td>
        <td class="mono">${escapeHtml(a.befehlsnummer)}</td>
        <td>${escapeHtml(a.zug)}</td>
        <td>${escapeHtml(a.typ)}</td>
        <td><span class="status-pill status-${a.status}">${STATUS_LABEL[a.status] || a.status}</span></td>
        <td>${escapeHtml(a.grund)}</td>
        <td>${escapeHtml(a.benutzer)}</td>
        <td>${fmtDate(a.zeit)}</td>
      </tr>`;
    }).join("");
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

  loadUserList();
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
        <td>${protected_ ? `<span class="hint" style="padding:4px 8px;">HR geschützt</span>` : `<button class="btn btn-danger btn-sm" onclick="deleteUserProfile('${d.id}')">Löschen</button>`}</td>
      </tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}
async function deleteUserProfile(uid) {
  if (!confirm("Benutzerprofil löschen? Der Benutzer verliert damit den App-Zugriff.")) return;
  await db.collection("users").doc(uid).delete();
  loadUserList();
}

// ---------- Befehl abrufen ----------
function renderRetrieveCommand() {
  appEl.innerHTML = `
  <div class="panel fade-in">
    <h2>Befehl abrufen</h2>
    <p class="hint">Nach dem Abruf bleibt der Befehl 24 Stunden in „Meine Befehle" gespeichert.</p>
    <form id="retrieveForm" class="form">
      <label>Zugnummer <input type="text" id="rZug" placeholder="z. B. 31077" required></label>
      <label>Zugriffscode <input type="text" id="rCode" placeholder="z. B. 123456" required></label>
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
        errEl.textContent = "Kein Befehl mit dieser Zugnummer / diesem Zugriffscode gefunden.";
        errEl.classList.remove("hidden");
        return;
      }
      const doc = snap.docs[0];
      await db.collection("users").doc(currentProfile.uid).collection("meine").doc(doc.id).set({ addedAt: Date.now() });
      await logArchiv(doc.id, doc.data(), "Tf hat Befehl abgerufen. Zugriff 24 Stunden gespeichert.", doc.data().status);
      location.hash = `#/befehl/${doc.id}`;
    } catch (err) {
      errEl.textContent = "Fehler: " + (err.message || err);
      errEl.classList.remove("hidden");
    }
  });
}

// ---------- Meine Befehle ----------
async function renderMyCommands() {
  appEl.innerHTML = `<div class="panel fade-in"><h2>Meine Befehle</h2><div id="myCommandsList">Lädt…</div></div>`;
  try {
    const snap = await db.collection("users").doc(currentProfile.uid).collection("meine").get();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const validIds = snap.docs.filter(d => d.data().addedAt >= cutoff).map(d => d.id);
    if (validIds.length === 0) {
      document.getElementById("myCommandsList").innerHTML = `<div class="empty-state">Keine Befehle in den letzten 24 Stunden.</div>`;
      return;
    }
    const docs = await Promise.all(validIds.map(id => db.collection("commands").doc(id).get()));
    const rows = docs.filter(d => d.exists).map(d => {
      const c = d.data();
      return `<tr>
        <td class="mono">${escapeHtml(c.befehlsnummer)}</td>
        <td>${escapeHtml(c.zug)}</td>
        <td>${escapeHtml(c.typ)}</td>
        <td><span class="status-pill status-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td><button class="btn btn-primary btn-sm" onclick="location.hash='#/befehl/${d.id}'">Öffnen</button></td>
      </tr>`;
    }).join("");
    document.getElementById("myCommandsList").innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Befehlsnummer</th><th>Zug</th><th>Typ</th><th>Status</th><th>Aktion</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  } catch (e) { console.error(e); }
}

// ---------- Befehl-Detail ----------
async function renderCommandDetail(id) {
  appEl.innerHTML = `<div class="panel fade-in">Lädt…</div>`;
  const ref = db.collection("commands").doc(id);
  const doc = await ref.get();
  if (!doc.exists) { appEl.innerHTML = `<div class="panel">Befehl nicht gefunden.</div>`; return; }
  const c = doc.data();
  const role = currentProfile.role;

  let actionsHtml = "";
  if (c.status === "FREIGEGEBEN" && role === "tf") {
    actionsHtml = `
      <div class="command-actions" style="flex-direction:column; align-items:stretch;">
        <label>Standortmeldung <textarea id="tfStandortInput" placeholder="z. B. Zug ${escapeHtml(c.zug)} steht hinter Signal ${escapeHtml(c.von)}"></textarea></label>
        <button class="btn btn-accent" onclick="tfSendStandort('${id}')">Standort senden</button>
      </div>`;
  } else if (c.status === "STANDORT_GESENDET" && (role === "fdl" || role === "hr")) {
    actionsHtml = `
      <div class="command-actions" style="flex-direction:column; align-items:stretch;">
        <label>FDL-Notiz (optional) <textarea id="fdlNotizInput"></textarea></label>
        <button class="btn btn-accent" onclick="fdlBestaetigeStandort('${id}')">Standort bestätigen</button>
      </div>`;
  } else if (c.status === "STANDORT_BESTAETIGT" && role === "tf") {
    actionsHtml = `<div class="command-actions"><button class="btn btn-accent" onclick="tfQuittieren('${id}')">Befehl quittieren</button></div>`;
  } else if (c.status === "QUITTIERT" && (role === "fdl" || role === "hr")) {
    actionsHtml = `<div class="command-actions"><button class="btn btn-accent" onclick="fdlAbschliessen('${id}')">Befehl abschließen</button></div>`;
  }

  appEl.innerHTML = `
  ${(role === "fdl" || role === "hr") ? `
  <div class="panel">
    <h2 style="font-size:1rem;">Zugriffscode für Tf</h2>
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
    <div class="command-section"><h3>5. Quittierung</h3>
      <p><b>Vom Tf quittiert am:</b> ${fmtDate(c.quittiertZeit)}</p>
    </div>
    ${actionsHtml}
    <div class="command-actions">
      <button class="btn btn-ghost" onclick="window.print()">Drucken</button>
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

  loadProtokoll(id);
}

async function loadProtokoll(commandId) {
  try {
    const snap = await db.collection("archiv").where("commandId", "==", commandId).orderBy("zeit", "desc").get();
    const body = document.getElementById("protokollBody");
    if (!body) return;
    if (snap.empty) { body.innerHTML = `<tr><td colspan="3" class="empty-state">Keine Einträge.</td></tr>`; return; }
    body.innerHTML = snap.docs.map(d => {
      const a = d.data();
      return `<tr><td>${fmtDate(a.zeit)}</td><td>${escapeHtml(a.benutzer)}</td><td>${escapeHtml(a.grund)}</td></tr>`;
    }).join("");
  } catch (e) { console.error(e); }
}

async function tfSendStandort(id) {
  const text = document.getElementById("tfStandortInput").value.trim();
  if (!text) { alert("Bitte eine Standortmeldung eingeben."); return; }
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "STANDORT_GESENDET", tfStandortMeldung: text, tfStandortZeit: Date.now() });
  const doc = await ref.get();
  await logArchiv(id, doc.data(), "Tf hat Standort gesendet", "STANDORT_GESENDET");
  renderCommandDetail(id);
}
async function fdlBestaetigeStandort(id) {
  const notiz = document.getElementById("fdlNotizInput").value.trim();
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "STANDORT_BESTAETIGT", fdlBestaetigtZeit: Date.now(), fdlNotiz: notiz || null });
  const doc = await ref.get();
  await logArchiv(id, doc.data(), "FDL hat Standort bestätigt", "STANDORT_BESTAETIGT");
  renderCommandDetail(id);
}
async function tfQuittieren(id) {
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "QUITTIERT", quittiertZeit: Date.now() });
  const doc = await ref.get();
  await logArchiv(id, doc.data(), "Tf hat Befehl quittiert", "QUITTIERT");
  renderCommandDetail(id);
}
async function fdlAbschliessen(id) {
  const ref = db.collection("commands").doc(id);
  await ref.update({ status: "ABGESCHLOSSEN", abgeschlossenZeit: Date.now() });
  const doc = await ref.get();
  await logArchiv(id, doc.data(), "Befehl abgeschlossen", "ABGESCHLOSSEN");
  renderCommandDetail(id);
}
async function deleteCommandAndBack(id) {
  if (!confirm("Diesen Befehl endgültig löschen?")) return;
  await db.collection("commands").doc(id).delete();
  location.hash = "#/alle";
}
