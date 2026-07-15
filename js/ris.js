// ---------- RIS: Online Fahrplan ----------
const RIS_ROLE_LABEL = { tf: "Tf", fdl: "Fdl", hr: "HR" };
const FAHRT_STATUS_LABEL = { normal: "Normal", ausfall: "Ausfall", teilausfall: "Teilausfall", ersatz: "Ersatz-/Zusatzfahrt" };
const MELDUNG_ART_LABEL = { info: "Info", warnung: "Warnung", stoerung: "Störung" };

let risUser = null;
let risProfile = null;
let dispoMode = false;

const risApp = document.getElementById("app");

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
}
function fmtDateTime(v) {
  if (!v) return "–";
  return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtTime(v) {
  if (!v) return "–";
  return new Date(v).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
// Fdl darf Bahnhöfe/Meldungen immer anlegen, HR nur bei aktivem Dispo-Modus.
function canManage(kind) {
  if (kind === "hr") return risProfile.role === "hr" && dispoMode;
  if (kind === "fdl") return risProfile.role === "fdl" || (risProfile.role === "hr" && dispoMode);
  return false;
}

// ---------- Verlauf (Recently viewed, lokal je Gerät) ----------
function risAddRecent(type, id, label) {
  let list = JSON.parse(localStorage.getItem("ris_recent") || "[]");
  list = list.filter(x => !(x.type === type && x.id === id));
  list.unshift({ type, id, label, ts: Date.now() });
  list = list.slice(0, 8);
  localStorage.setItem("ris_recent", JSON.stringify(list));
}
function risGetRecent() {
  return JSON.parse(localStorage.getItem("ris_recent") || "[]");
}

// ---------- Auth ----------
auth.onAuthStateChanged(async (user) => {
  if (!user) { location.href = "index.html"; return; }
  risUser = user;
  try {
    const snap = await db.collection("users").doc(user.uid).get();
    if (!snap.exists || snap.data().mustChangePassword) { location.href = "index.html"; return; }
    risProfile = { uid: user.uid, ...snap.data() };
  } catch (e) { console.error(e); return; }

  document.getElementById("userBadge").classList.remove("hidden");
  document.getElementById("userBadgeName").textContent = risProfile.username;
  document.getElementById("userBadgeRole").textContent = RIS_ROLE_LABEL[risProfile.role] || risProfile.role;

  if (risProfile.role === "hr") {
    dispoMode = !!risProfile.dispoMode;
    const box = document.getElementById("dispoBox");
    box.classList.remove("hidden");
    const toggle = document.getElementById("dispoToggle");
    toggle.checked = dispoMode;
    toggle.addEventListener("change", async () => {
      dispoMode = toggle.checked;
      await db.collection("users").doc(risProfile.uid).update({ dispoMode });
      route();
    });
  }

  if (!location.hash) location.hash = "#/uebersicht";
  route();
});
function logout() { auth.signOut().then(() => location.href = "index.html"); }

// ---------- Router ----------
window.addEventListener("hashchange", route);
function route() {
  if (!risProfile) return;
  const hash = location.hash || "#/uebersicht";
  if (hash === "#/uebersicht") { renderUebersicht(); return; }
  if (hash.startsWith("#/bahnhof/")) { renderBahnhof(hash.split("/")[2]); return; }
  if (hash.startsWith("#/fahrt/")) { renderFahrt(hash.split("/")[2]); return; }
  renderUebersicht();
}

// ---------- Übersicht (3-geteilte Startseite) ----------
async function renderUebersicht() {
  risApp.innerHTML = `
  <div class="panel fade-in">
    <h2>Online Fahrplan</h2>
    <p style="color:var(--ink-soft); font-size:.9rem;">Angemeldet als <strong>${escapeHtml(risProfile.username)}</strong> (${RIS_ROLE_LABEL[risProfile.role]})${risProfile.role === "hr" ? (dispoMode ? " · Dispo-Modus aktiv" : "") : ""}.</p>
  </div>

  <div class="ris-grid">
    <div class="panel">
      <div class="toolbar"><h2>Bahnhöfe</h2>${canManage("hr") ? `<button class="btn btn-ghost btn-sm" onclick="toggleForm('stationForm')">+ Bahnhof</button>` : ""}</div>
      ${risProfile.role === "hr" && !dispoMode ? `<p class="hint">Aktiviere den Dispo-Modus in der Seitenleiste, um Bahnhöfe anzulegen.</p>` : ""}
      <form id="stationForm" class="form hidden" style="margin-bottom:14px;">
        <div class="form-row">
          <label>Name <input type="text" id="stName" placeholder="z. B. Bergenau Hauptbahnhof" required></label>
          <label>Kürzel <input type="text" id="stKuerzel" placeholder="z. B. BHBF"></label>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Bahnhof speichern</button>
      </form>
      <div id="stationGrid" class="station-grid">Lädt…</div>
    </div>

    <div class="panel">
      <h2>Zug- &amp; Liniensuche</h2>
      <div class="search-bar">
        <input type="text" id="fahrtSearch" placeholder="Zugnummer oder Linie, z. B. RB16 16008">
        <button class="btn btn-primary btn-sm" onclick="doFahrtSearch()">Suchen</button>
      </div>
      <p class="hint">Fahrten werden nicht manuell angelegt, sondern folgen künftig automatisch aus der Roblox-Anbindung.</p>
      <div id="fahrtResults"></div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar"><h2>Meldungen</h2>${canManage("fdl") ? `<button class="btn btn-ghost btn-sm" onclick="toggleForm('meldungForm')">+ Meldung</button>` : ""}</div>
    ${risProfile.role === "hr" && !dispoMode ? `<p class="hint">Aktiviere den Dispo-Modus in der Seitenleiste, um Meldungen anzulegen.</p>` : ""}
    <form id="meldungForm" class="form hidden" style="margin-bottom:14px;">
      <div class="form-row">
        <label>Bahnhof / Bereich 1 <input type="text" id="mBf1" placeholder="z. B. Nordtal"></label>
        <label>Bahnhof / Bereich 2 (optional) <input type="text" id="mBf2" placeholder="z. B. Waldstadt"></label>
      </div>
      <label>Titel <input type="text" id="mTitel" placeholder="z. B. Bauarbeiten" required></label>
      <label>Text <textarea id="mText" placeholder="Beschreibung der Meldung"></textarea></label>
      <label>Art
        <select id="mArt">
          <option value="info">Info</option>
          <option value="warnung">Warnung</option>
          <option value="stoerung">Störung</option>
        </select>
      </label>
      <button type="submit" class="btn btn-primary btn-sm">Meldung speichern</button>
    </form>
    <div id="meldungList">Lädt…</div>
  </div>

  <div class="ris-grid">
    <div class="panel">
      <h2>Verlauf</h2>
      <div class="recent-list" id="recentList"></div>
    </div>
    <div class="panel">
      <h2>Netzübersicht</h2>
      <img src="assets/netzkarte.png" alt="Netzkarte" class="netzkarte-img"
           onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'map-placeholder',textContent:'Netzkarte (assets/netzkarte.png) nicht gefunden.'}))">
    </div>
  </div>

  <div class="summary-cards" id="summaryCards"></div>
  `;

  document.getElementById("stationForm").addEventListener("submit", createStation);
  document.getElementById("meldungForm").addEventListener("submit", createMeldung);
  document.getElementById("fahrtSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") doFahrtSearch(); });

  paintRecent();
  await Promise.all([loadStations(), loadMeldungen(), loadSummary()]);
}

