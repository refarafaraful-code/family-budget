// שכבת הנתונים: Firebase Auth (אנונימי) + Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, deleteDoc, collection,
  query, where, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);

export function signIn() {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, (user) => {
      if (user) { stop(); resolve(user); }
    });
    signInAnonymously(auth).catch(reject);
  });
}

export async function createFamily(familyId, members) {
  await setDoc(doc(fs, "families", familyId), {
    members,
    budgetSetter: members[0],
    createdAt: serverTimestamp()
  });
}

export async function getFamily(familyId) {
  const snap = await getDoc(doc(fs, "families", familyId));
  return snap.exists() ? snap.data() : null;
}

export function watchMonth(familyId, month, onChange) {
  let budget, expenses;
  const emit = () => {
    if (budget !== undefined && expenses !== undefined) onChange({ budget, expenses });
  };
  const stopBudget = onSnapshot(doc(fs, "families", familyId, "months", month), (snap) => {
    budget = snap.exists() ? snap.data() : null;
    emit();
  });
  const q = query(collection(fs, "families", familyId, "expenses"), where("month", "==", month));
  const stopExpenses = onSnapshot(q, (snap) => {
    expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  });
  return () => { stopBudget(); stopExpenses(); };
}

export function setBudget(familyId, month, amount, who) {
  return setDoc(doc(fs, "families", familyId, "months", month), {
    amount, setBy: who, updatedAt: serverTimestamp()
  });
}

export function addExpense(familyId, expense) {
  return addDoc(collection(fs, "families", familyId, "expenses"), {
    ...expense,
    month: expense.date.slice(0, 7),
    createdAt: serverTimestamp()
  });
}

export function deleteExpense(familyId, id) {
  return deleteDoc(doc(fs, "families", familyId, "expenses", id));
}
