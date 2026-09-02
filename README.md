# 🦺 Spieltagscrew

Wer übernimmt bei den Heimspielen der 1. Mannschaft welchen Posten: Kassenhäuschen, Ordnungsdienst, Grill, Sprecher, Auf- und Abbau. Die Posten werden einmal als Katalog gepflegt und jedem Heimspieltag als eigene Kopie mitgegeben, dort mit benötigter Personenzahl und einem Zeitfenster relativ zum Anstoß. Wer helfen kann, trägt sich selbst ein; frei gebliebene Posten melden sich rechtzeitig von selbst aufs Handy, und zu jedem Spieltag lässt sich ein Aushang mit Namen und Uhrzeiten drucken.

**➡️ [Spieltagscrew öffnen](https://sc1911heiligenstadt.github.io/spieltagscrew/)**

## Was drin ist

| Reiter | Wofür |
|---|---|
| **Spieltage** | Die kommenden Heimspiele mit allen Posten — hier trägt man sich ein und aus, und hier wird der Aushang gedruckt |
| **Vergangene** | Die gespielten Heimspieltage; sie bleiben dauerhaft stehen und lassen sich nicht mehr besetzen |
| **Jobs** | Der Job-Katalog: Name, Beschreibung, Personenzahl und Zeitfenster je Posten |
| **Verwaltung** | Erinnerungen einstellen und auslösen, Spieltage anlegen und ändern, Einsätze je Person |
| **Info** | Was die App tut, die Änderungen und der Datenschutz-Hinweis |

## Wie es gedacht ist

1. Die Verwaltung pflegt einmal den **Job-Katalog** — Name, Personenzahl und Zeitfenster je Posten.
2. Für jedes Heimspiel wird ein **Spieltag** angelegt. Die Posten aus dem Katalog kommen als eigene Kopie mit und lassen sich dort anpassen: beim Derby vier Ordner statt zwei, beim Nachholspiel ohne Grill.
3. Wer helfen kann, **trägt sich selbst ein** — ein Klick auf einen freien Platz, ein zweiter trägt wieder aus.
4. Sieben Tage vor dem Spieltag meldet sich die App bei allen, die noch keinen Posten haben und an diesem Tag noch etwas frei ist. Am Vortag bekommt jeder Eingetragene seine eigene Erinnerung mit Posten und Uhrzeit.

## Das Zeitfenster

Die Zeiten stehen **relativ zum Anstoß**: `−90` heißt 90 Minuten vor dem Anpfiff, `15` heißt 15 Minuten danach. Die App rechnet daraus die echte Uhrzeit — beim Spiel um 15:00 Uhr steht am Kassenhäuschen „13:30–15:15 Uhr“, beim Spiel um 13:00 Uhr automatisch „11:30–13:15 Uhr“. Einmal gepflegt, nie wieder anfassen.

## Zugang

Die Anmeldung läuft über die [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) — dort einmal anmelden, danach ist dieses Werkzeug offen.

Die Rechte gelten in drei Stufen: **Sehen** (alle Spieltage, Posten und Namen ansehen), **Bearbeiten** (sich selbst ein- und austragen) und **Administrieren** (Spieltage und Katalog pflegen, andere eintragen, Erinnerungen einstellen und auslösen, Auswertung). Wer welche Stufe hat, legt die Tools-Übersicht fest. Der Reiter *Info* ist für alle sichtbar.

Wie oft jemand geholfen hat, sieht ausschließlich die Verwaltung — eine offene Rangliste würde aus Freiwilligkeit einen Wettbewerb machen.

## Lokal starten

Über den Eintrag `spieltagscrew` in `E:\.claude\launch.json` — der Server läuft dann auf `http://localhost:8813/`.

## Technik

Vanilla JavaScript ohne Build-Schritt — die Dateien werden so ausgeliefert, wie sie im Repo liegen. Veröffentlicht über GitHub Pages. Die Daten liegen in der Vereins-Nextcloud; der Zugriff läuft ausschließlich über den Login-Worker der Tools-Übersicht, nie mit Zugangsdaten im Browser.

Anders als die meisten Werkzeuge der Familie schreibt diese App **nicht** über den allgemeinen Speicherweg, sondern über eigene, eng zugeschnittene Aktionen im Login-Worker. Nur so lassen sich die Zusagen wirklich halten: ein voller Posten nimmt niemanden mehr an, je Spieltag steht jede Person auf höchstens einem Posten, und wer sich einträgt, trägt sich selbst ein.

---

Ein Werkzeug des 1. SC 1911 Heiligenstadt. Alle Werkzeuge auf einen Blick: [Tools-Übersicht](https://sc1911heiligenstadt.github.io/ToolsUebersicht/) · Erklärungen im [Toolbox Wiki](https://sc1911heiligenstadt.github.io/Vereinswiki/).