function toggleForm(id) { document.getElementById(id).classList.toggle("hidden"); }

function paintRecent() {
  const list = risGetRecent();
  const el = document.getElementById("recentList");
  if (!el) return;
  if (list.length === 0) { el.innerHTML = `<div class="empty-state">Noch nichts aufgerufen.</div>`; return; }
  el.innerHTML = list.map(r => `<a href="#/${r.type}/${r.id}">${escapeHtml(r.label)}</a>`).join("");
}

// ---------- Bahnhöfe ----------
async function loadStations() {
  const grid = document.getElementById("stationGrid");
  try {
    const snap = await db.collection("stations").orderBy("name").get();
    if (snap.empty) { grid.innerHTML = `<div class="empty-state">Noch keine Bahnhöfe eingetragen.</div>`; return; }
    const stations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    grid.innerHTML = stations.map(s => `
      <div class="station-card" onclick="location.hash='#/bahnhof/${s.id}'">
        ${escapeHtml(s.name)}
        <div class="kuerzel">${escapeHtml(s.kuerzel || "")}</div>
      </div>`).join("");
  } catch (e) { console.error(e); grid.innerHTML = `<div class="empty-state">Fehler beim Laden.</div>`; }
}
async function createStation(e) {
  e.preventDefault();
  if (!canManage("hr")) { alert("Dafür muss der Dispo-Modus aktiv sein."); return; }
  const name = document.getElementById("stName").value.trim();
  const kuerzel = document.getElementById("stKuerzel").value.trim();
  if (!name) return;
  await db.collection("stations").add({ name, kuerzel, createdAt: Date.now(), createdBy: risProfile.username });
  document.getElementById("stationForm").reset();
  document.getElementById("stationForm").classList.add("hidden");
  loadStations();
}

