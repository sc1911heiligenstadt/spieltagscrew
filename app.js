// Spieltagscrew — wer übernimmt bei den Heimspielen welchen Posten.
//
// Wie bei den Vereinsaufgaben hält dieser Client KEINEN eigenen Datenbestand, den
// er als Ganzes zurückschreibt. Jede Änderung ist ein eigener Worker-Aufruf, der
// serverseitig geprüft wird; danach wird neu geladen. Deshalb gibt es hier weder
// einen Debounce-Save noch einen In-Flight-Guard — es kann gar keinen
// überlappenden Gesamt-Save geben.

let currentUser = null;
let jobKatalog = [];
let spieltage = [];
let einstellungen = {};
let lauf = null;
let personen = [];          // {username, displayName} — wer diese App bearbeiten darf
let anzeigeNamen = {};      // username -> Anzeigename, auch für Ausgeschiedene
let aktuellerTab = "spieltage";

// Arbeitskopien der beiden Editoren. Bewusst als JS-Array und nicht im DOM: die
// Listen werden beim Hinzufügen und Entfernen neu gezeichnet, ein DOM-Abgriff
// erst beim Speichern würde die Zwischenstände verschlucken.
let katalogEntwurf = [];
let sfJobsEntwurf = [];
let sfSpieltagId = null;
let offenerPosten = null;   // { spieltagId, jobId }

function canEdit()  { return !!(currentUser && (currentUser.isAdmin || currentUser.canEdit));  }
function canAdmin() { return !!(currentUser && (currentUser.isAdmin || currentUser.canAdmin)); }

// ---------- Helfer ----------

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function nameVon(username) {
  if (!username) return "—";
  return anzeigeNamen[username] || username;
}

function heuteIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function datumLesbar(iso) {
  if (!iso) return "—";
  const t = String(iso).split("-");
  if (t.length !== 3) return iso;
  return `${t[2]}.${t[1]}.${t[0]}`;
}

const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function wochentagVon(iso) {
  const t = String(iso || "").split("-");
  if (t.length !== 3) return "";
  const d = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
  return isNaN(d.getTime()) ? "" : WOCHENTAGE[d.getDay()];
}

function zeitLesbar(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Rechnet aus dem Anstoß und einem Minutenversatz die echte Uhrzeit. Der Versatz
// ist negativ für "vor dem Anpfiff". Rückgabe { zeit, tagVersatz } — ein Aufbau
// um 6:00 bei einem 7:30-Anstoß ist derselbe Tag, ein Abbau nach einem
// Abendspiel kann in den Folgetag laufen, und das muss dranstehen: "01:00 Uhr"
// ohne Hinweis liest sich sonst wie ein Vormittagstermin.
function zeitVersetzt(anstoss, min) {
  const teile = String(anstoss || "15:00").split(":");
  const basis = (Number(teile[0]) || 0) * 60 + (Number(teile[1]) || 0);
  const roh = basis + Number(min || 0);
  const tagVersatz = Math.floor(roh / 1440);
  const imTag = ((roh % 1440) + 1440) % 1440;
  const zeit = String(Math.floor(imTag / 60)).padStart(2, "0") + ":" + String(imTag % 60).padStart(2, "0");
  return { zeit, tagVersatz };
}

function zeitfensterText(spieltag, job) {
  if (job.vonMin == null && job.bisMin == null) return "";
  const von = zeitVersetzt(spieltag.anstoss, job.vonMin);
  const bis = zeitVersetzt(spieltag.anstoss, job.bisMin);
  let text = `${von.zeit}–${bis.zeit} Uhr`;
  if (von.tagVersatz < 0) text += " (Vortag)";
  else if (bis.tagVersatz > 0) text += " (bis Folgetag)";
  return text;
}

// Ein Spieltag zählt bis zum Ende seines Kalendertages als kommend — am
// Spieltag selbst will man ihn ja gerade sehen. Dieselbe Grenze prüft der
// Worker beim Eintragen.
function istVergangen(s) {
  return String(s.datum || "") < heuteIso();
}

function wettbewerbInfo(id) {
  return WETTBEWERBE.find((w) => w.id === id) || WETTBEWERBE[0];
}

function jobSpaltenSchluessel(job) {
  return job.katalogId ? "k:" + job.katalogId : "n:" + String(job.name || "").trim().toLowerCase();
}

function besetzungVon(job) {
  return Array.isArray(job.besetzung) ? job.besetzung : [];
}

function standKlasse(job) {
  const da = besetzungVon(job).length;
  const soll = Number(job.anzahl) || 0;
  if (soll <= 0) return "keiner";
  if (da >= soll) return "voll";
  if (da === 0) return "leer";
  return "teil";
}

function freiePlaetze(s) {
  return (s.jobs || []).reduce((n, j) => n + Math.max(0, (Number(j.anzahl) || 0) - besetzungVon(j).length), 0);
}

function sollPlaetze(s) {
  return (s.jobs || []).reduce((n, j) => n + Math.max(0, Number(j.anzahl) || 0), 0);
}

// Auf welchem Posten steht die angemeldete Person an diesem Spieltag? Je
// Spieltag kann das höchstens einer sein — der Worker lässt keinen zweiten zu.
function meinPosten(s) {
  if (!currentUser) return null;
  return (s.jobs || []).find((j) => besetzungVon(j).some((b) => b.username === currentUser.username)) || null;
}

function kommendeSpieltage() {
  return spieltage.filter((s) => !istVergangen(s))
    .sort((a, b) => String(a.datum).localeCompare(String(b.datum)) || String(a.anstoss).localeCompare(String(b.anstoss)));
}

function vergangeneSpieltage() {
  return spieltage.filter(istVergangen)
    .sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
}

function setStatusText(text, istFehler) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("error", !!istFehler);
  if (text && !istFehler) setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 2500);
}

function zeigeFehler(e) {
  if (e instanceof NotLoggedInError) { zeigeLoginGate(e.message); return; }
  const text = e && e.message ? e.message : "Unbekannter Fehler";
  setStatusText(text, true);
  alert(text);
}

