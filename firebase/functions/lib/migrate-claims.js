"use strict";
/**
 * One-time migration: add { role: 'authenticated' } custom claim to all
 * existing Firebase users so Supabase Third-Party Auth recognises them.
 *
 * Run from the project root:
 *   npx firebase-tools auth:export /tmp/firebase-users.json --format=json
 *   npx ts-node firebase/functions/src/migrate-claims.ts
 *
 * Uses the Firebase CLI's stored access token (from `firebase login`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const PROJECT_ID = "collab-board-e6c5b";
const USERS_FILE = "/tmp/firebase-users.json";
function getAccessToken() {
    const configPath = (0, path_1.join)((0, os_1.homedir)(), ".config", "configstore", "firebase-tools.json");
    const config = JSON.parse((0, fs_1.readFileSync)(configPath, "utf-8"));
    return config.tokens.access_token;
}
async function setCustomClaims(accessToken, uid, claims) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            localId: uid,
            customAttributes: JSON.stringify(claims),
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`setCustomClaims failed for ${uid} (${res.status}): ${err}`);
    }
}
(async () => {
    const accessToken = getAccessToken();
    const exported = JSON.parse((0, fs_1.readFileSync)(USERS_FILE, "utf-8"));
    const users = exported.users ?? [];
    console.log(`Found ${users.length} user(s) in ${USERS_FILE}\n`);
    console.log("Migrating → role: authenticated ...\n");
    let updated = 0;
    let skipped = 0;
    for (const user of users) {
        const existing = user.customAttributes
            ? JSON.parse(user.customAttributes)
            : {};
        if (existing.role === "authenticated") {
            skipped++;
            continue;
        }
        await setCustomClaims(accessToken, user.localId, {
            ...existing,
            role: "authenticated",
        });
        updated++;
        console.log(`  ✓ ${user.localId} (${user.email ?? "no email"})`);
    }
    console.log(`\nDone. Updated ${updated}, skipped ${skipped} (already set).`);
})();