async function renderBahnhof(id) {
  risApp.innerHTML = `<div class="panel fade-in">Lädt…</div>`;
  const doc = await db.collection("stations").doc(id).get();
  if (!doc.exists) { risApp.innerHTML = `<div class="panel">Bahnhof nicht gefunden.</div>`; return; }
  const s = doc.data();
  risAddRecent("bahnhof", id, s.name);

  const snap = await db.collection("fahrten").where("bahnhofIds", "array-contains", id).limit(200).get();
  const fahrtDocs = snap.docs.slice().sort((a, b) => (a.data().abfahrtStart || 0) - (b.data().abfahrtStart || 0));

  risApp.innerHTML = `
  <div class="panel fade-in">
    <a onclick="history.back()" style="cursor:pointer; font-size:.82rem; color:var(--ink-soft);">← Zurück</a>
    <h2 style="margin-top:8px;">${escapeHtml(s.name)} ${s.kuerzel ? `<span class="mono" style="color:var(--ink-soft); font-size:.8rem;">(${escapeHtml(s.kuerzel)})</span>` : ""}</h2>
  </div>
  <div class="panel">
    <h2>Abfahrten &amp; Ankünfte</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Zug</th><th>Start → Ziel</th><th>Abfahrt (Start)</th><th>Ankunft (Ziel)</th><th>Verspätung</th><th>Typ</th></tr></thead>
      <tbody>
        ${fahrtDocs.length === 0 ? `<tr><td colspan="6" class="empty-state">Noch keine Zugfahrten für diesen Bahnhof hinterlegt.</td></tr>` :
          fahrtDocs.map(d => {
            const f = d.data();
            return `<tr style="cursor:pointer;" onclick="location.hash='#/fahrt/${d.id}'">
              <td class="mono">${escapeHtml(f.zugnummer)}</td>
              <td>${escapeHtml(f.startBfName)} → ${escapeHtml(f.zielBfName)}</td>
              <td>${fmtDateTime(f.abfahrtStart)}</td>
              <td>${fmtDateTime(f.ankunftZiel)}</td>
              <td>${f.verspaetungMin ? `+${f.verspaetungMin} min${f.verspaetungGrund ? " – " + escapeHtml(f.verspaetungGrund) : ""}` : "pünktlich"}</td>
              <td>${escapeHtml(f.typ || "–")}</td>
            </tr>`;
          }).join("")}
      </tbody>
    </table></div>
  </div>`;
}