function zeigeLoginGate(text) {
  // ⚠️ Verstecken ist nicht Räumen. Diese Funktion wird auch MITTEN IM BETRIEB
  // gerufen — ein Speichern scheitert, weil die Sitzung abgelaufen ist. Dann
  // steht bereits alles auf dem Bildschirm, und display:none lässt es nur
  // unsichtbar im DOM zurück: Namen, Adressen, Beträge, offene Formularfelder.
  //
  // Wegwerfen ist hier gefahrlos: der Weg zurück in die App führt ausschließlich
  // über ein Neuladen der Seite (startApp() wird nur aus init() gerufen, nirgends
  // sonst). Wer sich neu anmeldet, bekommt die Seite ohnehin frisch aufgebaut.
  const __huelle = document.getElementById("app-shell");
  if (__huelle) __huelle.innerHTML = "";
  document.getElementById("app-shell").style.display = "none";
  document.getElementById("connect-screen").style.display = "flex";
  if (text) document.getElementById("cloud-error").textContent = text;
}

// ---------- Laden ----------

async function ladeDaten() {
  const body = await ladeAlles();
  // `me` kommt aus derselben Antwort — deshalb gibt es hier keinen eigenen
  // fetchMe()-Aufruf beim Start.
  if (body.me) currentUser = body.me;
  jobKatalog = Array.isArray(body.jobKatalog) ? body.jobKatalog : [];
  spieltage = Array.isArray(body.spieltage) ? body.spieltage : [];
  einstellungen = body.einstellungen || Object.assign({}, DEFAULT_EINSTELLUNGEN);
  lauf = body.lauf || null;
  // Anzeigenamen kommen aus der Nutzerverwaltung, nicht aus dem Eintrag: nach
  // einer Umbenennung soll ein alter Eintrag nicht den früheren Namen zeigen.
  anzeigeNamen = body.namen && typeof body.namen === "object" ? body.namen : {};
}

async function ladePersonen() {
  try {
    const body = await ladeMoeglicheHelfer();
    personen = Array.isArray(body.users) ? body.users : [];
    personen.forEach((p) => { if (p.username && p.displayName) anzeigeNamen[p.username] = p.displayName; });
  } catch (_) {
    // Die Personenliste braucht nur der Fremdeintrag. Fällt sie aus, bleibt die
    // App vollständig benutzbar — deshalb kippt sie den Start nicht.
    personen = [];
  }
}

// ---------- Rendering: Kennzahlen ----------

function renderSummary() {
  const kommend = kommendeSpieltage();
  const naechster = kommend[0] || null;
  const offenGesamt = kommend.reduce((n, s) => n + freiePlaetze(s), 0);
  const meine = kommend.filter((s) => meinPosten(s)).length;

  const kacheln = [];
  kacheln.push(kachel("Nächstes Heimspiel",
    naechster ? `${wochentagVon(naechster.datum)} ${datumLesbar(naechster.datum)}` : "—",
    naechster ? `${escapeHtml(naechster.anstoss || "")} Uhr · ${escapeHtml(naechster.gegner || "")}` : "kein Spieltag angelegt", ""));
  kacheln.push(kachel("Offene Posten", String(offenGesamt),
    offenGesamt === 0 ? "alles besetzt" : `über ${kommend.length} kommende Spieltage`,
    offenGesamt === 0 ? "ok" : "warn"));
  kacheln.push(kachel("Meine Einsätze", String(meine),
    meine === 0 ? "du bist noch nirgends eingetragen" : "kommende Spieltage", meine > 0 ? "ok" : ""));

  document.getElementById("summary-cards").innerHTML = kacheln.join("");
}

function kachel(label, wert, sub, klasse) {
  return `<div class="summary-card ${klasse}">
    <div class="sc-label">${escapeHtml(label)}</div>
    <div class="sc-value">${escapeHtml(wert)}</div>
    <div class="sc-sub">${sub}</div>
  </div>`;
}

// ---------- Rendering: Gitter (ab 768 px) ----------

// Die Posten eines Spieltags sind eigene Kopien — zwei Spieltage können deshalb
// unterschiedliche Posten führen. Die Spalten sind die Vereinigungsmenge, in der
// Reihenfolge des Katalogs; ein Spieltag ohne diesen Posten bekommt eine
// ausdrücklich leere Zelle statt einer Lücke, die wie „niemand da“ aussieht.
function gitterSpalten(liste) {
  const spalten = [];
  const gesehen = Object.create(null);
  const merke = (job) => {
    const key = jobSpaltenSchluessel(job);
    if (gesehen[key]) return;
    gesehen[key] = true;
    spalten.push({ key, name: job.name, vonMin: job.vonMin, bisMin: job.bisMin });
  };
  jobKatalog.forEach((k) => {
    if (liste.some((s) => (s.jobs || []).some((j) => jobSpaltenSchluessel(j) === "k:" + k.id))) {
      merke({ katalogId: k.id, name: k.name, vonMin: k.vonMin, bisMin: k.bisMin });
    }
  });
  liste.forEach((s) => (s.jobs || []).forEach(merke));
  return spalten;
}

