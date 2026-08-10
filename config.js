// Die Version bleibt auf 1.0 stehen. Was sich ändert, kommt als eigener Block in
// APP_CHANGELOG dazu — die Nummer selbst wird nicht hochgezählt.
const APP_VERSION = "1.0";

// Wettbewerbe eines Heimspiels. Rein zur Einordnung in der Übersicht; auf die
// Besetzung wirkt sich das nicht aus.
const WETTBEWERBE = [
  { id: "punktspiel", label: "Punktspiel", farbe: "#1a56a0" },
  { id: "pokal",      label: "Pokal",      farbe: "#c9941f" },
  { id: "testspiel",  label: "Testspiel",  farbe: "#6b7280" }
];

// Mannschaften. In 1.0 gibt es nur die Erste — das Feld steht trotzdem schon im
// Datensatz, damit eine zweite Mannschaft später keine Datenwanderung braucht.
const MANNSCHAFTEN = [
  { id: "erste", label: "1. Mannschaft" }
];

// Vorschlag für den ersten Job-Katalog. Wird nur angeboten, solange gar kein
// Katalog existiert — danach ist der gepflegte Katalog die Wahrheit.
// vonMin/bisMin sind Minuten RELATIV ZUM ANSTOSS (negativ = davor). Dadurch
// stimmen die Uhrzeiten auch, wenn ein Spiel um 13:00 statt um 15:00 beginnt.
const DEFAULT_JOBS = [
  { name: "Kassenhäuschen",   beschreibung: "Eintritt kassieren, Wechselgeld, Abrechnung", anzahl: 2, vonMin: -90,  bisMin: 15 },
  { name: "Ordnungsdienst",   beschreibung: "Einlass, Zaun, Ordnung im Stadion",           anzahl: 4, vonMin: -60,  bisMin: 30 },
  { name: "Grill und Imbiss", beschreibung: "Grill anheizen, Verkauf, Aufräumen",          anzahl: 3, vonMin: -120, bisMin: 90 },
  { name: "Getränkeausschank", beschreibung: "Ausschank im Vereinsheim und am Stand",      anzahl: 2, vonMin: -90,  bisMin: 90 },
  { name: "Stadionsprecher",  beschreibung: "Aufstellungen, Ansagen, Musik",               anzahl: 1, vonMin: -45,  bisMin: 30 },
  { name: "Aufbau",           beschreibung: "Tore, Netze, Eckfahnen, Absperrung",          anzahl: 3, vonMin: -150, bisMin: -60 },
  { name: "Abbau",            beschreibung: "Abbauen, zusammenräumen, abschließen",        anzahl: 3, vonMin: 30,   bisMin: 120 }
];

// Vorgaben für die Erinnerungen. Änderbar im Verwaltungs-Tab; hier steht nur der
// Startwert für eine noch leere Datei.
const DEFAULT_EINSTELLUNGEN = { erinnerungTage: 7, terminerinnerung: true, lagemeldung: true };

// Ab dieser Fensterbreite zeigt die Übersicht das Gitter, darunter die
// Kartenliste. Der Wert steht doppelt — hier für die Logik, in style.css für
// die Darstellung; beide müssen zusammenpassen.
const GITTER_AB_PX = 768;

