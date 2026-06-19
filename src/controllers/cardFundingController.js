// backend/controllers/cardFundingController.js
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import BridgecardCard from "../models/BridgecardCard.js";
import bridgecardService from "../services/bridgecardService.js";

// backend/controllers/cardFundingController.js - Add test function

export const testExchangeRateRoute = async (req, res) => {
	console.log("🔵 Test route hit!");
	res.json({
		success: true,
		message: "Exchange rate route is working",
		timestamp: new Date().toISOString(),
	});
};
export const getExchangeRate = async (req, res) => {
	try {
		console.log("🔵 Fetching exchange rate...");

		// Directly call the Bridgecard API without cache first
		const result = await bridgecardService.getFxRate();

		console.log("📊 Full result:", JSON.stringify(result, null, 2));

		if (!result.success) {
			console.log("⚠️ Bridgecard FX rate failed, using fallback");
			const fallbackRate = process.env.USD_NGN_RATE || 1600;
			return res.status(200).json({
				success: true,
				rate: fallbackRate,
				source: "fallback",
				currency: "USD/NGN",
				message: "Using fallback rate",
			});
		}

		// Bridgecard returns { "NGN-USD": 139230 }
		const rateValue = result.rate ? Object.values(result.rate)[0] : 0;
		console.log(`📊 Raw FX Rate value: ${rateValue}`);

		// Convert from kobo (100 kobo = 1 NGN)
		// If rateValue is 139230, then 1 USD = 1,392.30 NGN
		let rate = rateValue / 100;

		// Add 2% markup
		const markup = 0.02;
		const finalRate = rate * (1 + markup);

		console.log(`✅ Final FX Rate: ₦${finalRate}/$1`);

		res.status(200).json({
			success: true,
			rate: finalRate,
			baseRate: rate,
			markup: markup * 100,
			source: "bridgecard",
			currency: "USD/NGN",
			raw: result.rate,
		});
	} catch (error) {
		console.error("❌ Get exchange rate error:", error);
		const fallbackRate = process.env.USD_NGN_RATE || 1600;
		res.status(200).json({
			success: true,
			rate: fallbackRate,
			source: "fallback",
			currency: "USD/NGN",
		});
	}
};

// backend/controllers/cardFundingController.js - Updated with polling

/**
 * Fund USD Card from NGN Wallet
 */
