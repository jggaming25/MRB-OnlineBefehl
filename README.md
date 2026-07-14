# Online Befehl – Setup

Reine Frontend-App (HTML/CSS/JS) für GitHub Pages, Backend über Firebase (Auth + Firestore, kostenloser Spark-Plan reicht). Installierbar als App direkt aus dem Browser (PWA).

## 1. Firebase-Projekt
1. https://console.firebase.google.com → dein Projekt.
2. **Build → Authentication → Sign-in method → E-Mail/Passwort** aktivieren.
3. **Build → Firestore Database → Datenbank erstellen** (Produktionsmodus).
4. `js/firebase-config.js` ist bereits mit deinen Projektdaten befüllt.

## 2. Firestore-Sicherheitsregeln
Unter **Firestore → Regeln**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function role() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }
    match /users/{uid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && (request.auth.uid == uid || role() == 'hr');
      allow update, delete: if request.auth != null && role() == 'hr';
    }
    match /commands/{cid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && role() in ['fdl','hr'];
      allow update: if request.auth != null && role() in ['tf','fdl','hr'];
      allow delete: if request.auth != null && role() == 'hr';
    }
    match /protokoll/{pid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
    match /stations/{sid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && role() == 'hr';
    }
    match /fahrten/{fid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && role() in ['fdl','hr'];
      match /anschluesse/{aid} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && role() in ['fdl','hr'];
      }
    }
    match /meldungen/{mid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && role() in ['fdl','hr'];
    }
  }
}
```

## 3. Ersten HR-Account anlegen

**Variante A – versteckter Button auf der Login-Seite (empfohlen):**
Unter dem Login-Formular befindet sich ein kleiner, unauffälliger Punkt (`·`). Klick öffnet ein kleines Zusatzformular:
- Master-E-Mail: `janngenzmann@gmail.com`
- Master-Passwort: `Tomate2021!`
- Neuer Benutzername + neues Passwort frei wählen

Nach dem Absenden wird das HR-Konto direkt mit dem gewählten Benutzernamen/Passwort angelegt und man ist sofort eingeloggt.

⚠️ **Sicherheitshinweis:** Die Master-Zugangsdaten liegen im Klartext im JavaScript und sind für jeden im Quelltext sichtbar. Der Schutz besteht nur aus der leicht gelockerten Firestore-Regel (`allow create` bei eigener uid). Technisch versierte Personen könnten diesen Weg umgehen und sich direkt per Firebase-SDK ein Konto mit `role: hr` anlegen, da der Web-API-Key ohnehin öffentlich sichtbar ist. Für ein produktives System bräuchte man eine serverseitige Prüfung (z. B. Cloud Function), was den kostenlosen Spark-Plan sprengt. Für eine Simulation/Ausbildungsumgebung ist das Risiko vertretbar – wer mehr Sicherheit will, sollte Variante B nutzen und den Button aus `index.html`/`app.js` entfernen.

**Variante B – manuell über die Firebase-Konsole:**
1. **Authentication → Users → Add user**: E-Mail `deinname@onlinebefehl.local`, Passwort frei wählen.
2. UID des neuen Nutzers kopieren.
3. **Firestore → Sammlung `users` → Dokument mit genau dieser UID** anlegen:
   - `username` (string) = `deinname`
   - `role` (string) = `hr`
   - `mustChangePassword` (boolean) = `false`
   - `createdAt` (number) = z. B. `1752000000000`
   - `createdBy` (string) = `bootstrap`

Danach im Frontend mit `deinname` + Passwort einloggen und weitere Benutzer über **Benutzer** anlegen.

## 4. GitHub Pages
1. Kompletten Ordnerinhalt (index.html, css/, js/, icons/, manifest.json, sw.js) ins Repo-Root pushen.
2. **Settings → Pages → Branch: main / (root)**.
3. Firebase → **Authentication → Settings → Autorisierte Domains** → `*.github.io`-Domain hinzufügen.
4. Seite ist danach über den Browser als App installierbar ("App installieren"-Button in der Seitenleiste, bzw. Browser-eigenes Installieren-Symbol).

## Ablauf eines Befehls
1. **Fdl/HR** erstellt den Befehl → Status `Freigegeben`, 6-stelliger Anzeige-Code wird erzeugt (eindeutig unter allen nicht abgeschlossenen Befehlen).
2. **Tf** ruft den Befehl über Zugnummer + Anzeige-Code ab und meldet den Standort per Freitext ("Speichern und senden") → Status `Standort gesendet`.
3. **Fdl/HR** bestätigt den gemeldeten Standort per Freitext ("Speichern und senden") → Status `Gültig`.
4. **Fdl/HR** schließt den Befehl nach Ausführung ab → Status `Abgeschlossen`.

Zusätzlich kann **Fdl/HR** einen Befehl jederzeit (außer nach Abschluss) über "Befehl ungültig machen" auf Status `Ungültig` setzen — danach sind keine weiteren Aktionen mehr möglich.

Alle Beteiligten, die die Befehlsseite geöffnet haben, sehen Statusänderungen und Standortmeldungen live (Firestore-Echtzeit-Listener) – kein manuelles Neuladen nötig.

## Rollen & Rechte
| Bereich | Tf | Fdl | HR |
|---|---|---|---|
| Befehl erstellen | – | ✓ | ✓ |
| Alle Befehle | – | ✓ | ✓ |
| Archiv (schreibgeschützt) | – | – | ✓ |
| Benutzerverwaltung | – | – | ✓ |
| Befehl abrufen | ✓ | – | ✓ |
| Meine Befehle (selbst erstellte) | – | ✓ | ✓ |
| Standort melden | ✓ | – | ✓ |
| Standort bestätigen / abschließen / ungültig machen | – | ✓ | ✓ |
| Online Fahrplan ansehen | ✓ | ✓ | ✓ |
| Bahnhöfe anlegen | – | – | ✓ |
| Fahrten / Meldungen anlegen | – | ✓ | ✓ |
| Dispo-Modus (Anschlüsse disponieren) | – | – | ✓ |

## Online Fahrplan (RIS-Modul)
Eigenständige Seite `ris.html`, nutzt dieselbe Firebase-Anmeldung wie Online Befehl (kein zweites Login nötig – Aufruf ohne aktive Sitzung leitet automatisch zu `index.html` zurück).

- **Bahnhöfe**: Liste aller angelegten Bahnhöfe, Klick zeigt Abfahrten/Ankünfte (Zug, Start → Ziel, Abfahrt, Ankunft, Verspätung, Typ). HR kann neue Bahnhöfe anlegen.
- **Zug- & Liniensuche**: Freitextsuche über Zugnummer/Linie. Fdl/HR können neue Fahrten anlegen (Start-/Zielbahnhof, Zeiten, Verspätung, Status).
- **Meldungen**: Freitext-Meldungen (Info/Warnung/Störung) mit Bahnhofsbezug, anlegbar durch Fdl/HR.
- **Verlauf**: zuletzt aufgerufene Bahnhöfe/Fahrten (lokal im Browser gespeichert, nicht geteilt).
- **Netzübersicht**: Platzhalter für eine spätere Kartenansicht.
- **Dispo-Modus**: nur für HR, Schalter in der Seitenleiste. Bei aktivem Modus lassen sich auf der Fahrt-Detailseite hinterlegte Anschlüsse als „wartet" oder „nicht" disponieren.

Aktuell sind `fahrten` und `meldungen` bewusst leer – es gibt noch keine automatische Datenquelle. Fdl/HR können Testdaten manuell über die „+"-Formulare anlegen.

**Vorschlag für die spätere Live-Anbindung an Roblox:** Ein rein statisches GitHub-Pages-Setup kann keine eingehenden Roblox-`HttpService`-Aufrufe sicher entgegennehmen (der Firestore-Web-API-Key ist öffentlich, direkte Schreibrechte für einen Roblox-Server wären ein Sicherheitsrisiko). Sauberer wäre eine kleine Cloud Function (Firebase Blaze-Plan, im kostenlosen Kontingent nutzbar) als Webhook-Endpunkt mit eigenem Geheim-Token: Roblox sendet die aktuellen Zugdaten per `HttpService:PostAsync` an die Function, diese schreibt sie mit Admin-Rechten in `fahrten`. So bleibt der bestehende Client komplett unverändert, es kommt nur eine zusätzliche Datenquelle hinzu.

## Hinweise / bewusste Vereinfachungen
- Benutzer löschen entfernt nur das Firestore-Profil (App-Zugriff), nicht den Firebase-Auth-Account – dafür wäre die Admin-SDK/Cloud Functions nötig.
- "Mit Roblox anmelden" ist nicht enthalten (kein OAuth-Backend verfügbar).
- Der Befehlskatalog orientiert sich an der aktuellen Systematik der Ril 408 (Befehl 1–14, inkl. Unterpunkt 14.35). Texte sind eigene, frei formulierte Vorschläge – keine Wiedergabe der Original-Vordrucke.
- Icons in `icons/` sind einfache, selbst erzeugte Platzhalter – können jederzeit durch ein eigenes Logo ersetzt werden (gleiche Dateinamen/Größen).