function renderGitter(liste) {
  const tab = document.getElementById("gitter");
  if (!liste.length) { tab.innerHTML = ""; return; }
  const spalten = gitterSpalten(liste);

  const kopf = `<thead><tr>
    <th class="spieltag-kopf">Spieltag</th>
    ${spalten.map((sp) => `<th class="job-kopf">${escapeHtml(sp.name)}${
      sp.vonMin != null ? `<span class="jk-zeit">${sp.vonMin > 0 ? "+" : ""}${sp.vonMin} bis ${sp.bisMin > 0 ? "+" : ""}${sp.bisMin} Min.</span>` : ""
    }</th>`).join("")}
  </tr></thead>`;

  const zeilen = liste.map((s) => {
    const w = wettbewerbInfo(s.wettbewerb);
    const zellen = spalten.map((sp) => {
      const job = (s.jobs || []).find((j) => jobSpaltenSchluessel(j) === sp.key);
      if (!job) return `<td><span class="muted">–</span></td>`;
      const bes = besetzungVon(job);
      const namen = bes.map((b) => `<span class="${b.username === (currentUser && currentUser.username) ? "ich" : ""}">${escapeHtml(nameVon(b.username))}</span>`).join("<br />");
      return `<td>
        <button type="button" class="zelle-btn" data-posten="${escapeHtml(s.id)}|${escapeHtml(job.id)}">
          <span class="stand-badge ${standKlasse(job)}">${bes.length}/${Number(job.anzahl) || 0}</span>
          <span class="zelle-namen">${namen || ""}</span>
        </button></td>`;
    }).join("");
    return `<tr>
      <td class="spieltag-zelle">
        <span class="st-datum">${escapeHtml(wochentagVon(s.datum))} ${escapeHtml(datumLesbar(s.datum))} · ${escapeHtml(s.anstoss || "")} Uhr</span>
        <span class="st-gegner">${escapeHtml(s.gegner || "")} <span class="st-wettbewerb" style="background:${w.farbe}">${escapeHtml(w.label)}</span></span>
      </td>${zellen}</tr>`;
  }).join("");

  tab.innerHTML = kopf + `<tbody>${zeilen}</tbody>`;
}

// ---------- Rendering: Karten (unter 768 px und für Vergangenes) ----------

function renderKarten(liste, container, nurLesen) {
  container.innerHTML = liste.map((s) => {
    const w = wettbewerbInfo(s.wettbewerb);
    const frei = freiePlaetze(s);
    const mein = meinPosten(s);
    const zeilen = (s.jobs || []).map((job) => {
      const bes = besetzungVon(job);
      const soll = Number(job.anzahl) || 0;
      const binDrin = bes.some((b) => b.username === (currentUser && currentUser.username));
      const namen = bes.length
        ? bes.map((b) => `<span class="${b.username === (currentUser && currentUser.username) ? "ich" : ""}">${escapeHtml(nameVon(b.username))}</span>`).join(", ")
        : "<em>noch niemand</em>";
      let knopf = "";
      if (!nurLesen && canEdit()) {
        if (binDrin) {
          knopf = `<button type="button" class="btn small secondary" data-austragen="${escapeHtml(s.id)}|${escapeHtml(job.id)}">Austragen</button>`;
        } else if (bes.length < soll) {
          // Wer an diesem Spieltag schon woanders steht, bekommt den Knopf gar
          // nicht erst — sonst führt der Klick nur in eine 409-Meldung.
          knopf = mein
            ? `<span class="helfer-meta">du hilfst hier bei „${escapeHtml(mein.name)}“</span>`
            : `<button type="button" class="btn small" data-eintragen="${escapeHtml(s.id)}|${escapeHtml(job.id)}">Eintragen</button>`;
        }
      }
      // Der Postenname öffnet den Dialog — für ALLE, nicht nur für Bearbeiter.
      // Dort stehen Beschreibung und vollständige Besetzung; ein Nur-Seher käme
      // am Handy sonst gar nicht an diese Angaben heran.
      return `<div class="posten-zeile ${bes.length >= soll ? "voll" : ""}">
        <div class="pz-links">
          <button type="button" class="pz-name pz-name-btn" data-posten="${escapeHtml(s.id)}|${escapeHtml(job.id)}">${escapeHtml(job.name)} <span class="stand-badge ${standKlasse(job)}" style="font-size:11px;padding:1px 8px;min-width:0;">${bes.length}/${soll}</span></button>
          <span class="pz-zeit">${escapeHtml(zeitfensterText(s, job))}</span>
          <span class="pz-besetzung">${namen}</span>
        </div>
        <div class="pz-rechts">${knopf}</div>
      </div>`;
    }).join("");

    return `<div class="spieltag-karte ${frei > 0 && !nurLesen ? "hat-luecke" : ""}">
      <div class="sk-kopf">
        <div class="sk-kopf-links">
          <span class="sk-titel">${escapeHtml(wochentagVon(s.datum))} ${escapeHtml(datumLesbar(s.datum))} · ${escapeHtml(s.anstoss || "")} Uhr</span>
          <span class="sk-sub">gegen ${escapeHtml(s.gegner || "—")} · ${escapeHtml(wettbewerbInfo(s.wettbewerb).label)}${s.notiz ? " · " + escapeHtml(s.notiz) : ""}</span>
        </div>
        <span class="sk-stand ${frei === 0 ? "voll" : "offen"}">${frei === 0 ? "vollständig besetzt" : frei + " frei"}</span>
      </div>
      <div class="sk-body">
        ${zeilen || `<p class="muted">Für diesen Spieltag ist kein Posten hinterlegt.</p>`}
        <div class="btn-row" style="justify-content:flex-start;margin-top:4px;">
          <button type="button" class="btn tiny secondary" data-aushang="${escapeHtml(s.id)}">🖨 Aushang drucken</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderSpieltage() {
  const liste = kommendeSpieltage();
  document.getElementById("spieltage-empty").classList.toggle("hidden", liste.length > 0);
  document.getElementById("gitter-wrap").classList.toggle("hidden", liste.length === 0);
  document.getElementById("spieltage-hinweis").textContent = liste.length
    ? "Am Rechner als Gitter, am Handy als Liste — dieselben Daten. Ein Klick auf einen Posten zeigt, wer dort steht."
    : "";
  renderGitter(liste);
  renderKarten(liste, document.getElementById("karten-wrap"), false);
}

function renderVergangene() {
  const liste = vergangeneSpieltage();
  document.getElementById("vergangene-empty").classList.toggle("hidden", liste.length > 0);
  renderKarten(liste, document.getElementById("vergangene-liste"), true);
}

// ---------- Rendering: Job-Katalog (Administrieren) ----------

function jobZeileHtml(job, idx, praefix) {
  return `<div class="job-row" data-idx="${idx}">
    <input class="jr-name" type="text" maxlength="80" placeholder="Posten" value="${escapeHtml(job.name || "")}" />
    <input class="jr-beschreibung" type="text" maxlength="200" placeholder="Kurze Beschreibung" value="${escapeHtml(job.beschreibung || "")}" />
    <input class="jr-anzahl" type="number" min="1" max="50" step="1" value="${Number(job.anzahl) || 1}" />
    <input class="jr-von" type="number" min="-600" max="600" step="5" value="${job.vonMin == null ? -90 : Number(job.vonMin)}" />
    <input class="jr-bis" type="number" min="-600" max="600" step="5" value="${job.bisMin == null ? 0 : Number(job.bisMin)}" />
    <button type="button" class="icon-btn" data-${praefix}-weg="${idx}" title="Posten entfernen">×</button>
  </div>`;
}

function liesJobsAusDom(containerId) {
  const raus = [];
  document.querySelectorAll(`#${containerId} .job-row`).forEach((row) => {
    raus.push({
      name: row.querySelector(".jr-name").value.trim(),
      beschreibung: row.querySelector(".jr-beschreibung").value.trim(),
      anzahl: Number(row.querySelector(".jr-anzahl").value) || 1,
      vonMin: Number(row.querySelector(".jr-von").value) || 0,
      bisMin: Number(row.querySelector(".jr-bis").value) || 0
    });
  });
  return raus;
}

