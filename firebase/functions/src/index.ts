import { auth } from "firebase-functions/v1";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

initializeApp();

export const processSignUp = auth.user().onCreate(async (user) => {
  await getAuth().setCustomUserClaims(user.uid, { role: "authenticated" });
});
