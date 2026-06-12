// scripts/fix-user-conflicts.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI;

const fixUserConflicts = async () => {
	try {
		await mongoose.connect(MONGODB_URI);
		console.log("✅ Connected to MongoDB");
		console.log("========================================");
		console.log("FIXING USER AUTHENTICATION CONFLICTS");
		console.log("========================================\n");

		// Find all users
		const allUsers = await User.find({});
		console.log(`📊 Total users in database: ${allUsers.length}\n`);

		// Group users by email
		const emailGroups = new Map();

		for (const user of allUsers) {
			if (!emailGroups.has(user.email)) {
				emailGroups.set(user.email, []);
			}
			emailGroups.get(user.email).push(user);
		}

		// Find conflicts (emails with multiple users)
		const conflicts = [];
		for (const [email, users] of emailGroups) {
			if (users.length > 1) {
				conflicts.push({ email, users });
			}
		}

		if (conflicts.length === 0) {
			console.log("✅ No conflicts found! All emails are unique.");
			await mongoose.disconnect();
			process.exit(0);
		}

		console.log(`⚠️ Found ${conflicts.length} email conflicts:\n`);

		let totalFixed = 0;
		let localUsersKept = 0;
		let socialUsersModified = 0;

		for (const conflict of conflicts) {
			console.log(`📧 Email: ${conflict.email}`);
			console.log(`   Users: ${conflict.users.length}`);

			// Separate local vs social users
			const localUser = conflict.users.find((u) => u.provider === "local");
			const socialUsers = conflict.users.filter((u) => u.provider !== "local");
			const socialProviders = socialUsers.map((u) => u.provider).join(", ");

			console.log(`   - Local user: ${localUser ? localUser._id : "None"}`);
			console.log(
				`   - Social users (${socialUsers.length}): ${socialProviders}`,
			);

			if (localUser && socialUsers.length > 0) {
				console.log(
					`\n   🔧 Fixing: Local user exists, modifying social users...`,
				);

				for (const socialUser of socialUsers) {
					// Create unique email for social user
					const emailParts = conflict.email.split("@");
					const providerPrefix = socialUser.provider.replace(".com", "");
					const newEmail = `${emailParts[0]}+${providerPrefix}@${emailParts[1]}`;

					const oldEmail = socialUser.email;
					socialUser.email = newEmail;

					// Also update firebaseUid if missing
					if (!socialUser.firebaseUid && socialUser.firebaseUid !== undefined) {
						// Keep existing firebaseUid or generate placeholder
						console.log(`   ⚠️ Social user missing firebaseUid`);
					}

					await socialUser.save();
					socialUsersModified++;
					totalFixed++;

					console.log(`   ✅ Updated social user ${socialUser._id}:`);
					console.log(`      ${oldEmail} → ${newEmail}`);
					console.log(`      Provider: ${socialUser.provider}`);
					console.log(`      Name: ${socialUser.fullName}`);
				}
				localUsersKept++;
				console.log(
					`   ✅ Local user ${localUser._id} preserved with original email\n`,
				);
			} else if (!localUser && socialUsers.length > 1) {
				// Multiple social users with same email (rare)
				console.log(
					`   🔧 Fixing: Multiple social users, keeping first, modifying others...`,
				);

				const keepUser = socialUsers[0];
				const modifyUsers = socialUsers.slice(1);

				console.log(`   ✅ Keeping: ${keepUser.provider} user ${keepUser._id}`);

				for (const socialUser of modifyUsers) {
					const emailParts = conflict.email.split("@");
					const providerPrefix = socialUser.provider.replace(".com", "");
					const newEmail = `${emailParts[0]}+${providerPrefix}_${Date.now()}@${emailParts[1]}`;

					const oldEmail = socialUser.email;
					socialUser.email = newEmail;
					await socialUser.save();
					socialUsersModified++;
					totalFixed++;

					console.log(`   ✅ Updated: ${oldEmail} → ${newEmail}`);
				}
				console.log("");
			} else {
				console.log(`   ℹ️ No action needed (no local user conflict)\n`);
			}
		}

		console.log("========================================");
		console.log("📊 SUMMARY");
		console.log("========================================");
		console.log(`   Conflicts found: ${conflicts.length}`);
		console.log(`   Local users preserved: ${localUsersKept}`);
		console.log(`   Social users modified: ${socialUsersModified}`);
		console.log(`   Total users fixed: ${totalFixed}`);
		console.log("========================================\n");

		// Verification - Check if conflicts still exist
		console.log("📋 VERIFICATION:");

		const updatedUsers = await User.find({});
		const newEmailGroups = new Map();

		for (const user of updatedUsers) {
			if (!newEmailGroups.has(user.email)) {
				newEmailGroups.set(user.email, []);
			}
			newEmailGroups.get(user.email).push(user);
		}

		const remainingConflicts = [];
		for (const [email, users] of newEmailGroups) {
			if (users.length > 1) {
				remainingConflicts.push({ email, users });
			}
		}

		if (remainingConflicts.length === 0) {
			console.log("✅ All conflicts resolved successfully!");
		} else {
			console.log(
				`⚠️ Still have ${remainingConflicts.length} conflicts that need manual review:`,
			);
			for (const conflict of remainingConflicts) {
				console.log(
					`   - ${conflict.email}: ${conflict.users.map((u) => u.provider).join(", ")}`,
				);
			}
		}

		// Show sample of social users
		const socialUsers = await User.find({ provider: { $ne: "local" } }).limit(
			5,
		);
		console.log("\n📱 Sample social users after fix:");
		for (const user of socialUsers) {
			console.log(`   - ${user.email} (${user.provider}) - ${user.fullName}`);
		}

		// Show sample of local users
		const localUsers = await User.find({ provider: "local" }).limit(5);
		console.log("\n🔐 Sample local users:");
		for (const user of localUsers) {
			console.log(`   - ${user.email} - ${user.fullName}`);
		}

		// Check for users without firebaseUid
		const socialWithoutFirebase = await User.find({
			provider: { $in: ["google", "apple", "google.com", "apple.com"] },
			firebaseUid: { $exists: false },
		});

		if (socialWithoutFirebase.length > 0) {
			console.log(
				`\n⚠️ Found ${socialWithoutFirebase.length} social users without firebaseUid:`,
			);
			for (const user of socialWithoutFirebase) {
				console.log(`   - ${user.email} (${user.provider}) - ID: ${user._id}`);
			}
			console.log(
				"   These users may need firebaseUid added manually or on next login",
			);
		}

		await mongoose.disconnect();
		console.log("\n✅ Disconnected from MongoDB");
		console.log("\n💡 NEXT STEPS:");
		console.log("   1. Test login with affected social users");
		console.log("   2. Verify they can access their correct accounts");
		console.log("   3. Update your socialAuth function with the new logic");
		console.log("   4. Monitor for any new conflicts");

		process.exit(0);
	} catch (error) {
		console.error("❌ Error:", error);
		console.error("\n🔍 Error details:", error.stack);
		await mongoose.disconnect();
		process.exit(1);
	}
};

// Run the fix
fixUserConflicts();