function renderKatalog() {
  const el = document.getElementById("katalog-liste");
  el.innerHTML = katalogEntwurf.map((j, i) => jobZeileHtml(j, i, "kat")).join("")
    || `<p class="muted">Noch kein Posten im Katalog.</p>`;
  document.getElementById("btn-katalog-vorschlag").classList.toggle("hidden", katalogEntwurf.length > 0);
}

// ---------- Rendering: Spieltage verwalten ----------

function renderSpieltagAdmin() {
  const el = document.getElementById("spieltag-admin-liste");
  const liste = spieltage.slice().sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
  document.getElementById("spieltag-admin-empty").classList.toggle("hidden", liste.length > 0);
  el.innerHTML = liste.map((s) => {
    const frei = freiePlaetze(s);
    return `<div class="posten-zeile">
      <div class="pz-links">
        <span class="pz-name">${escapeHtml(wochentagVon(s.datum))} ${escapeHtml(datumLesbar(s.datum))} · ${escapeHtml(s.anstoss || "")} Uhr</span>
        <span class="pz-zeit">gegen ${escapeHtml(s.gegner || "—")} · ${escapeHtml(wettbewerbInfo(s.wettbewerb).label)}${istVergangen(s) ? " · vergangen" : ""}</span>
        <span class="pz-besetzung">${sollPlaetze(s) - frei} von ${sollPlaetze(s)} Plätzen besetzt · ${(s.jobs || []).length} Posten</span>
      </div>
      <div class="pz-rechts">
        <button type="button" class="btn small secondary" data-spieltag-edit="${escapeHtml(s.id)}">Bearbeiten…</button>
      </div>
    </div>`;
  }).join("");
}

// ---------- Rendering: Auswertung ----------

function renderAuswertung() {
  // Gerechnet, nicht gezählt: ein gespeicherter Zähler wäre nach der ersten
  // Korrektur an einem Spieltag nicht mehr nachrechenbar.
  const stat = {};
  spieltage.forEach((s) => {
    const vergangen = istVergangen(s);
    (s.jobs || []).forEach((j) => besetzungVon(j).forEach((b) => {
      if (!stat[b.username]) stat[b.username] = { gesamt: 0, vergangen: 0, kommend: 0 };
      stat[b.username].gesamt++;
      if (vergangen) stat[b.username].vergangen++; else stat[b.username].kommend++;
    }));
  });
  const namen = Object.keys(stat);
  document.getElementById("auswertung-empty").classList.toggle("hidden", namen.length > 0);
  const tab = document.getElementById("auswertung-tabelle");
  if (!namen.length) { tab.innerHTML = ""; return; }
  namen.sort((a, b) => stat[b].gesamt - stat[a].gesamt || nameVon(a).localeCompare(nameVon(b)));
  tab.innerHTML = `<thead><tr><th>Person</th><th class="num">Einsätze</th><th class="num">davon abgeleistet</th><th class="num">davon kommend</th></tr></thead>
    <tbody>${namen.map((u) => `<tr>
      <td>${escapeHtml(nameVon(u))}</td>
      <td class="num">${stat[u].gesamt}</td>
      <td class="num">${stat[u].vergangen}</td>
      <td class="num">${stat[u].kommend}</td>
    </tr>`).join("")}</tbody>`;
}

// ---------- Rendering: Verwaltung (Erinnerungen) ----------

function renderEinstellungen() {
  document.getElementById("ein-tage").value = Number(einstellungen.erinnerungTage) || DEFAULT_EINSTELLUNGEN.erinnerungTage;
  document.getElementById("ein-termin").checked = einstellungen.terminerinnerung !== false;
  document.getElementById("ein-lage").checked = einstellungen.lagemeldung !== false;

  // Ein nächtlicher Lauf, der still ausfällt, fällt sonst niemandem auf.
  const el = document.getElementById("lauf-status");
  if (!lauf || !lauf.zuletztAm) {
    el.textContent = "Der nächtliche Lauf hat sich hier noch nie gemeldet. Ist der Zeitplan im Cloudflare-Dashboard gesetzt?";
  } else {
    el.textContent = `Nächtlicher Lauf zuletzt am ${zeitLesbar(lauf.zuletztAm)} — ${lauf.ergebnis || "ohne Meldung"}` +
      (lauf.gesendet != null ? ` (${lauf.gesendet} Nachrichten).` : ".");
  }
}

// ---------- Rendering: Info ----------

