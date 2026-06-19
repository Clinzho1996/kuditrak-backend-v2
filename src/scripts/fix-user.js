// backend/scripts/syncAnchorKYCStatus.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import AnchorCustomer from "../models/AnchorCustomer.js";
import User from "../models/User.js";
import anchorService from "../services/anchorService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const syncAnchorKYCStatus = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const email = "clintonsworld@yahoo.com";

		// Find the user
		const user = await User.findOne({ email });
		if (!user) {
			console.log(`❌ User not found with email: ${email}`);
			return;
		}

		const anchorCustomer = await AnchorCustomer.findOne({ userId: user._id });
		if (!anchorCustomer) {
			console.log(`❌ No Anchor customer found for user: ${email}`);
			return;
		}

		console.log(
			`📊 Fetching KYC status from Anchor for: ${anchorCustomer.anchorCustomerId}`,
		);

		// Get customer details from Anchor
		const customerResponse = await anchorService.getAnchorCustomer(
			anchorCustomer.anchorCustomerId,
		);

		if (!customerResponse.success) {
			console.error("❌ Failed to fetch customer:", customerResponse.error);
			return;
		}

		const attributes = customerResponse.customer.attributes;
		const verification = attributes?.verification || {};
		const kycLevel = verification?.level || attributes?.kycLevel || "TIER_0";
		const kycStatus =
			verification?.status || attributes?.kycStatus || "unverified";

		console.log(`📊 Anchor KYC Status:`, {
			kycLevel,
			kycStatus,
			verification: verification,
		});

		// Update local records
		anchorCustomer.kycLevel = kycLevel;
		anchorCustomer.kycStatus =
			kycStatus === "approved" ? "approved" : "pending";
		await anchorCustomer.save();

		// Update user
		user.anchorKycLevel = kycLevel;
		if (kycStatus === "approved") {
			user.kyc.isVerified = true;
			user.kyc.verifiedAt = new Date();
		}
		await user.save();

		console.log(`✅ Updated local KYC status to: ${kycLevel} (${kycStatus})`);

		await mongoose.disconnect();
		console.log("\n✅ Sync complete!");
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
};

syncAnchorKYCStatus();