const APP_CHANGELOG = [
  {
    version: "1.0",
    groups: [
      {
        title: "Heimspieltage pflegen",
        items: [
          "Jeder Heimspieltag wird mit Datum, Anstoßzeit, Gegner und Wettbewerb angelegt. Eine Notiz nimmt auf, was sonst per Zuruf untergeht — etwa dass an diesem Tag zwei Mannschaften nacheinander spielen.",
          "Vergangene Spieltage bleiben dauerhaft stehen. Sie sind die Grundlage der Auswertung und werden nie automatisch gelöscht.",
          "Angelegte Spieltage sind sofort offen: wer weit vorausplant, kann sich im Juli für den Oktober eintragen."
        ]
      },
      {
        title: "Posten und Personenzahl",
        items: [
          "Der Job-Katalog wird einmal gepflegt: Name, kurze Beschreibung, benötigte Personenzahl und das Zeitfenster.",
          "Beim Anlegen eines Spieltags werden die Posten als eigene Kopie hineingeschrieben. Beim Derby lassen sich dort vier Ordner statt zwei eintragen, beim Nachholspiel der Grill streichen — ohne den Katalog zu verändern.",
          "Umgekehrt gilt: eine spätere Änderung am Katalog fasst bestehende Spieltage nicht an. Was einmal besetzt wurde, bleibt so stehen, wie es vereinbart war.",
          "Das Zeitfenster wird relativ zum Anstoß gepflegt — etwa 90 Minuten vor bis 15 Minuten nach dem Anpfiff. Die App rechnet daraus die echte Uhrzeit; bei einem Spiel um 13:00 Uhr steht dort automatisch eine andere als bei einem um 15:00 Uhr."
        ]
      },
      {
        title: "Sich eintragen",
        items: [
          "Ein Klick auf einen freien Platz trägt dich ein, ein zweiter wieder aus. Wer sich austrägt, muss niemanden fragen — aber die Verantwortlichen bekommen eine Nachricht, damit der leere Posten nicht unbemerkt bleibt.",
          "Ein voller Posten nimmt niemanden mehr an, und je Spieltag steht jede Person auf höchstens einem Posten. Beides prüft der Server, nicht nur die Oberfläche.",
          "Zusagen, die per Telefon oder Zuruf kommen, kann die Verwaltung selbst eintragen. Am Posten steht dann, wer den Eintrag vorgenommen hat.",
          "Auf einen bereits gespielten Spieltag lässt sich niemand mehr eintragen."
        ]
      },
      {
        title: "Nachricht aufs Handy",
        items: [
          "Sieben Tage vor dem Spieltag meldet sich die App bei allen, die helfen dürfen und an diesem Tag noch keinen Posten haben — aber nur, wenn tatsächlich noch etwas frei ist. Wer schon eingetragen ist, bekommt diese Nachricht nicht.",
          "Am Vortag bekommt jeder Eingetragene seine eigene Erinnerung, mit Posten und Uhrzeit.",
          "Die Verwaltung bekommt zur selben Frist eine Lagemeldung: was ist noch frei — und wenn alles besetzt ist, ausdrücklich auch das.",
          "Die Frist ist einstellbar, und jede Erinnerung lässt sich zusätzlich von Hand auslösen.",
          "Eingeschaltet wird das in der Tools-Übersicht unter „Mein Konto“. Wer den Schalter ausschaltet, bekommt keine dieser Nachrichten."
        ]
      },
      {
        title: "Übersicht und Aushang",
        items: [
          "Am Rechner zeigt ein Gitter alle kommenden Spieltage nebeneinander — dort ist auf einen Blick zu sehen, welcher Posten über mehrere Spieltage hinweg leer bleibt.",
          "Am Handy wird daraus eine Liste aus Spieltags-Karten mit Posten untereinander, damit sich niemand quer über eine Tabelle schieben muss.",
          "Zu jedem Spieltag lässt sich ein Aushang drucken: alle Posten mit Namen und ausgerechneter Uhrzeit, für das Kassenhäuschen oder das Schwarze Brett."
        ]
      },
      {
        title: "Wer darf was",
        items: [
          "Sehen: alle Spieltage, alle Posten und wer eingetragen ist.",
          "Bearbeiten: sich selbst ein- und austragen.",
          "Administrieren: Spieltage und Job-Katalog pflegen, andere eintragen, Erinnerungen auslösen und die Auswertung einsehen.",
          "Wie oft jemand geholfen hat, sieht ausschließlich die Verwaltung. Eine offene Rangliste würde aus Freiwilligkeit einen Wettbewerb machen.",
          "Der Reiter „Info“ ist für alle sichtbar."
        ]
      }
    ]
  }
];