function renderInfo() {
  const kommend = kommendeSpieltage();
  document.getElementById("meta-view").innerHTML = `
    <div class="form-field"><label>Kommende Heimspiele</label><span>${kommend.length}</span></div>
    <div class="form-field"><label>Offene Posten</label><span>${kommend.reduce((n, s) => n + freiePlaetze(s), 0)}</span></div>
    <div class="form-field"><label>Posten im Katalog</label><span>${jobKatalog.length}</span></div>`;
  document.getElementById("info-user").textContent = currentUser
    ? `Angemeldet als ${nameVon(currentUser.username)} — ${canAdmin() ? "Administrieren" : canEdit() ? "Bearbeiten" : "Sehen"}.`
    : "";
  document.getElementById("changelog-list").innerHTML = APP_CHANGELOG.map((v) => `
    <div class="changelog-version">
      <h3>Version ${escapeHtml(v.version)}</h3>
      ${v.groups.map((g) => `
        <h4>${escapeHtml(g.title)}</h4>
        <ul>${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`).join("")}
    </div>`).join("");
}

// ---------- Alles neu zeichnen ----------

function renderAll() {
  renderSummary();
  renderSpieltage();
  renderVergangene();
  if (canAdmin()) {
    renderSpieltagAdmin();
    renderAuswertung();
    renderEinstellungen();
  }
  renderInfo();
  applyRechteSichtbarkeit();
}

// Sehen ist wirklich read-only: die Bedienelemente verschwinden, nicht nur ihre
// Wirkung. Ein Nur-Seher, der auf einen Knopf drückt und ein stilles 403
// kassiert, hält sich für berechtigt.
function applyRechteSichtbarkeit() {
  document.querySelectorAll(".editor-only").forEach((el) => el.classList.toggle("hidden", !canEdit()));
  document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !canAdmin()));
}

// ---------- Tabs ----------

function switchTab(tab) {
  aktuellerTab = tab;
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
  // Der Katalog-Editor arbeitet auf einer Kopie. Sie wird beim Betreten frisch
  // gezogen, damit ein verworfener Entwurf nicht später doch noch gespeichert wird.
  if (tab === "jobs") {
    katalogEntwurf = jobKatalog.map((j) => Object.assign({}, j));
    renderKatalog();
  }
}

// ---------- Posten-Dialog ----------

function findeSpieltag(id) { return spieltage.find((s) => s.id === id) || null; }
function findeJob(s, jobId) { return s ? (s.jobs || []).find((j) => j.id === jobId) || null : null; }

function oeffnePosten(spieltagId, jobId) {
  const s = findeSpieltag(spieltagId);
  const job = findeJob(s, jobId);
  if (!s || !job) return;
  offenerPosten = { spieltagId, jobId };

  const bes = besetzungVon(job);
  const soll = Number(job.anzahl) || 0;
  const vergangen = istVergangen(s);
  const mein = meinPosten(s);
  const binDrin = bes.some((b) => b.username === (currentUser && currentUser.username));

  document.getElementById("posten-titel").textContent = job.name || "Posten";

  const zeilen = [];
  bes.forEach((b) => {
    const wer = b.von && b.von !== b.username ? ` · eingetragen von ${escapeHtml(nameVon(b.von))}` : "";
    zeilen.push(`<div class="helfer-row">
      <span>${escapeHtml(nameVon(b.username))}<span class="helfer-meta">${wer}${b.am ? " · " + escapeHtml(zeitLesbar(b.am)) : ""}</span></span>
      ${canAdmin() && !vergangen ? `<button type="button" class="btn tiny secondary" data-entfernen="${escapeHtml(b.username)}">Entfernen</button>` : ""}
    </div>`);
  });
  for (let i = bes.length; i < soll; i++) {
    zeilen.push(`<div class="helfer-row frei"><span>Platz ${i + 1} — noch frei</span></div>`);
  }

  let adminBlock = "";
  if (canAdmin() && !vergangen && bes.length < soll) {
    const frei = personen.filter((p) => !(s.jobs || []).some((j) => besetzungVon(j).some((b) => b.username === p.username)));
    adminBlock = `<div class="form-field wide">
      <label>Jemanden eintragen (Zusage per Telefon oder Zuruf)</label>
      <select id="posten-person">
        <option value="">— Person wählen —</option>
        ${frei.map((p) => `<option value="${escapeHtml(p.username)}">${escapeHtml(p.displayName || p.username)}</option>`).join("")}
      </select>
      ${frei.length === 0 ? `<p class="muted" style="margin-top:6px;">Alle möglichen Helfer stehen an diesem Spieltag bereits auf einem Posten.</p>` : ""}
    </div>`;
  }

  document.getElementById("posten-body").innerHTML = `
    <div class="posten-kopf">
      <div class="pk-zeile"><label>Spieltag</label>${escapeHtml(wochentagVon(s.datum))} ${escapeHtml(datumLesbar(s.datum))}, ${escapeHtml(s.anstoss || "")} Uhr gegen ${escapeHtml(s.gegner || "—")}</div>
      <div class="pk-zeile"><label>Zeitfenster</label>${escapeHtml(zeitfensterText(s, job)) || "—"}</div>
      <div class="pk-zeile"><label>Besetzung</label>${bes.length} von ${soll}</div>
      ${job.beschreibung ? `<div class="pk-zeile"><label>Aufgabe</label>${escapeHtml(job.beschreibung)}</div>` : ""}
    </div>
    <div class="helfer-liste">${zeilen.join("")}</div>
    ${adminBlock}
    ${vergangen ? `<p class="muted">Dieser Spieltag liegt zurück — die Besetzung lässt sich nicht mehr ändern.</p>` : ""}`;

  const aktionen = [];
  if (canEdit() && !vergangen) {
    if (binDrin) {
      aktionen.push(`<button type="button" class="btn secondary" id="btn-mich-austragen">Mich austragen</button>`);
    } else if (mein) {
      aktionen.push(`<span class="helfer-meta">Du hilfst an diesem Spieltag schon bei „${escapeHtml(mein.name)}“.</span>`);
    } else if (bes.length >= soll) {
      aktionen.push(`<span class="helfer-meta">Dieser Posten ist vollständig besetzt.</span>`);
    } else {
      aktionen.push(`<button type="button" class="btn success" id="btn-mich-eintragen">Mich eintragen</button>`);
    }
    if (canAdmin() && bes.length < soll) {
      aktionen.push(`<button type="button" class="btn" id="btn-person-eintragen">Gewählte Person eintragen</button>`);
    }
  } else if (!canEdit()) {
    aktionen.push(`<span class="helfer-meta">Zum Eintragen fehlt dir das Bearbeiten-Recht.</span>`);
  }
  document.getElementById("posten-aktionen").innerHTML = aktionen.join("");
  document.getElementById("posten-modal").classList.remove("hidden");
}

