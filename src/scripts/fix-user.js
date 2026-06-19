// backend/scripts/manualLinkAnchorCustomer.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import AnchorCustomer from "../models/AnchorCustomer.js";
import User from "../models/User.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const manualLink = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const email = "clintonsworld@yahoo.com";
		const existingCustomerId = "1781169846182464-anc_ind_cst";

		const user = await User.findOne({ email });
		if (!user) {
			console.log("User not found");
			return;
		}

		// Check if already linked
		const existing = await AnchorCustomer.findOne({ userId: user._id });
		if (existing) {
			console.log("Already linked:", existing.anchorCustomerId);
			return;
		}

		// Create local record
		const anchorCustomer = await AnchorCustomer.create({
			userId: user._id,
			anchorCustomerId: existingCustomerId,
			fullName: {
				firstName: user.fullName.split(" ")[0],
				lastName: user.fullName.split(" ").slice(1).join(" ") || user.fullName,
			},
			email: user.email,
			phoneNumber: user.phoneNumber || "08000000000",
			address: {
				addressLine_1: user.kyc?.address?.street || "Unknown Street",
				city: user.kyc?.address?.city || "Lagos",
				state: user.kyc?.address?.state || "Lagos",
				postalCode: user.kyc?.address?.postalCode || "000000",
				country: user.kyc?.address?.country || "NG",
			},
			kycLevel: "TIER_0",
			kycStatus: "pending",
			metadata: { userId: user._id.toString() },
		});

		// Update user
		user.anchorCustomerId = existingCustomerId;
		user.anchorCustomerStatus = "active";
		user.anchorKycLevel = "TIER_0";
		await user.save();

		console.log("✅ Successfully linked customer:", existingCustomerId);
		await mongoose.disconnect();
	} catch (error) {
		console.error("Error:", error);
	}
};

manualLink();
