// Trage hier deine eigenen Firebase-Projektdaten ein.
// Firebase Console -> Projekteinstellungen -> "Meine Apps" -> Web-App -> Konfiguration
const firebaseConfig = {
  apiKey: "AIzaSyBza63G76GPH5LTIHunOjfh5nB9_e7jGio",
  authDomain: "mrb--onlinebefehl.firebaseapp.com",
  projectId: "mrb--onlinebefehl",
  storageBucket: "mrb--onlinebefehl.firebasestorage.app",
  messagingSenderId: "1035944360107",
  appId: "1:1035944360107:web:ebd0af1a8832034a639fee"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Nur für die REST-Benutzererstellung durch HR benötigt (siehe js/app.js -> createUserByHR)
const FIREBASE_API_KEY = firebaseConfig.apiKey;
const EMAIL_DOMAIN = "@onlinebefehl.local"; // Benutzernamen werden intern als Fake-E-Mail geführt
