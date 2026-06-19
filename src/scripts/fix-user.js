// backend/scripts/migrateToLive.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const migrateToLive = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		console.log("🚀 Starting migration to Anchor LIVE...");
		console.log(
			`🔑 Using API Key: ${process.env.ANCHOR_API_KEY?.substring(0, 20)}...`,
		);
		console.log(`📍 Base URL: ${process.env.ANCHOR_BASE_URL}`);

		// Find all users with Anchor customers
		const users = await User.find({
			anchorCustomerId: { $exists: true, $ne: null },
		});

		console.log(`📊 Found ${users.length} users with Anchor customers`);

		for (const user of users) {
			console.log(`\n🔄 Processing user: ${user.email}`);
			console.log(`   Old Anchor ID: ${user.anchorCustomerId}`);
			console.log(`   Old KYC Level: ${user.anchorKycLevel}`);

			// Delete old Anchor records from local DB
			await AnchorCustomer.deleteOne({ userId: user._id });
			await AnchorWallet.deleteMany({ userId: user._id });

			// Clear user's Anchor fields
			user.anchorCustomerId = null;
			user.anchorCustomerStatus = null;
			user.anchorKycLevel = null;
			await user.save();

			// Create new Anchor customer with KYC data
			console.log(`   Creating new Anchor customer with KYC...`);
			const result = await getOrCreateAnchorCustomer(user._id);

			if (result.success) {
				console.log(`   ✅ New Anchor ID: ${result.customerId}`);
				console.log(`   ✅ KYC Level: ${result.anchorCustomer.kycLevel}`);

				// If user has KYC data, try to upgrade to Tier 1
				if (user.kyc?.bvn && user.kyc?.dateOfBirth && user.kyc?.gender) {
					console.log(`   🔄 Upgrading to Tier 1 with BVN: ${user.kyc.bvn}`);

					const { upgradeCustomerToTier1 } =
						await import("../services/anchorCustomerService.js");
					const upgradeResult = await upgradeCustomerToTier1(
						user._id,
						user.kyc.bvn,
						user.kyc.dateOfBirth.toISOString().split("T")[0],
						user.kyc.gender,
					);

					console.log(
						`   📊 Upgrade Result:`,
						JSON.stringify(upgradeResult, null, 2),
					);
				}
			} else {
				console.log(`   ❌ Failed: ${result.error}`);
			}
		}

		console.log("\n✅ Migration complete!");
		await mongoose.disconnect();
	} catch (error) {
		console.error("❌ Error:", error);
	}
};

migrateToLive();
