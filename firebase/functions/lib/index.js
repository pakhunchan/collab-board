"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processSignUp = void 0;
const v1_1 = require("firebase-functions/v1");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
(0, app_1.initializeApp)();
exports.processSignUp = v1_1.auth.user().onCreate(async (user) => {
    await (0, auth_1.getAuth)().setCustomUserClaims(user.uid, { role: "authenticated" });
});
