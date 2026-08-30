// Persistenz über das zentrale ToolsUebersicht-Login-Gateway.
//
// ABWEICHUNG vom üblichen Gateway-Muster: diese App nutzt NICHT dav-load/dav-save.
// "spieltagscrew" steht bewusst nicht in DAV_APPS des Workers — es gibt also gar
// keinen generischen Schreibweg auf die Datendatei. Grund: die vier Zusagen dieser
// App lassen sich clientseitig nicht halten, und ein dav-save, das die ganze Datei
// entgegennimmt, wäre die offene Hintertür an allen vieren vorbei:
//
//   1. Ein voller Posten nimmt niemanden mehr an.
//   2. Eine Person steht je Spieltag auf höchstens einem Posten.
//   3. Wer sich einträgt, trägt sich selbst ein — fremde Namen darf nur setzen,
//      wer administriert.
//   4. Der Verlauf hält fest, wer wen ein- und ausgetragen hat, und ist nicht
//      fälschbar.
//
// Jede Aktion hier hat deshalb ein Gegenstück in admin-worker.js, das Rechte,
// Belegung und Zeitpunkt selbst prüft. Der Client hält keinen eigenen Bestand,
// den er zurückschreibt — nach jeder Änderung wird neu geladen.
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const GATEWAY_APP_ID = "spieltagscrew";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message || "Daten wurden zwischenzeitlich von einem anderen Gerät geändert");
    this.name = "ConflictError";
  }
}

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) { if (typeof raeumeBeiSitzungsverlust === "function") raeumeBeiSitzungsverlust(); throw new NotLoggedInError(); }
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) { if (typeof raeumeBeiSitzungsverlust === "function") raeumeBeiSitzungsverlust(); throw new NotLoggedInError("Sitzung abgelaufen"); }
  // 409 trägt hier eine echte Begründung ("Der Posten ist bereits voll besetzt",
  // "Du stehst an diesem Spieltag schon beim Grill") und ist NICHT der
  // Schreibkonflikt anderer Apps — deshalb wird die Nachricht durchgereicht
  // statt durch den generischen ConflictError-Text ersetzt. Das gilt genauso
  // für 400/403 aus dem Worker.
  if (!resp.ok) {
    let msg = `Gateway-Fehler (HTTP ${resp.status})`;
    try {
      const body = await resp.json();
      if (body && body.error) msg = body.error;
    } catch (_) { /* Antwort ohne JSON-Körper — Standardtext bleibt */ }
    if (resp.status === 409) throw new ConflictError(msg);
    throw new Error(msg);
  }
  return resp.json();
}

// ---------- Laden ----------

// Liefert { jobKatalog, spieltage, einstellungen, lauf, me, personen, namen }.
// `lauf` und die Auswertungsgrundlage kommen nur mit Administrieren-Recht mit.
async function ladeAlles() {
  return gatewayRequest({ action: "spieltagscrew-load", app: GATEWAY_APP_ID });
}

// ---------- Ein- und Austragen (Bearbeiten) ----------

// `username` weglassen heißt "ich selbst". Ein fremder Name wird vom Worker nur
// akzeptiert, wenn der Aufrufer administriert — sonst 403. Der eigene Name kommt
// dort ohnehin aus dem Token und nie aus diesem Aufruf.
async function trageEin(spieltagId, jobId, username) {
  return gatewayRequest({
    action: "spieltagscrew-eintragen", app: GATEWAY_APP_ID,
    spieltagId, jobId, username: username || ""
  });
}

async function trageAus(spieltagId, jobId, username) {
  return gatewayRequest({
    action: "spieltagscrew-austragen", app: GATEWAY_APP_ID,
    spieltagId, jobId, username: username || ""
  });
}

// ---------- Spieltage (Administrieren) ----------

// Ohne `spieltag.id` wird angelegt; dabei kopiert der Worker den aktiven
// Job-Katalog in den Spieltag hinein.
//
// `spieltag.jobs` ist OPTIONAL und deckt den Fall "Posten dieses einen Spieltags
// anpassen" mit ab — ein Dialog, ein Knopf, ein Aufruf. Fehlt das Feld, bleibt
// die Postenliste unangetastet; ist es da, führt der Worker sie über die Job-Id
// zusammen und behält die Besetzung bestehender Posten. Ein Posten, auf dem noch
// jemand steht, lässt sich so nicht versehentlich mitsamt Besetzung entfernen —
// der Worker lehnt das mit Begründung ab.
async function speichereSpieltag(spieltag) {
  return gatewayRequest({ action: "spieltagscrew-spieltag-speichern", app: GATEWAY_APP_ID, spieltag });
}

async function loescheSpieltag(id) {
  return gatewayRequest({ action: "spieltagscrew-spieltag-loeschen", app: GATEWAY_APP_ID, id });
}

// ---------- Job-Katalog (Administrieren) ----------

// Der Katalog ist eine VORLAGE. Eine Änderung hier fasst bestehende Spieltage
// nicht an — die tragen ihre eigene Kopie.
async function speichereKatalog(jobKatalog) {
  return gatewayRequest({ action: "spieltagscrew-katalog-speichern", app: GATEWAY_APP_ID, jobKatalog });
}

// ---------- Einstellungen und Erinnerung (Administrieren) ----------

async function speichereEinstellungen(einstellungen) {
  return gatewayRequest({ action: "spieltagscrew-einstellungen-speichern", app: GATEWAY_APP_ID, einstellungen });
}

// Erinnerung von Hand. Dieselbe Auswahl-Logik wie der nächtliche Lauf, nur sofort
// und mit sichtbarem Ergebnis — damit sich der Automatiklauf gegenprüfen lässt,
// ohne bis zum nächsten Morgen zu warten.
async function erinnereJetzt(spieltagId) {
  return gatewayRequest({ action: "spieltagscrew-erinnern", app: GATEWAY_APP_ID, spieltagId: spieltagId || "" });
}

// ---------- Personen ----------

// Personenauswahl für den Fremdeintrag: nur wer diese App bearbeiten darf, kann
// überhaupt einen Posten übernehmen. Bestehende Worker-Aktion, kein neuer
// Endpunkt — sie antwortet mit `{ users: [{username, displayName}] }`.
async function ladeMoeglicheHelfer() {
  return gatewayRequest({ action: "list-tool-editors", app: GATEWAY_APP_ID });
}

// Kein eigenes fetchMe(): `spieltagscrew-load` liefert `me` (inklusive canEdit
// und canAdmin) bereits mit, ohne dafür einen weiteren Nextcloud-Read zu
// brauchen. Ein zweiter Aufruf wäre ein Roundtrip für nichts — dieselbe
// Überlegung, aus der dav-load seit 2026-07-22 sein `me` mitschickt.
