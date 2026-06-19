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

// backend/controllers/cardFundingController.js - Updated fundUSDCardFromWallet

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

		// Check if card is active
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

		// Check if user has enough NGN balance
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

		let usdRate = 1600; // Default fallback

		if (fxResult.success && fxResult.rate) {
			const rateValue = Object.values(fxResult.rate)[0] || 0;
			usdRate = rateValue > 1000 ? rateValue / 100 : rateValue;
		}

		// Apply your markup (e.g., 2%)
		const markup = 0.02;
		const finalRate = usdRate * (1 + markup);

		// Calculate USD amount
		const amountInUSD = amountInNGN / finalRate;

		// Apply a conversion fee (e.g., 1%)
		const conversionFee = amountInUSD * 0.01;
		const finalAmountInUSD = amountInUSD - conversionFee;

		// Check minimum amount (Bridgecard requires at least $3 or $4 depending on card limit)
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
			amountInCents: Math.round(finalAmountInUSD * 100),
		});

		// ✅ Check if issuing wallet has sufficient balance
		// In sandbox, you need to fund the issuing wallet first
		const walletBalance =
			await bridgecardService.getIssuingWalletBalance("USD");
		console.log("💰 Issuing Wallet Balance:", walletBalance);

		if (walletBalance.success && walletBalance.balance < finalAmountInUSD) {
			// Try to fund the issuing wallet automatically in sandbox
			console.log("⚠️ Issuing wallet balance low. Attempting to fund...");
			try {
				// Fund with a large amount to cover testing
				const fundResult = await bridgecardService.fundIssuingWallet(
					"5000",
					"USD",
				);
				console.log("💰 Issuing wallet funded:", fundResult);
			} catch (fundErr) {
				console.log(
					"⚠️ Could not fund issuing wallet automatically:",
					fundErr.message,
				);
			}
		}

		// Deduct NGN from wallet
		wallet.balance -= amountInNGN;
		await wallet.save();

		// ✅ Fund the USD card via Bridgecard (amount will be converted to cents)
		const fundingResult = await bridgecardService.fundCard(
			card.cardId,
			finalAmountInUSD,
			"USD",
			`fund_${Date.now()}_${userId.toString().slice(-6)}`,
		);

		if (!fundingResult.success) {
			// Refund NGN if card funding fails
			wallet.balance += amountInNGN;
			await wallet.save();

			return res.status(400).json({
				success: false,
				error: fundingResult.error || "Failed to fund USD card",
				details: fundingResult.details,
			});
		}

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
				source: "bridgecard_fx",
				bridgecardReference: fundingResult.transactionReference,
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
			status: "pending",
			description: `USD card funding from NGN wallet (pending)`,
			source: "wallet",
			destination: "card",
			metadata: {
				cardId: card.cardId,
				cardLast4: card.last4,
				sourceAmount: amountInNGN,
				fxRate: usdRate,
				finalRate: finalRate,
				bridgecardReference: fundingResult.transactionReference,
				status: fundingResult.status,
			},
		});

		res.status(200).json({
			success: true,
			message:
				"USD card funding initiated. You'll receive a notification when complete.",
			data: {
				cardId: card.cardId,
				cardLast4: card.last4,
				amountInNGN,
				amountInUSD: finalAmountInUSD,
				amountInCents: Math.round(finalAmountInUSD * 100),
				fxRate: usdRate,
				finalRate: finalRate,
				conversionFee,
				newCardBalance: (card.balance || 0) + finalAmountInUSD,
				newWalletBalance: wallet.balance,
				bridgecardReference: fundingResult.transactionReference,
				status: fundingResult.status,
				ngnTransaction: ngnTransaction._id,
				usdTransaction: usdTransaction._id,
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