export const fundUSDCardFromWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amountInNGN } = req.body;

		console.log("🔵 Funding USD card:", { userId, cardId, amountInNGN });

		if (!cardId || !amountInNGN || amountInNGN <= 0) {
			return res.status(400).json({
				success: false,
				error: "Card ID and amount in NGN are required",
			});
		}

		// Get the USD card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		if (card.status !== "active") {
			return res.status(400).json({
				success: false,
				error: "Card is not active. Please activate the card first.",
			});
		}

		// Get user's NGN wallet
		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		if (wallet.balance < amountInNGN) {
			return res.status(400).json({
				success: false,
				error: "Insufficient NGN balance",
				available: wallet.balance,
				requested: amountInNGN,
			});
		}

		// Get FX rate from Bridgecard
		const fxResult = await bridgecardService.getFxRateWithCache();

		let usdRate = 1600;
		if (fxResult.success && fxResult.rate) {
			const rateValue = Object.values(fxResult.rate)[0] || 0;
			usdRate = rateValue > 1000 ? rateValue / 100 : rateValue;
		}

		const markup = 0.02;
		const finalRate = usdRate * (1 + markup);
		const amountInUSD = amountInNGN / finalRate;
		const conversionFee = amountInUSD * 0.01;
		const finalAmountInUSD = amountInUSD - conversionFee;
		const amountInCents = Math.round(finalAmountInUSD * 100);

		// Check minimum amount
		const MINIMUM_USD_AMOUNT = 3.0;
		if (finalAmountInUSD < MINIMUM_USD_AMOUNT) {
			const minNGNNeeded = Math.ceil((MINIMUM_USD_AMOUNT * finalRate) / 0.99);
			return res.status(400).json({
				success: false,
				error: `Minimum funding amount is $${MINIMUM_USD_AMOUNT.toFixed(2)} (₦${minNGNNeeded.toLocaleString()})`,
				minimumUSD: MINIMUM_USD_AMOUNT,
				currentUSD: finalAmountInUSD,
				minimumNGN: minNGNNeeded,
			});
		}

		console.log("💰 Currency Conversion:", {
			amountInNGN,
			fxRate: usdRate,
			finalRate,
			amountInUSD,
			conversionFee,
			finalAmountInUSD,
			amountInCents,
		});

		// ✅ Ensure issuing wallet has sufficient balance
		const walletBalance =
			await bridgecardService.getIssuingWalletBalance("USD");
		console.log("💰 Issuing Wallet Balance:", walletBalance);

		// The balance might be returned as a string, parse it
		let availableBalance = 0;
		if (walletBalance.success) {
			// Check if balance is in the data object
			availableBalance = walletBalance.balance || 0;
			if (walletBalance.data?.issuing_balance_USD) {
				availableBalance = parseFloat(walletBalance.data.issuing_balance_USD);
			}
		}

		console.log(
			`💰 Available balance: ${availableBalance}, Needed: ${finalAmountInUSD}`,
		);

		// If balance is low, fund the issuing wallet
		if (availableBalance < finalAmountInUSD) {
			console.log("⚠️ Issuing wallet balance low. Attempting to fund...");
			const fundResult = await bridgecardService.fundIssuingWallet(
				"5000",
				"USD",
			);
			console.log("💰 Issuing wallet funded:", fundResult);
		}

		// Deduct NGN from wallet FIRST
		wallet.balance -= amountInNGN;
		await wallet.save();

		// Generate unique reference
		const reference = `fund_${Date.now()}_${userId.toString().slice(-6)}`;

		// Fund the USD card via Bridgecard
		const fundingResult = await bridgecardService.fundCard(
			card.cardId,
			finalAmountInUSD,
			"USD",
			reference,
		);

		// Create transaction records
		const ngnTransaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount: amountInNGN,
			currency: "NGN",
			type: "debit",
			category: "transfer",
			status: "success",
			description: `NGN to USD conversion for card ending in ${card.last4}`,
			source: "wallet",
			destination: "card",
			metadata: {
				cardId: card.cardId,
				cardLast4: card.last4,
				fxRate: usdRate,
				finalRate: finalRate,
				amountInUSD: finalAmountInUSD,
				conversionFee: conversionFee,
				transactionType: "wallet_to_card",
				bridgecardReference: reference,
			},
		});

		const usdTransaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			cardId: card._id,
			amount: finalAmountInUSD,
			currency: "USD",
			type: "credit",
			category: "deposit",
			status: fundingResult.success ? "pending" : "failed",
			description: `USD card funding from NGN wallet`,
			source: "wallet",
			destination: "card",
			metadata: {
				cardId: card.cardId,
				cardLast4: card.last4,
				sourceAmount: amountInNGN,
				fxRate: usdRate,
				finalRate: finalRate,
				bridgecardReference: reference,
				bridgecardStatus: fundingResult.status,
			},
		});

		// ✅ Try to get the updated card balance from Bridgecard
		let updatedBalance = card.balance;
		try {
			const cardBalance = await bridgecardService.getCardBalance(card.cardId);
			if (cardBalance.success) {
				updatedBalance = cardBalance.balance;
				card.balance = updatedBalance;
				await card.save();
			}
		} catch (balanceErr) {
			console.log(
				"⚠️ Could not fetch updated card balance:",
				balanceErr.message,
			);
		}

		res.status(200).json({
			success: true,
			message: fundingResult.success
				? "USD card funding initiated successfully"
				: "USD card funding failed",
			data: {
				cardId: card.cardId,
				cardLast4: card.last4,
				amountInNGN,
				amountInUSD: finalAmountInUSD,
				amountInCents,
				fxRate: usdRate,
				finalRate: finalRate,
				conversionFee,
				newCardBalance:
					updatedBalance || (card.balance || 0) + finalAmountInUSD,
				newWalletBalance: wallet.balance,
				bridgecardReference: reference,
				status: fundingResult.status || "pending",
				ngnTransaction: ngnTransaction._id,
				usdTransaction: usdTransaction._id,
				bridgecardResponse: fundingResult,
			},
		});
	} catch (error) {
		console.error("❌ Fund USD card error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};