// ---------- Zug- & Liniensuche ----------
async function doFahrtSearch() {
  const q = document.getElementById("fahrtSearch").value.trim().toLowerCase();
  const resultsEl = document.getElementById("fahrtResults");
  resultsEl.innerHTML = "Suche…";
  if (!q) { resultsEl.innerHTML = ""; return; }
  try {
    const snap = await db.collection("fahrten").orderBy("abfahrtStart", "desc").limit(300).get();
    const matches = snap.docs.filter(d => {
      const f = d.data();
      return f.zugnummer?.toLowerCase().includes(q) || f.linie?.toLowerCase().includes(q);
    });
    if (matches.length === 0) { resultsEl.innerHTML = `<div class="empty-state">Keine Treffer.</div>`; return; }
    resultsEl.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Zug</th><th>Linie</th><th>Start → Ziel</th><th>Abfahrt</th></tr></thead>
      <tbody>${matches.map(d => {
        const f = d.data();
        return `<tr style="cursor:pointer;" onclick="location.hash='#/fahrt/${d.id}'">
          <td class="mono">${escapeHtml(f.zugnummer)}</td>
          <td>${escapeHtml(f.linie || "–")}</td>
          <td>${escapeHtml(f.startBfName)} → ${escapeHtml(f.zielBfName)}</td>
          <td>${fmtDateTime(f.abfahrtStart)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch (e) { console.error(e); resultsEl.innerHTML = `<div class="empty-state">Fehler bei der Suche.</div>`; }
}

// ---------- Fahrt-Detail ----------
async function renderFahrt(id) {
  risApp.innerHTML = `<div class="panel fade-in">Lädt…</div>`;
  const ref = db.collection("fahrten").doc(id);
  const doc = await ref.get();
  if (!doc.exists) { risApp.innerHTML = `<div class="panel">Fahrt nicht gefunden.</div>`; return; }
  const f = doc.data();
  risAddRecent("fahrt", id, `${f.zugnummer} · ${f.startBfName} → ${f.zielBfName}`);

  risApp.innerHTML = `
  <div class="panel fade-in">
    <a onclick="history.back()" style="cursor:pointer; font-size:.82rem; color:var(--ink-soft);">← Zurück</a>
  </div>
  <div class="command-doc fade-in">
    <div class="command-doc-head">
      <div><h2>${escapeHtml(f.zugnummer)}</h2><p>${escapeHtml(f.linie || "")} ${f.typ ? "· " + escapeHtml(f.typ) : ""}</p></div>
      <div class="meta">Status
        <div style="margin-top:8px;"><span class="status-pill status-${f.status === "normal" ? "STANDORT_BESTAETIGT" : f.status === "ausfall" ? "UNGUELTIG" : "STANDORT_GESENDET"}">${FAHRT_STATUS_LABEL[f.status] || f.status}</span></div>
      </div>
    </div>
    <div class="command-section">
      <h3>Fahrtverlauf</h3>
      <div class="timeline">
        <div class="timeline-stop">
          <div class="name">${escapeHtml(f.startBfName)}</div>
          <div class="times"><span>Abfahrt: ${fmtDateTime(f.abfahrtStart)}</span></div>
        </div>
        <div class="timeline-stop">
          <div class="name">${escapeHtml(f.zielBfName)}</div>
          <div class="times"><span>Ankunft: ${fmtDateTime(f.ankunftZiel)}</span></div>
        </div>
      </div>
    </div>
    <div class="command-section">
      <h3>Verspätung</h3>
      <p>${f.verspaetungMin ? `+${f.verspaetungMin} Minuten${f.verspaetungGrund ? " – " + escapeHtml(f.verspaetungGrund) : ""}` : "Keine Verspätung gemeldet."}</p>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar"><h2>Anschlüsse</h2>${canManage("fdl") ? `<button class="btn btn-ghost btn-sm" onclick="toggleForm('anschlussForm')">+ Anschluss</button>` : ""}</div>
    <form id="anschlussForm" class="form hidden" style="margin-bottom:14px;">
      <div class="form-row">
        <label>Bahnhof <input type="text" id="aBahnhof" placeholder="z. B. Nordtal"></label>
        <label>Ziel des Anschlusses <input type="text" id="aZiel" placeholder="z. B. Bergenau Hauptbahnhof"></label>
      </div>
      <div class="form-row">
        <label>Abfahrt <input type="datetime-local" id="aAbfahrt"></label>
        <label>Gleis <input type="text" id="aGleis"></label>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Anschluss speichern</button>
    </form>
    <div id="anschlussList">Lädt…</div>
  </div>`;

  document.getElementById("anschlussForm").addEventListener("submit", (e) => createAnschluss(e, id));
  loadAnschluesse(id);
}

async function loadAnschluesse(fahrtId) {
  const el = document.getElementById("anschlussList");
  try {
    const snap = await db.collection("fahrten").doc(fahrtId).collection("anschluesse").orderBy("abfahrt").get();
    if (snap.empty) { el.innerHTML = `<div class="empty-state">Noch keine Anschlüsse hinterlegt.</div>`; return; }
    const canDispo = risProfile.role === "hr" && dispoMode;
    el.innerHTML = snap.docs.map(d => {
      const a = d.data();
      return `<div class="anschluss-row">
        <div>
          <b>${escapeHtml(a.ziel)}</b> ab ${escapeHtml(a.bahnhof || "–")}, ${fmtDateTime(a.abfahrt)}${a.gleis ? ", Gleis " + escapeHtml(a.gleis) : ""}
        </div>
        ${canDispo
          ? `<div class="anschluss-status">
              <button class="${a.status === "wartet" ? "active-wartet" : ""}" onclick="setAnschlussStatus('${fahrtId}','${d.id}','wartet')">wartet</button>
              <button class="${a.status === "nicht" ? "active-nicht" : ""}" onclick="setAnschlussStatus('${fahrtId}','${d.id}','nicht')">nicht</button>
            </div>`
          : `<span class="status-pill status-${a.status === "wartet" ? "STANDORT_BESTAETIGT" : a.status === "nicht" ? "UNGUELTIG" : "FREIGEGEBEN"}">${a.status === "wartet" ? "wartet" : a.status === "nicht" ? "wartet nicht" : "offen"}</span>`}
      </div>`;
    }).join("");
  } catch (e) { console.error(e); el.innerHTML = `<div class="empty-state">Fehler beim Laden.</div>`; }
}
async function createAnschluss(e, fahrtId) {
  e.preventDefault();
  if (!canManage("fdl")) { alert("Dafür muss (bei HR) der Dispo-Modus aktiv sein."); return; }
  const abfahrt = document.getElementById("aAbfahrt").value ? new Date(document.getElementById("aAbfahrt").value).getTime() : null;
  await db.collection("fahrten").doc(fahrtId).collection("anschluesse").add({
    bahnhof: document.getElementById("aBahnhof").value.trim(),
    ziel: document.getElementById("aZiel").value.trim(),
    abfahrt, gleis: document.getElementById("aGleis").value.trim(),
    status: "offen", createdAt: Date.now(), createdBy: risProfile.username,
  });
  document.getElementById("anschlussForm").reset();
  document.getElementById("anschlussForm").classList.add("hidden");
  loadAnschluesse(fahrtId);
}
async function setAnschlussStatus(fahrtId, anschlussId, status) {
  await db.collection("fahrten").doc(fahrtId).collection("anschluesse").doc(anschlussId).update({ status, disponiertVon: risProfile.username, disponiertAm: Date.now() });
  loadAnschluesse(fahrtId);
}

// ---------- Meldungen ----------
async function loadMeldungen() {
  const el = document.getElementById("meldungList");
  try {
    const snap = await db.collection("meldungen").orderBy("createdAt", "desc").limit(50).get();
    if (snap.empty) { el.innerHTML = `<div class="empty-state">Noch keine Meldungen.</div>`; return; }
    el.innerHTML = snap.docs.map(d => {
      const m = d.data();
      return `<div class="news-item">
        <div class="head">
          <span class="titel">${escapeHtml(m.titel)}</span>
          <span class="tag tag-${m.art}">${MELDUNG_ART_LABEL[m.art] || m.art}</span>
        </div>
        <div class="text">${escapeHtml(m.text || "")}</div>
        ${(m.bahnhof1 || m.bahnhof2) ? `<div class="orte">${escapeHtml(m.bahnhof1 || "")}${m.bahnhof2 ? " ↔ " + escapeHtml(m.bahnhof2) : ""}</div>` : ""}
        ${(risProfile.role === "fdl" || risProfile.role === "hr") ? `<button class="btn btn-danger btn-sm" style="margin-top:8px;" onclick="deleteMeldung('${d.id}')">Löschen</button>` : ""}
      </div>`;
    }).join("");
  } catch (e) { console.error(e); el.innerHTML = `<div class="empty-state">Fehler beim Laden.</div>`; }
}
async function createMeldung(e) {
  e.preventDefault();
  if (!canManage("fdl")) { alert("Dafür muss (bei HR) der Dispo-Modus aktiv sein."); return; }
  const titel = document.getElementById("mTitel").value.trim();
  if (!titel) return;
  await db.collection("meldungen").add({
    titel, text: document.getElementById("mText").value.trim(),
    art: document.getElementById("mArt").value,
    bahnhof1: document.getElementById("mBf1").value.trim(),
    bahnhof2: document.getElementById("mBf2").value.trim(),
    aktiv: true, createdAt: Date.now(), createdBy: risProfile.username,
  });
  document.getElementById("meldungForm").reset();
  document.getElementById("meldungForm").classList.add("hidden");
  loadMeldungen();
}
async function deleteMeldung(id) {
  if (!confirm("Meldung löschen?")) return;
  await db.collection("meldungen").doc(id).delete();
  loadMeldungen();
}

// ---------- Zusammenfassung ----------
async function loadSummary() {
  const el = document.getElementById("summaryCards");
  try {
    const snap = await db.collection("fahrten").get();
    const counts = { gesamt: 0, ausfall: 0, teilausfall: 0, ersatz: 0, verspaetet: 0 };
    snap.forEach(d => {
      const f = d.data();
      counts.gesamt++;
      if (f.status === "ausfall") counts.ausfall++;
      if (f.status === "teilausfall") counts.teilausfall++;
      if (f.status === "ersatz") counts.ersatz++;
      if (f.verspaetungMin > 0) counts.verspaetet++;
    });
    const meldSnap = await db.collection("meldungen").get();
    el.innerHTML = `
      <div class="summary-card"><h3>Netzstatus</h3>
        <div class="summary-row"><span>Fahrten gesamt</span><b>${counts.gesamt}</b></div>
        <div class="summary-row"><span>Verspätete Fahrten</span><b>${counts.verspaetet}</b></div>
        <div class="summary-row"><span>Meldungen aktiv</span><b>${meldSnap.size}</b></div>
      </div>
      <div class="summary-card"><h3>Ausfälle</h3>
        <div class="summary-row"><span>Vollausfälle</span><b>${counts.ausfall}</b></div>
        <div class="summary-row"><span>Teilausfälle</span><b>${counts.teilausfall}</b></div>
      </div>
      <div class="summary-card"><h3>Ersatz-/Zusatzfahrten</h3>
        <div class="summary-row"><span>Aktuell hinterlegt</span><b>${counts.ersatz}</b></div>
      </div>`;
  } catch (e) { console.error(e); el.innerHTML = ""; }
}
