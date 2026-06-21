// scripts/fixOldGoals.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import UserGoal from "../models/UserGoal.js";

// Load environment variables
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGO_URI || process.env.DATABASE_URL;

if (!MONGODB_URI) {
	console.error("❌ MONGODB_URI not found in environment variables");
	process.exit(1);
}

// ==================== SCRIPT CONFIGURATION ====================
const DRY_RUN = true; // Change to false when ready to apply

// ==================== HELPER FUNCTIONS ====================

const fixGoalCommitmentSettings = (goal) => {
	const needsUpdate = {
		hasCommitmentSettings: false,
		hasReleaseDate: false,
		hasOriginalGoalAmount: false,
		hasCommittedAt: false,
	};

	if (!goal.commitmentSettings) {
		goal.commitmentSettings = {
			enabled: false,
			releaseDate: null,
			committedAt: null,
			originalGoalAmount: null,
		};
		needsUpdate.hasCommitmentSettings = true;
	} else {
		if (goal.commitmentSettings.releaseDate === undefined) {
			goal.commitmentSettings.releaseDate = null;
			needsUpdate.hasReleaseDate = true;
		}
		if (goal.commitmentSettings.originalGoalAmount === undefined) {
			goal.commitmentSettings.originalGoalAmount = null;
			needsUpdate.hasOriginalGoalAmount = true;
		}
		if (goal.commitmentSettings.committedAt === undefined) {
			goal.commitmentSettings.committedAt = null;
			needsUpdate.hasCommittedAt = true;
		}
	}

	if (goal.commitmentSettings.enabled && !goal.commitmentSettings.releaseDate) {
		goal.commitmentSettings.enabled = false;
	}

	if (goal.commitmentSettings.releaseDate && !goal.commitmentSettings.enabled) {
		const now = new Date();
		const releaseDate = new Date(goal.commitmentSettings.releaseDate);
		if (releaseDate > now) {
			goal.commitmentSettings.enabled = true;
		}
	}

	return {
		goal,
		needsUpdate:
			Object.values(needsUpdate).some((val) => val === true) ||
			(goal.commitmentSettings.enabled &&
				!goal.commitmentSettings.releaseDate) ||
			(goal.commitmentSettings.releaseDate && !goal.commitmentSettings.enabled),
	};
};

const fixSubAccountLock = async (goal) => {
	try {
		const AnchorSubAccount = await import("../models/AnchorSubAccount.js").then(
			(m) => m.default,
		);

		if (!goal.subAccountId) {
			return { success: false, reason: "No subAccountId" };
		}

		const subAccount = await AnchorSubAccount.findOne({
			subAccountId: goal.subAccountId,
		});

		if (!subAccount) {
			return { success: false, reason: "Sub-account not found" };
		}

		const shouldBeLocked = goal.commitmentSettings?.enabled || false;
		const lockSettings = {
			enabled: shouldBeLocked,
			unlockDate: goal.commitmentSettings?.releaseDate || null,
			lockedAt: shouldBeLocked ? new Date() : null,
		};

		const needsUpdate =
			subAccount.lockSettings?.enabled !== shouldBeLocked ||
			subAccount.lockSettings?.unlockDate !== lockSettings.unlockDate;

		if (needsUpdate) {
			subAccount.lockSettings = lockSettings;
			await subAccount.save();
			return { success: true, updated: true };
		}

		return { success: true, updated: false };
	} catch (error) {
		console.error(
			`Error fixing sub-account for goal ${goal._id}:`,
			error.message,
		);
		return { success: false, reason: error.message };
	}
};

// ==================== MAIN SCRIPT ====================

async function fixOldGoals() {
	console.log("🔵 Starting fix for old goals...");
	console.log(
		`📋 DRY RUN: ${DRY_RUN ? "Preview only (no changes)" : "Will apply changes"}`,
	);
	console.log("");

	let connection = null;

	try {
		// ✅ FIXED: Removed deprecated options
		connection = await mongoose.connect(MONGODB_URI);
		console.log("✅ Connected to MongoDB");
		console.log("");

		console.log("🔍 Fetching all goals...");
		const goals = await UserGoal.find({}).lean();
		console.log(`📊 Found ${goals.length} goals`);
		console.log("");

		let totalFixed = 0;
		let totalCommitmentFixed = 0;
		let totalSubAccountFixed = 0;
		const updatedGoals = [];

		for (const goal of goals) {
			let fixed = false;
			const { goal: fixedGoal, needsUpdate } = fixGoalCommitmentSettings(goal);

			if (needsUpdate) {
				fixed = true;
				totalCommitmentFixed++;

				console.log(`📝 Goal: "${goal.name}" (${goal._id})`);
				console.log(`   Old commitmentSettings:`, goal.commitmentSettings);
				console.log(`   New commitmentSettings:`, fixedGoal.commitmentSettings);
				console.log(
					`   Lock Type: ${fixedGoal.commitmentSettings.enabled ? "🔒 Locked" : "🔓 Flexible"}`,
				);

				if (fixedGoal.commitmentSettings.releaseDate) {
					console.log(
						`   Release Date: ${new Date(fixedGoal.commitmentSettings.releaseDate).toLocaleDateString()}`,
					);
				}

				const subResult = await fixSubAccountLock(fixedGoal);
				if (subResult.success && subResult.updated) {
					totalSubAccountFixed++;
					console.log(`   ✅ Sub-account lock updated`);
				} else if (subResult.success && !subResult.updated) {
					console.log(`   ℹ️ Sub-account lock already correct`);
				} else {
					console.log(`   ⚠️ Sub-account: ${subResult.reason}`);
				}

				if (!DRY_RUN) {
					await UserGoal.updateOne(
						{ _id: goal._id },
						{
							$set: {
								commitmentSettings: fixedGoal.commitmentSettings,
								updatedAt: new Date(),
							},
						},
					);
					console.log(`   ✅ Updated in database`);
					updatedGoals.push({
						id: goal._id,
						name: goal.name,
						oldCommitment: goal.commitmentSettings,
						newCommitment: fixedGoal.commitmentSettings,
					});
				} else {
					console.log(`   🔍 [DRY RUN] Would update this goal`);
				}
				console.log("");
				totalFixed++;
			}
		}

		console.log("================================");
		console.log("📊 SUMMARY");
		console.log("================================");
		console.log(`Total goals processed: ${goals.length}`);
		console.log(`Goals needing fix: ${totalFixed}`);
		console.log(`Commitment settings fixed: ${totalCommitmentFixed}`);
		console.log(`Sub-account locks fixed: ${totalSubAccountFixed}`);
		console.log(
			`DRY RUN: ${DRY_RUN ? "✅ Preview only (no changes made)" : "✅ Changes applied"}`,
		);
		console.log("");

		if (updatedGoals.length > 0 && !DRY_RUN) {
			console.log("📝 Updated goals:");
			updatedGoals.forEach((g) => {
				console.log(`   - ${g.name} (${g.id})`);
			});
		}

		console.log("✅ Script completed successfully!");
	} catch (error) {
		console.error("❌ Script failed:", error);
	} finally {
		if (connection) {
			await mongoose.disconnect();
			console.log("🔌 Disconnected from MongoDB");
		}
	}
}

// ==================== RUN SCRIPT ====================

fixOldGoals()
	.then(() => {
		console.log("✅ Done");
		process.exit(0);
	})
	.catch((error) => {
		console.error("❌ Fatal error:", error);
		process.exit(1);
	});
