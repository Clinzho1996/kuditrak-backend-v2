// backend/scripts/createVirtualAccountDirect.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import User from "../models/User.js";
import anchorService from "../services/anchorService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const createVirtualAccountDirect = async () => {
	try {
		await mongoose.connect(process.env.MONGO_URI);

		const email = "clintonsworld@yahoo.com";
		const user = await User.findOne({ email });
		if (!user) {
			console.log("❌ User not found");
			return;
		}

		const anchorCustomer = await AnchorCustomer.findOne({ userId: user._id });
		if (!anchorCustomer) {
			console.log("❌ Anchor customer not found");
			return;
		}

		console.log(`👤 User: ${user.email}`);
		console.log(`📊 Anchor Customer ID: ${anchorCustomer.anchorCustomerId}`);
		console.log(`📊 KYC Level: ${anchorCustomer.kycLevel}`);

		// Check if virtual account already exists
		const existingAccount = await AnchorVirtualAccount.findOne({
			userId: user._id,
			isActive: true,
		});

		if (existingAccount) {
			console.log(
				`✅ Virtual account already exists: ${existingAccount.accountNumber}`,
			);
			return;
		}

		// Try to create deposit account directly
		console.log("\n🏦 Creating deposit account directly...");

		const result = await anchorService.createDepositAccount(
			anchorCustomer.anchorCustomerId,
			"SAVINGS",
			{
				userId: user._id.toString(),
				platform: "kuditrak",
				currency: "NGN",
				force_create: true,
			},
		);

		console.log("\n📊 Result:", JSON.stringify(result, null, 2));

		if (result.success) {
			// Get account number
			const accountNumberResponse = await anchorService.getAccountNumber(
				result.accountId,
			);

			// Save to database
			const virtualAccount = await AnchorVirtualAccount.create({
				userId: user._id,
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				walletId: null,
				accountNumber: accountNumberResponse.success
					? accountNumberResponse.accountNumber
					: "pending",
				bankName: accountNumberResponse.success
					? accountNumberResponse.bankName
					: "Anchor Bank",
				bankCode: "000",
				accountName: user.fullName,
				anchorReference: result.accountId,
				isActive: true,
				isMock: false,
				provider: "anchor",
				currency: "NGN",
			});

			console.log(`\n✅ Virtual account created successfully!`);
			console.log(`📌 Account Number: ${virtualAccount.accountNumber}`);
			console.log(`🏦 Bank Name: ${virtualAccount.bankName}`);
		} else {
			console.log("\n❌ Failed to create virtual account:", result.error);

			// If still failing, provide manual instructions
			console.log(
				"\n📌 Please create the virtual account manually in Anchor dashboard:",
			);
			console.log("1. Go to https://sandbox.getanchor.co");
			console.log("2. Navigate to Accounts → Deposit Accounts");
			console.log("3. Click 'Create Account'");
			console.log(`4. Select customer: ${anchorCustomer.anchorCustomerId}`);
			console.log("5. Choose product: SAVINGS");
			console.log("6. Copy the account number and run the manual add script");
		}

		await mongoose.disconnect();
	} catch (error) {
		console.error("❌ Error:", error);
	}
};

createVirtualAccountDirect();
