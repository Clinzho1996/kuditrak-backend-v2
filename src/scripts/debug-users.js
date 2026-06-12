// scripts/debug-users.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

const debugUsers = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);
		console.log("✅ Connected to MongoDB\n");

		// Get ALL users
		const allUsers = await User.find({}).lean();
		console.log(`📊 Total users: ${allUsers.length}\n`);

		// Separate by provider
		const localUsers = allUsers.filter((u) => u.provider === "local");
		const googleUsers = allUsers.filter((u) =>
			["google", "google.com"].includes(u.provider),
		);
		const appleUsers = allUsers.filter((u) =>
			["apple", "apple.com"].includes(u.provider),
		);

		console.log("📈 USER BREAKDOWN:");
		console.log(`   Local users: ${localUsers.length}`);
		console.log(`   Google users: ${googleUsers.length}`);
		console.log(`   Apple users: ${appleUsers.length}`);
		console.log(
			`   Other: ${allUsers.length - (localUsers.length + googleUsers.length + appleUsers.length)}\n`,
		);

		// Show all Google users
		if (googleUsers.length > 0) {
			console.log("🔐 GOOGLE USERS:");
			googleUsers.forEach((user) => {
				console.log(`   - ${user.email}`);
				console.log(`     Name: ${user.fullName}`);
				console.log(`     ID: ${user._id}`);
				console.log(`     FirebaseUID: ${user.firebaseUid || "MISSING"}`);
				console.log(`     Created: ${user.createdAt}`);
				console.log("");
			});
		} else {
			console.log("🔐 No Google users found in database");
		}

		// Show duplicate emails
		const emailGroups = new Map();
		allUsers.forEach((user) => {
			if (!emailGroups.has(user.email)) {
				emailGroups.set(user.email, []);
			}
			emailGroups.get(user.email).push(user);
		});

		const duplicates = Array.from(emailGroups.entries()).filter(
			([_, users]) => users.length > 1,
		);

		if (duplicates.length > 0) {
			console.log("\n⚠️ DUPLICATE EMAILS FOUND:");
			duplicates.forEach(([email, users]) => {
				console.log(`   ${email}:`);
				users.forEach((user) => {
					console.log(
						`     - ${user.provider}: ${user.fullName} (${user._id})`,
					);
				});
			});
		} else {
			console.log("\n✅ No duplicate emails found");
		}

		// Check for users with same Firebase UID
		const firebaseGroups = new Map();
		allUsers.forEach((user) => {
			if (user.firebaseUid) {
				if (!firebaseGroups.has(user.firebaseUid)) {
					firebaseGroups.set(user.firebaseUid, []);
				}
				firebaseGroups.get(user.firebaseUid).push(user);
			}
		});

		const firebaseDuplicates = Array.from(firebaseGroups.entries()).filter(
			([_, users]) => users.length > 1,
		);

		if (firebaseDuplicates.length > 0) {
			console.log("\n⚠️ DUPLICATE FIREBASE UIDS:");
			firebaseDuplicates.forEach(([uid, users]) => {
				console.log(`   ${uid}:`);
				users.forEach((user) => {
					console.log(`     - ${user.provider}: ${user.email}`);
				});
			});
		}

		await mongoose.disconnect();
		console.log("\n✅ Done");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
};

debugUsers();
