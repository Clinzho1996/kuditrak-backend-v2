// backend/scripts/checkWalletBalance.js
import dotenv from "dotenv";
import path from "path";
import bridgecardService from "../services/bridgecardService.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const checkWalletBalance = async () => {
	console.log("💰 Checking issuing wallet balance...");

	const result = await bridgecardService.getIssuingWalletBalance("USD");

	console.log("📊 Balance result:", JSON.stringify(result, null, 2));

	// Check if we need to fund the wallet
	if (result.success && result.balance < 1000) {
		console.log("⚠️ Wallet balance is low. Funding...");
		const fundResult = await bridgecardService.fundIssuingWallet("5000", "USD");
		console.log("📊 Fund result:", JSON.stringify(fundResult, null, 2));

		// Check balance again
		const newBalance = await bridgecardService.getIssuingWalletBalance("USD");
		console.log("📊 New balance:", JSON.stringify(newBalance, null, 2));
	}
};

checkWalletBalance();
