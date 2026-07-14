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
      allow write: if request.auth != null && role() == 'hr';
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
  }
}
```

## 3. Ersten HR-Account anlegen (Bootstrap)
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
1. **Fdl/HR** erstellt den Befehl → Status `Freigegeben`, 6-stelliger Zugriffscode wird erzeugt (eindeutig unter allen nicht abgeschlossenen Befehlen).
2. **Tf** ruft den Befehl über Zugnummer + Zugriffscode ab und bestätigt den Standort per Freitext → Status `Standort gesendet`.
3. **Fdl/HR** bestätigt den gemeldeten Standort (optional mit Notiz) → Status `Standort bestätigt`.
4. **Tf** quittiert den Befehl → Status `Quittiert`.
5. **Fdl/HR** schließt den Befehl ab → Status `Abgeschlossen`.

Alle Beteiligten, die die Befehlsseite geöffnet haben, sehen Statusänderungen live (Firestore-Echtzeit-Listener) – kein manuelles Neuladen nötig.

## Rollen & Rechte
| Bereich | Tf | Fdl | HR |
|---|---|---|---|
| Befehl erstellen | – | ✓ | ✓ |
| Alle Befehle | – | ✓ | ✓ |
| Archiv (schreibgeschützt) | – | – | ✓ |
| Benutzerverwaltung | – | – | ✓ |
| Befehl abrufen | ✓ | – | ✓ |
| Meine Befehle (selbst erstellte) | – | ✓ | – |

## Hinweise / bewusste Vereinfachungen
- Benutzer löschen entfernt nur das Firestore-Profil (App-Zugriff), nicht den Firebase-Auth-Account – dafür wäre die Admin-SDK/Cloud Functions nötig.
- "Mit Roblox anmelden" ist nicht enthalten (kein OAuth-Backend verfügbar).
- Der Befehlskatalog orientiert sich an der aktuellen Systematik der Ril 408 (Befehl 1–14, inkl. Unterpunkt 14.35). Texte sind eigene, frei formulierte Vorschläge – keine Wiedergabe der Original-Vordrucke.
- Icons in `icons/` sind einfache, selbst erzeugte Platzhalter – können jederzeit durch ein eigenes Logo ersetzt werden (gleiche Dateinamen/Größen).