function schliessePosten() {
  offenerPosten = null;
  document.getElementById("posten-modal").classList.add("hidden");
}

async function handleEintragen(spieltagId, jobId, username) {
  try {
    setStatusText("Wird eingetragen…");
    await trageEin(spieltagId, jobId, username);
    await ladeDaten();
    renderAll();
    setStatusText("Eingetragen");
    if (offenerPosten) oeffnePosten(offenerPosten.spieltagId, offenerPosten.jobId);
  } catch (e) { zeigeFehler(e); }
}

async function handleAustragen(spieltagId, jobId, username) {
  try {
    setStatusText("Wird ausgetragen…");
    await trageAus(spieltagId, jobId, username);
    await ladeDaten();
    renderAll();
    setStatusText("Ausgetragen");
    if (offenerPosten) oeffnePosten(offenerPosten.spieltagId, offenerPosten.jobId);
  } catch (e) { zeigeFehler(e); }
}

// ---------- Spieltag-Dialog (Administrieren) ----------

function renderSfJobs() {
  const el = document.getElementById("sf-jobs");
  el.innerHTML = sfJobsEntwurf.map((j, i) => jobZeileHtml(j, i, "sf")).join("")
    || `<p class="muted">Für diesen Spieltag ist kein Posten hinterlegt.</p>`;
}

function oeffneSpieltag(id) {
  sfSpieltagId = id || null;
  const s = id ? findeSpieltag(id) : null;

  document.getElementById("spieltag-modal-titel").textContent = s ? "Spieltag bearbeiten" : "Neuer Spieltag";
  document.getElementById("sf-datum").value = s ? (s.datum || "") : "";
  document.getElementById("sf-anstoss").value = s ? (s.anstoss || "") : "15:00";
  document.getElementById("sf-gegner").value = s ? (s.gegner || "") : "";
  document.getElementById("sf-notiz").value = s ? (s.notiz || "") : "";

  const wb = document.getElementById("sf-wettbewerb");
  wb.innerHTML = WETTBEWERBE.map((w) => `<option value="${w.id}">${escapeHtml(w.label)}</option>`).join("");
  wb.value = s ? (s.wettbewerb || "punktspiel") : "punktspiel";

  const ms = document.getElementById("sf-mannschaft");
  ms.innerHTML = MANNSCHAFTEN.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
  ms.value = s ? (s.mannschaft || "erste") : "erste";

  const block = document.getElementById("sf-jobs-block");
  if (s) {
    block.classList.remove("hidden");
    sfJobsEntwurf = (s.jobs || []).map((j) => Object.assign({}, j));
    document.getElementById("sf-jobs-hinweis").textContent =
      "Gilt nur für diesen Spieltag — der Katalog bleibt unverändert. Ein Posten, auf dem schon jemand steht, lässt sich nicht entfernen.";
    renderSfJobs();
  } else {
    // Beim Anlegen gibt es noch keine Posten: sie entstehen serverseitig aus dem
    // Katalog. Ein leerer Editor an dieser Stelle würde suggerieren, man müsse
    // sie hier eintippen.
    block.classList.add("hidden");
    sfJobsEntwurf = [];
  }

  document.getElementById("sf-loeschen").classList.toggle("hidden", !s);
  document.getElementById("spieltag-modal").classList.remove("hidden");
}

function schliesseSpieltag() {
  sfSpieltagId = null;
  sfJobsEntwurf = [];
  document.getElementById("spieltag-modal").classList.add("hidden");
}

async function speichereSpieltagForm() {
  const datum = document.getElementById("sf-datum").value;
  const anstoss = document.getElementById("sf-anstoss").value;
  const gegner = document.getElementById("sf-gegner").value.trim();
  if (!datum || !anstoss || !gegner) { alert("Datum, Anstoß und Gegner sind Pflichtfelder."); return; }

  const spieltag = {
    id: sfSpieltagId || undefined,
    datum, anstoss, gegner,
    wettbewerb: document.getElementById("sf-wettbewerb").value,
    mannschaft: document.getElementById("sf-mannschaft").value,
    notiz: document.getElementById("sf-notiz").value.trim()
  };

  // Posten nur mitschicken, wenn der Editor sichtbar war. Ein leeres Array wäre
  // sonst die Aufforderung, alle Posten zu löschen.
  if (sfSpieltagId) {
    const ausDom = liesJobsAusDom("sf-jobs");
    spieltag.jobs = ausDom.map((j, i) => Object.assign({}, sfJobsEntwurf[i] || {}, j));
    if (spieltag.jobs.some((j) => !j.name)) { alert("Jeder Posten braucht einen Namen."); return; }
  }

  try {
    setStatusText("Wird gespeichert…");
    await speichereSpieltag(spieltag);
    await ladeDaten();
    renderAll();
    schliesseSpieltag();
    setStatusText("Gespeichert");
  } catch (e) { zeigeFehler(e); }
}

async function loescheSpieltagForm() {
  if (!sfSpieltagId) return;
  const s = findeSpieltag(sfSpieltagId);
  const besetzt = s ? sollPlaetze(s) - freiePlaetze(s) : 0;
  const frage = besetzt > 0
    ? `Diesen Spieltag wirklich löschen? ${besetzt} Zusage(n) gehen damit verloren.`
    : "Diesen Spieltag wirklich löschen?";
  if (!confirm(frage)) return;
  try {
    setStatusText("Wird gelöscht…");
    await loescheSpieltag(sfSpieltagId);
    await ladeDaten();
    renderAll();
    schliesseSpieltag();
    setStatusText("Gelöscht");
  } catch (e) { zeigeFehler(e); }
}

