// backend/scripts/createFreshTestUser.js
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const createFreshTestUser = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		// First, clean up any existing test users
		await User.deleteMany({ email: /test.*@example\.com/ });
		await AnchorCustomer.deleteMany({});
		await AnchorWallet.deleteMany({});

		console.log("✅ Cleaned up existing test data");

		// Generate unique identifiers
		const timestamp = Date.now();
		const uniqueSuffix = timestamp.toString().slice(-6);

		const testUser = {
			fullName: "John Smith",
			email: `john.smith.${uniqueSuffix}@test.com`,
			password: await bcrypt.hash("Test123!", 10),
			phoneNumber: `080${uniqueSuffix}${Math.floor(Math.random() * 100)}`,
			kyc: {
				bvn: "22222222200",
				dateOfBirth: new Date("1996-03-20"),
				gender: "Female",
				isVerified: false,
				address: {
					street: "123 Test Street",
					city: "Lagos",
					state: "Lagos",
					country: "NG",
					postalCode: "100001",
				},
			},
		};

		console.log("📝 Creating test user:", testUser.email);
		console.log("📞 Phone number:", testUser.phoneNumber);

		const user = await User.create(testUser);
		console.log("✅ User created:", user._id);

		// Create Anchor customer
		console.log("\n🏦 Creating Anchor customer...");
		const anchorResult = await getOrCreateAnchorCustomer(user._id);

		if (anchorResult.success) {
			console.log("✅ Anchor customer created:", anchorResult.customerId);
			console.log("KYC Level:", anchorResult.anchorCustomer.kycLevel);

			// If KYC data was included, submit for verification
			if (testUser.kyc.bvn) {
				console.log("\n📝 Submitting KYC for verification...");
				const { submitKYCForVerification } =
					await import("../services/anchorCustomerService.js");
				const verifyResult = await submitKYCForVerification(user._id);
				console.log("Verification result:", verifyResult);
			}
		} else {
			console.log("❌ Failed to create Anchor customer:", anchorResult.error);
		}

		console.log("\n📋 Test User Credentials:");
		console.log("Email:", testUser.email);
		console.log("Password: Test123!");
		console.log("User ID:", user._id);
		console.log("Phone:", testUser.phoneNumber);

		await mongoose.disconnect();
	} catch (error) {
		console.error("Error:", error);
	}
};

createFreshTestUser();
