// Trage hier deine eigenen Firebase-Projektdaten ein.
// Firebase Console -> Projekteinstellungen -> "Meine Apps" -> Web-App -> Konfiguration
const firebaseConfig = {
  apiKey: "DEIN_API_KEY",
  authDomain: "DEIN_PROJEKT.firebaseapp.com",
  projectId: "DEIN_PROJEKT",
  storageBucket: "DEIN_PROJEKT.appspot.com",
  messagingSenderId: "DEINE_SENDER_ID",
  appId: "DEINE_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Nur für die REST-Benutzererstellung durch HR benötigt (siehe js/app.js -> createUserByHR)
const FIREBASE_API_KEY = firebaseConfig.apiKey;
const EMAIL_DOMAIN = "@onlinebefehl.local"; // Benutzernamen werden intern als Fake-E-Mail geführt
