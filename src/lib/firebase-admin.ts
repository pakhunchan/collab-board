import { initializeApp, getApps, App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let app: App;

if (getApps().length === 0) {
  app = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
} else {
  app = getApps()[0];
}

export const adminAuth = getAuth(app);
