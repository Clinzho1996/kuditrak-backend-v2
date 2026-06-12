import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Fix __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase service account
const serviceAccountPath = path.join(
	__dirname,
	"../config/serviceAccountKey.json",
);

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));

// Initialize Firebase only once
const firebaseApp = admin.apps.length
	? admin.app()
	: admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});

const run = async () => {
	const user = await admin.auth().createUser({
		email: "testgoogle@gmail.com",
		displayName: "Test Google User",
	});

	const customToken = await admin.auth().createCustomToken(user.uid);

	console.log("CUSTOM TOKEN:");
	console.log(customToken);
};

run();
