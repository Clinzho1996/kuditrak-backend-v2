// backend/controllers/cardFundingController.js - Updated with Bridgecard FX rate

import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import BridgecardCard from "../models/BridgecardCard.js";
import bridgecardService from "../services/bridgecardService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Get current USD/NGN exchange rate from Bridgecard
 */
export const getExchangeRate = async (req, res) => {
	try {
		// Fetch rate from Bridgecard
		const result = await bridgecardService.getFxRateWithCache();

		if (!result.success) {
			// Fallback to config if Bridgecard fails
			const fallbackRate = process.env.USD_NGN_RATE || 1600;
			return res.status(200).json({
				success: true,
				rate: fallbackRate,
				source: "fallback",
				currency: "USD/NGN",
				message: "Using fallback rate",
			});
		}

		// Bridgecard returns rate as { "NGN-USD": 74100 }
		// This means 1 USD = 74100 NGN? Actually it's 1 USD = 74100 NGN (in kobo?)
		// Typically, Bridgecard returns the rate in kobo (100 kobo = 1 NGN)
		// So 74100 kobo = 741 NGN per USD? Let's handle both cases

		let rate = 1600; // Default fallback

		if (result.rate) {
			// The rate might be in kobo or direct
			const rateValue = Object.values(result.rate)[0] || 0;

			// If rate is > 1000, it's likely in kobo (e.g., 74100 kobo = 741 NGN)
			if (rateValue > 1000) {
				rate = rateValue / 100; // Convert kobo to NGN
			} else {
				rate = rateValue;
			}
		}

		// Add your markup (e.g., 2%)
		const markup = 0.02;
		const finalRate = rate * (1 + markup);

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
		console.error("Get exchange rate error:", error);

		// Return fallback rate
		const fallbackRate = process.env.USD_NGN_RATE || 1600;
		res.status(200).json({
			success: true,
			rate: fallbackRate,
			source: "fallback",
			currency: "USD/NGN",
		});
	}
};

/**
 * Fund USD Card from NGN Wallet
 * Uses Bridgecard's FX rate for conversion
 */
export const fundUSDCardFromWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amountInNGN } = req.body;

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
			// Convert from kobo if needed
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

		console.log("💰 Currency Conversion:", {
			amountInNGN,
			fxRate: usdRate,
			finalRate,
			amountInUSD,
			conversionFee,
			finalAmountInUSD,
		});

		// Deduct NGN from wallet
		wallet.balance -= amountInNGN;
		await wallet.save();

		// Fund the USD card via Bridgecard
		const fundingResult = await bridgecardService.fundCard(
			card.cardId,
			finalAmountInUSD,
			"USD",
			`fund_${Date.now()}`,
		);

		if (!fundingResult.success) {
			// Refund NGN if card funding fails
			wallet.balance += amountInNGN;
			await wallet.save();

			return res.status(400).json({
				success: false,
				error: fundingResult.error || "Failed to fund USD card",
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
			status: "success",
			description: `USD card funding from NGN wallet`,
			source: "wallet",
			destination: "card",
			metadata: {
				cardId: card.cardId,
				cardLast4: card.last4,
				sourceAmount: amountInNGN,
				fxRate: usdRate,
				finalRate: finalRate,
			},
		});

		// Update card balance in local DB
		card.balance = (card.balance || 0) + finalAmountInUSD;
		await card.save();

		// Send push notification
		await sendPushToUser(
			userId,
			"💳 USD Card Funded!",
			`$${finalAmountInUSD.toFixed(2)} has been added to your card ending in ${card.last4}.`,
			{
				type: "card_funded",
				cardId: card.cardId,
				amount: finalAmountInUSD,
				currency: "USD",
				fxRate: usdRate,
			},
		);

		res.status(200).json({
			success: true,
			message: "USD card funded successfully",
			data: {
				cardId: card.cardId,
				cardLast4: card.last4,
				amountInNGN,
				amountInUSD: finalAmountInUSD,
				fxRate: usdRate,
				finalRate: finalRate,
				conversionFee,
				newCardBalance: card.balance,
				newWalletBalance: wallet.balance,
				ngnTransaction: ngnTransaction._id,
				usdTransaction: usdTransaction._id,
			},
		});
	} catch (error) {
		console.error("Fund USD card error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};