// ---------- Katalog speichern ----------

async function speichereKatalogForm() {
  katalogEntwurf = liesJobsAusDom("katalog-liste").map((j, i) =>
    Object.assign({}, katalogEntwurf[i] || {}, j));
  if (katalogEntwurf.some((j) => !j.name)) { alert("Jeder Posten braucht einen Namen."); return; }
  try {
    setStatusText("Wird gespeichert…");
    await speichereKatalog(katalogEntwurf);
    await ladeDaten();
    katalogEntwurf = jobKatalog.map((j) => Object.assign({}, j));
    renderKatalog();
    renderAll();
    setStatusText("Katalog gespeichert");
  } catch (e) { zeigeFehler(e); }
}

// ---------- Einstellungen und Erinnerung ----------

async function speichereEinstellungenForm() {
  const tage = Number(document.getElementById("ein-tage").value);
  if (!(tage >= 1 && tage <= 60)) { alert("Die Frist muss zwischen 1 und 60 Tagen liegen."); return; }
  try {
    setStatusText("Wird gespeichert…");
    await speichereEinstellungen({
      erinnerungTage: tage,
      terminerinnerung: document.getElementById("ein-termin").checked,
      lagemeldung: document.getElementById("ein-lage").checked
    });
    await ladeDaten();
    renderEinstellungen();
    setStatusText("Gespeichert");
  } catch (e) { zeigeFehler(e); }
}

async function handleErinnern() {
  if (!confirm("Jetzt an alle offenen Posten erinnern? Es bekommt nur Nachricht, wer an einem Spieltag mit freien Posten noch nicht eingetragen ist.")) return;
  try {
    setStatusText("Wird verschickt…");
    const body = await erinnereJetzt("");
    await ladeDaten();
    renderEinstellungen();
    // Ausdrücklich benennen, was passiert ist: eine stille Erfolgsmeldung würde
    // auch dann gut aussehen, wenn niemand erreichbar war.
    const teile = [];
    if (typeof body.spieltage === "number") teile.push(`${body.spieltage} Spieltag(e) mit freien Posten`);
    if (typeof body.gesendet === "number") teile.push(`${body.gesendet} Nachricht(en) verschickt`);
    if (typeof body.ohneAbo === "number" && body.ohneAbo > 0) teile.push(`${body.ohneAbo} ohne eingeschaltete Benachrichtigung`);
    alert(teile.length ? teile.join(" · ") : "Es gab gerade nichts zu melden.");
    setStatusText("Erledigt");
  } catch (e) { zeigeFehler(e); }
}

// ---------- Aushang ----------

function druckeAushang(spieltagId) {
  const s = findeSpieltag(spieltagId);
  if (!s) return;
  const zeilen = (s.jobs || []).map((job) => {
    const bes = besetzungVon(job);
    const soll = Number(job.anzahl) || 0;
    const namen = [];
    bes.forEach((b) => namen.push(escapeHtml(nameVon(b.username))));
    for (let i = bes.length; i < soll; i++) namen.push(`<span class="print-frei">— frei —</span>`);
    return `<tr>
      <td><strong>${escapeHtml(job.name)}</strong>${job.beschreibung ? `<br /><small>${escapeHtml(job.beschreibung)}</small>` : ""}</td>
      <td>${escapeHtml(zeitfensterText(s, job)) || "—"}</td>
      <td>${namen.join("<br />")}</td>
    </tr>`;
  }).join("");

  document.getElementById("print-content").innerHTML = `
    <h1>Spieltagscrew — ${escapeHtml(wochentagVon(s.datum))} ${escapeHtml(datumLesbar(s.datum))}</h1>
    <div class="print-meta">
      Anstoß ${escapeHtml(s.anstoss || "")} Uhr gegen ${escapeHtml(s.gegner || "—")} ·
      ${escapeHtml(wettbewerbInfo(s.wettbewerb).label)}${s.notiz ? " · " + escapeHtml(s.notiz) : ""}
    </div>
    <table class="print-table">
      <thead><tr><th style="width:34%">Posten</th><th style="width:22%">Zeit</th><th>Wer</th></tr></thead>
      <tbody>${zeilen || `<tr><td colspan="3">Kein Posten hinterlegt.</td></tr>`}</tbody>
    </table>
    <p style="margin-top:14px;font-size:0.8rem;color:#555;">Stand: ${escapeHtml(zeitLesbar(new Date().toISOString()))}</p>`;

  document.body.classList.add("printing-report");
  window.print();
  document.body.classList.remove("printing-report");
}

// ---------- Ereignisse ----------

