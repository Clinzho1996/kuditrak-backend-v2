import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

// PRODUCTION (Render)
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
	try {
		const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT;
		serviceAccount = JSON.parse(rawJson);

		// CRITICAL: Ensure the private key handles newlines correctly
		if (serviceAccount.private_key) {
			serviceAccount.private_key = serviceAccount.private_key.replace(
				/\\n/g,
				"\n",
			);
		}
	} catch (err) {
		console.error("🔥 Error parsing FIREBASE_SERVICE_ACCOUNT:", err.message);
	}
}

// LOCAL DEVELOPMENT
else {
	try {
		const serviceAccountPath = path.join(
			__dirname,
			"../config/serviceAccountKey.json",
		);

		if (fs.existsSync(serviceAccountPath)) {
			serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
		} else {
			console.warn("serviceAccountKey.json not found. Firebase auth disabled.");
		}
	} catch (err) {
		console.error("Failed to load Firebase service account:", err.message);
	}
}

// Initialize Firebase only if credentials exist
let firebaseApp = null;

if (serviceAccount) {
	firebaseApp = admin.apps.length
		? admin.app()
		: admin.initializeApp({
				credential: admin.credential.cert(serviceAccount),
			});
}

// Verify Firebase ID Token
export const verifyFirebaseToken = async (idToken) => {
	try {
		if (!firebaseApp) {
			throw new Error("Firebase not initialized");
		}

		const decoded = await admin.auth().verifyIdToken(idToken);
		return decoded;
	} catch (error) {
		throw new Error("Invalid Firebase token");
	}
};

export default firebaseApp;
