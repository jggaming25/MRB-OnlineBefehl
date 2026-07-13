# ONLINE BEFEHL – Setup

Reine Frontend-App (HTML/CSS/JS) für GitHub Pages, Backend über Firebase (Auth + Firestore, kostenloser Spark-Plan reicht).

## 1. Firebase-Projekt anlegen
1. https://console.firebase.google.com → "Projekt hinzufügen".
2. Im Projekt: **Build → Authentication → Sign-in method → E-Mail/Passwort** aktivieren.
3. **Build → Firestore Database → Datenbank erstellen** (Produktionsmodus).
4. **Projekteinstellungen → Meine Apps → Web-App hinzufügen** → Konfigurationsobjekt kopieren.
5. In `js/firebase-config.js` die Platzhalter (`DEIN_API_KEY` usw.) durch deine echten Werte ersetzen.

## 2. Firestore-Sicherheitsregeln
Unter **Firestore → Regeln** einfügen:

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
      match /meine/{cid} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
    match /commands/{cid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && role() in ['fdl','hr'];
      allow update: if request.auth != null && role() in ['tf','fdl','hr'];
      allow delete: if request.auth != null && role() == 'hr';
    }
    match /archiv/{aid} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if false;
    }
  }
}
```

## 3. Ersten HR-Account anlegen (Bootstrap)
Da nur HR neue Benutzer anlegen kann, muss der erste HR-Account manuell erstellt werden:
1. **Authentication → Nutzer → Nutzer hinzufügen**: E-Mail `deinname@onlinebefehl.local`, beliebiges Passwort.
2. Die erzeugte User-UID kopieren.
3. **Firestore → Daten → Sammlung `users` → Dokument mit genau dieser UID anlegen**, Felder:
   - `username` (string) = `deinname`
   - `role` (string) = `hr`
   - `mustChangePassword` (boolean) = `false`
   - `createdAt` (number) = aktueller Timestamp in ms, z. B. `1752000000000`
   - `createdBy` (string) = `bootstrap`

Danach kannst du dich im Frontend mit `deinname` + dem vergebenen Passwort einloggen und weitere Benutzer über **Benutzer** anlegen.

## 4. Auf GitHub Pages veröffentlichen
1. Repo erstellen, den kompletten Ordnerinhalt (index.html, css/, js/) ins Repo-Root pushen.
2. **Settings → Pages → Branch: main / (root)** auswählen.
3. Firebase → **Authentication → Settings → Autorisierte Domains** → deine `*.github.io`-Domain hinzufügen.

## Hinweise / bewusste Vereinfachungen
- Rolle **HR** entspricht der obersten Rolle (früher „Admin“).
- Benutzer löschen entfernt nur das Firestore-Profil (App-Zugriff), nicht den Firebase-Auth-Account selbst – das erfordert die Admin-SDK/Cloud Functions und ist clientseitig nicht möglich.
- "Mit Roblox anmelden" ist bewusst nicht enthalten (kein OAuth-Backend verfügbar) – kann später per Cloud Function ergänzt werden.
- Der Befehlskatalog orientiert sich an der Systematik der Ril 408 (Befehl 1–14 inkl. Unterpunkte) plus den zwei Community-Zusatzbefehlen (23, 26) aus eurem bisherigen Archiv. Texte sind eigene, frei formulierte Vorlagen – keine Wiedergabe der Originalvordrucke.