// Durchgehend Event-Delegation: Gitter, Karten und beide Editoren werden nach
// jeder Änderung neu gezeichnet, direkt gebundene Handler wären danach weg.
function setupListeners() {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });

  document.getElementById("btn-spieltag-neu").addEventListener("click", () => oeffneSpieltag(null));

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-posten],[data-eintragen],[data-austragen],[data-aushang],[data-spieltag-edit]");
    if (!el) return;
    if (el.dataset.posten) {
      const [sid, jid] = el.dataset.posten.split("|");
      oeffnePosten(sid, jid);
    } else if (el.dataset.eintragen) {
      const [sid, jid] = el.dataset.eintragen.split("|");
      handleEintragen(sid, jid, "");
    } else if (el.dataset.austragen) {
      const [sid, jid] = el.dataset.austragen.split("|");
      handleAustragen(sid, jid, "");
    } else if (el.dataset.aushang) {
      druckeAushang(el.dataset.aushang);
    } else if (el.dataset.spieltagEdit) {
      oeffneSpieltag(el.dataset.spieltagEdit);
    }
  });

  // ----- Posten-Dialog -----
  document.getElementById("posten-close").addEventListener("click", schliessePosten);
  document.getElementById("posten-schliessen").addEventListener("click", schliessePosten);
  document.getElementById("posten-modal").addEventListener("click", (ev) => {
    if (ev.target.id === "posten-modal") schliessePosten();
    const entf = ev.target.closest("[data-entfernen]");
    if (entf && offenerPosten) {
      handleAustragen(offenerPosten.spieltagId, offenerPosten.jobId, entf.dataset.entfernen);
    }
  });
  document.getElementById("posten-aktionen").addEventListener("click", (ev) => {
    if (!offenerPosten) return;
    const { spieltagId, jobId } = offenerPosten;
    if (ev.target.id === "btn-mich-eintragen") handleEintragen(spieltagId, jobId, "");
    if (ev.target.id === "btn-mich-austragen") handleAustragen(spieltagId, jobId, "");
    if (ev.target.id === "btn-person-eintragen") {
      const sel = document.getElementById("posten-person");
      if (!sel || !sel.value) { alert("Bitte zuerst eine Person auswählen."); return; }
      handleEintragen(spieltagId, jobId, sel.value);
    }
  });

  // ----- Spieltag-Dialog -----
  document.getElementById("spieltag-close").addEventListener("click", schliesseSpieltag);
  document.getElementById("sf-abbrechen").addEventListener("click", schliesseSpieltag);
  document.getElementById("sf-speichern").addEventListener("click", speichereSpieltagForm);
  document.getElementById("sf-loeschen").addEventListener("click", loescheSpieltagForm);
  document.getElementById("spieltag-modal").addEventListener("click", (ev) => {
    if (ev.target.id === "spieltag-modal") schliesseSpieltag();
  });
  document.getElementById("btn-sf-job-neu").addEventListener("click", () => {
    sfJobsEntwurf = liesJobsAusDom("sf-jobs").map((j, i) => Object.assign({}, sfJobsEntwurf[i] || {}, j));
    sfJobsEntwurf.push({ name: "", beschreibung: "", anzahl: 1, vonMin: -90, bisMin: 0 });
    renderSfJobs();
  });
  document.getElementById("btn-sf-katalog-nachziehen").addEventListener("click", () => {
    if (!confirm("Die Posten aus dem Katalog ergänzen? Vorhandene Posten und ihre Besetzung bleiben unverändert.")) return;
    sfJobsEntwurf = liesJobsAusDom("sf-jobs").map((j, i) => Object.assign({}, sfJobsEntwurf[i] || {}, j));
    jobKatalog.forEach((k) => {
      if (!sfJobsEntwurf.some((j) => (j.katalogId && j.katalogId === k.id) ||
          String(j.name || "").trim().toLowerCase() === String(k.name || "").trim().toLowerCase())) {
        sfJobsEntwurf.push({ katalogId: k.id, name: k.name, beschreibung: k.beschreibung, anzahl: k.anzahl, vonMin: k.vonMin, bisMin: k.bisMin });
      }
    });
    renderSfJobs();
  });
  document.getElementById("sf-jobs").addEventListener("click", (ev) => {
    const weg = ev.target.closest("[data-sf-weg]");
    if (!weg) return;
    const idx = Number(weg.dataset.sfWeg);
    const bestand = sfJobsEntwurf[idx];
    if (bestand && besetzungVon(bestand).length) {
      alert(`Auf diesem Posten stehen bereits ${besetzungVon(bestand).length} Person(en). Trage sie zuerst aus.`);
      return;
    }
    sfJobsEntwurf = liesJobsAusDom("sf-jobs").map((j, i) => Object.assign({}, sfJobsEntwurf[i] || {}, j));
    sfJobsEntwurf.splice(idx, 1);
    renderSfJobs();
  });

  // ----- Job-Katalog -----
  document.getElementById("btn-katalog-neu").addEventListener("click", () => {
    katalogEntwurf = liesJobsAusDom("katalog-liste").map((j, i) => Object.assign({}, katalogEntwurf[i] || {}, j));
    katalogEntwurf.push({ name: "", beschreibung: "", anzahl: 1, vonMin: -90, bisMin: 0 });
    renderKatalog();
  });
  document.getElementById("btn-katalog-vorschlag").addEventListener("click", () => {
    katalogEntwurf = DEFAULT_JOBS.map((j) => Object.assign({}, j));
    renderKatalog();
  });
  document.getElementById("btn-katalog-speichern").addEventListener("click", speichereKatalogForm);
  document.getElementById("katalog-liste").addEventListener("click", (ev) => {
    const weg = ev.target.closest("[data-kat-weg]");
    if (!weg) return;
    katalogEntwurf = liesJobsAusDom("katalog-liste").map((j, i) => Object.assign({}, katalogEntwurf[i] || {}, j));
    katalogEntwurf.splice(Number(weg.dataset.katWeg), 1);
    renderKatalog();
  });

  // ----- Verwaltung -----
  document.getElementById("btn-einstellungen-speichern").addEventListener("click", speichereEinstellungenForm);
  document.getElementById("btn-erinnern").addEventListener("click", handleErinnern);

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!document.getElementById("posten-modal").classList.contains("hidden")) schliessePosten();
    else if (!document.getElementById("spieltag-modal").classList.contains("hidden")) schliesseSpieltag();
  });
}

// ---------- Start ----------

async function init() {
  document.getElementById("version-badge").textContent = "v" + APP_VERSION;

  // Ein einziger Aufruf für Rechte UND Daten: `spieltagscrew-load` liefert `me`
  // mit. Deshalb ist der Login-Gate hier an denselben Aufruf gehängt, statt
  // vorher noch einmal separat zu fragen.
  try {
    await ladeDaten();
  } catch (e) {
    if (e instanceof NotLoggedInError) { zeigeLoginGate(e.message); return; }
    zeigeLoginGate(e.message || "");
    return;
  }

  document.getElementById("connect-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  document.getElementById("header-user").textContent = nameVon(currentUser.username);

  setupListeners();

  // Die Personenliste braucht nur der Fremdeintrag der Verwaltung.
  if (canAdmin()) await ladePersonen();

  renderAll();
  switchTab("spieltage");
}

document.addEventListener("DOMContentLoaded", init);
