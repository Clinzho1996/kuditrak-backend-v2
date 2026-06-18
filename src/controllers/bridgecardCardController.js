// backend/controllers/bridgecardCardController.js
import AnchorCard from "../models/AnchorCard.js";
import BridgecardCard from "../models/BridgecardCard.js";
import BridgecardCardholder from "../models/BridgecardCardholder.js";
import bridgecardService from "../services/bridgecardService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Create a virtual card (USD or NGN)
 */
export const createVirtualCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currency = "USD", metadata = {} } = req.body;

		// Validate currency
		if (!["USD", "NGN"].includes(currency)) {
			return res.status(400).json({ error: "Currency must be USD or NGN" });
		}

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res
				.status(404)
				.json({ error: "Cardholder not found. Please register first." });
		}

		// Check if cardholder is verified
		if (!cardholder.isActive || !cardholder.isIdVerified) {
			return res.status(403).json({
				error: "Cardholder not verified. Please complete KYC verification.",
				status: {
					isActive: cardholder.isActive,
					isIdVerified: cardholder.isIdVerified,
				},
			});
		}

		// Create virtual card
		const result = await bridgecardService.createVirtualCard(
			cardholder.cardholderId,
			currency,
			{ userId: userId.toString(), ...metadata },
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Get card details to store last4
		const cardDetails = await bridgecardService.getCard(result.cardId);
		let last4 = "0000";
		let expiryMonth = "12";
		let expiryYear = "28";

		if (cardDetails.success && cardDetails.card) {
			last4 = cardDetails.card.last4 || "0000";
			expiryMonth = cardDetails.card.expiry_month || "12";
			expiryYear = cardDetails.card.expiry_year || "28";
		}

		// Save to database
		const newCard = await BridgecardCard.create({
			userId,
			cardholderId: cardholder.cardholderId,
			cardId: result.cardId,
			currency,
			cardType: "virtual",
			cardBrand: "visa",
			last4,
			expiryMonth,
			expiryYear,
			cardholderName: req.user.fullName,
			status: "active",
			metaData: { ...metadata, bridgecardData: result.cardDetails },
			isBridgecardCard: true,
		});

		// Send notification
		await sendPushToUser(
			userId,
			`💳 Virtual ${currency} Card Created!`,
			`Your ${currency} virtual card ending in ${last4} has been created.`,
			{ type: "bridgecard_card_created", cardId: result.cardId, currency },
		);

		res.status(201).json({
			success: true,
			message: `${currency} virtual card created successfully`,
			card: {
				id: newCard._id,
				cardId: result.cardId,
				currency,
				cardType: "virtual",
				last4,
				expiryMonth,
				expiryYear,
				status: "active",
				cardholderName: req.user.fullName,
				details: result.cardDetails,
			},
		});
	} catch (error) {
		console.error("Create virtual card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Create a physical card (USD or NGN)
 */
export const createPhysicalCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currency = "USD", shippingAddress, metadata = {} } = req.body;

		// Validate currency
		if (!["USD", "NGN"].includes(currency)) {
			return res.status(400).json({ error: "Currency must be USD or NGN" });
		}

		// Validate shipping address
		if (
			!shippingAddress ||
			!shippingAddress.address ||
			!shippingAddress.city ||
			!shippingAddress.state
		) {
			return res
				.status(400)
				.json({ error: "Complete shipping address required" });
		}

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res
				.status(404)
				.json({ error: "Cardholder not found. Please register first." });
		}

		// Check if cardholder is verified
		if (!cardholder.isActive || !cardholder.isIdVerified) {
			return res.status(403).json({
				error: "Cardholder not verified. Please complete KYC verification.",
				status: {
					isActive: cardholder.isActive,
					isIdVerified: cardholder.isIdVerified,
				},
			});
		}

		// Create physical card
		const result = await bridgecardService.createPhysicalCard(
			cardholder.cardholderId,
			currency,
			shippingAddress,
			{ userId: userId.toString(), ...metadata },
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Get card details
		const cardDetails = await bridgecardService.getCard(result.cardId);
		let last4 = "0000";
		let expiryMonth = "12";
		let expiryYear = "28";

		if (cardDetails.success && cardDetails.card) {
			last4 = cardDetails.card.last4 || "0000";
			expiryMonth = cardDetails.card.expiry_month || "12";
			expiryYear = cardDetails.card.expiry_year || "28";
		}

		// Save to database
		const newCard = await BridgecardCard.create({
			userId,
			cardholderId: cardholder.cardholderId,
			cardId: result.cardId,
			currency,
			cardType: "physical",
			cardBrand: "visa",
			last4,
			expiryMonth,
			expiryYear,
			cardholderName: req.user.fullName,
			status: "pending",
			shippingAddress,
			metaData: { ...metadata, bridgecardData: result.cardDetails },
			isBridgecardCard: true,
		});

		await sendPushToUser(
			userId,
			`💳 Physical ${currency} Card Ordered!`,
			`Your ${currency} physical card has been ordered. Delivery will be arranged.`,
			{
				type: "bridgecard_physical_card_ordered",
				cardId: result.cardId,
				currency,
			},
		);

		res.status(201).json({
			success: true,
			message: `${currency} physical card ordered successfully`,
			card: {
				id: newCard._id,
				cardId: result.cardId,
				currency,
				cardType: "physical",
				last4,
				expiryMonth,
				expiryYear,
				status: "pending",
				cardholderName: req.user.fullName,
				shippingAddress,
				details: result.cardDetails,
			},
		});
	} catch (error) {
		console.error("Create physical card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get all user cards (both Bridgecard and Anchor)
 */
export const getAllUserCards = async (req, res) => {
	try {
		const userId = req.user._id;

		// Get Bridgecard cards
		const bridgecardCards = await BridgecardCard.find({ userId })
			.sort({ createdAt: -1 })
			.lean();

		// Get Anchor cards (existing)
		// const anchorCards = await AnchorCard.find({ userId })
		// 	.sort({ createdAt: -1 })
		// 	.lean();

		// Format response
		const formattedBridgecardCards = bridgecardCards.map((card) => ({
			...card,
			provider: "bridgecard",
			maskedPan: `**** **** **** ${card.last4}`,
			pan: undefined,
		}));

		// const formattedAnchorCards = anchorCards.map((card) => ({
		// 	...card,
		// 	provider: "anchor",
		// 	maskedPan: `**** **** **** ${card.last4}`,
		// 	pan: undefined,
		// }));

		res.status(200).json({
			success: true,
			cards: [...formattedBridgecardCards],
			count: formattedBridgecardCards.length,
			breakdown: {
				bridgecard: formattedBridgecardCards.length,
			},
		});
	} catch (error) {
		console.error("Get all user cards error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get specific card details
 */
export const getCardDetails = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		// Check Bridgecard cards first
		let card = await BridgecardCard.findOne({ userId, cardId });
		let provider = "bridgecard";

		if (!card) {
			// Check Anchor cards
			card = await AnchorCard.findOne({ userId, cardId });
			provider = "anchor";
		}

		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		// Get fresh status from provider
		let freshDetails = null;
		if (provider === "bridgecard") {
			const result = await bridgecardService.getCard(card.cardId);
			if (result.success) {
				freshDetails = result.card;
				// Update local status
				if (freshDetails.status) {
					card.status = freshDetails.status;
					await card.save();
				}
			}
		}

		res.status(200).json({
			success: true,
			card: {
				...card.toObject(),
				provider,
				maskedPan: `**** **** **** ${card.last4}`,
				pan: undefined,
				freshDetails,
			},
		});
	} catch (error) {
		console.error("Get card details error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Freeze/unfreeze card
 */
export const toggleCardStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { action } = req.body;

		// Check which provider owns this card
		let card = await BridgecardCard.findOne({ userId, cardId });
		let provider = "bridgecard";

		if (!card) {
			card = await AnchorCard.findOne({ userId, cardId });
			provider = "anchor";
		}

		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		const newStatus = action === "freeze" ? "frozen" : "active";

		// Update with appropriate provider
		if (provider === "bridgecard") {
			const result = await bridgecardService.updateCardStatus(
				card.cardId,
				newStatus,
			);
			if (!result.success) {
				return res.status(400).json({ error: result.error });
			}
		} else {
			// Anchor card - use existing logic
			try {
				await anchorService.updateCardStatus(card.cardId, newStatus);
			} catch (apiError) {
				console.log("Anchor API error, updating local only:", apiError.message);
			}
		}

		card.status = newStatus;
		await card.save();

		await sendPushToUser(
			userId,
			action === "freeze" ? "🔒 Card Frozen" : "🔓 Card Unfrozen",
			`Your ${provider} card ending in ${card.last4} has been ${action === "freeze" ? "frozen" : "unfrozen"}.`,
			{
				type: "card_status_changed",
				cardId: card.cardId,
				status: newStatus,
				provider,
			},
		);

		res.status(200).json({
			success: true,
			message: `Card ${action === "freeze" ? "frozen" : "unfrozen"} successfully`,
			status: card.status,
			provider,
		});
	} catch (error) {
		console.error("Toggle card status error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Cancel/delete card
 */
export const cancelCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		let card = await BridgecardCard.findOne({ userId, cardId });
		let provider = "bridgecard";

		if (!card) {
			card = await AnchorCard.findOne({ userId, cardId });
			provider = "anchor";
		}

		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		if (provider === "bridgecard") {
			const result = await bridgecardService.cancelCard(card.cardId);
			if (!result.success) {
				return res.status(400).json({ error: result.error });
			}
		} else {
			try {
				await anchorService.cancelCard(card.cardId);
			} catch (apiError) {
				console.log("Anchor API error, updating local only:", apiError.message);
			}
		}

		card.status = "cancelled";
		await card.save();

		await sendPushToUser(
			userId,
			"🗑️ Card Cancelled",
			`Your ${provider} card ending in ${card.last4} has been cancelled.`,
			{ type: "card_cancelled", cardId: card.cardId, provider },
		);

		res.status(200).json({
			success: true,
			message: "Card cancelled successfully",
			provider,
		});
	} catch (error) {
		console.error("Cancel card error:", error);
		res.status(500).json({ error: error.message });
	}
};

// backend/controllers/bridgecardCardController.js - Add these new functions

/**
 * Create USD Card (Virtual)
 */
export const createUSDCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			cardType = "virtual",
			cardBrand = "Mastercard",
			cardLimit = "500000",
			fundingAmount = "300",
			pin = null,
			metadata = {},
		} = req.body;

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res
				.status(404)
				.json({ error: "Cardholder not found. Please register first." });
		}

		// Check if cardholder is verified
		if (!cardholder.isActive || !cardholder.isIdVerified) {
			return res.status(403).json({
				error: "Cardholder not verified. Please complete KYC verification.",
				status: {
					isActive: cardholder.isActive,
					isIdVerified: cardholder.isIdVerified,
				},
			});
		}

		// Create USD card
		const result = await bridgecardService.createUSDCard({
			cardholderId: cardholder.cardholderId,
			cardType,
			cardBrand,
			cardLimit,
			fundingAmount,
			pin,
			metadata: { userId: userId.toString(), ...metadata },
		});

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Get card details to store
		const cardDetails = await bridgecardService.getCardDetails(result.cardId);
		let last4 = "0000";
		let expiryMonth = "12";
		let expiryYear = "28";

		if (cardDetails.success && cardDetails.card) {
			last4 = cardDetails.card.last4 || "0000";
			expiryMonth = cardDetails.card.expiry_month || "12";
			expiryYear = cardDetails.card.expiry_year || "28";
		}

		// Save to database
		const newCard = await BridgecardCard.create({
			userId,
			cardholderId: cardholder.cardholderId,
			cardId: result.cardId,
			currency: "USD",
			cardType: cardType,
			cardBrand: cardBrand,
			last4,
			expiryMonth,
			expiryYear,
			cardholderName: req.user.fullName,
			status: "active",
			metaData: {
				cardLimit,
				fundingAmount,
				...metadata,
				bridgecardData: result.cardDetails,
			},
			isBridgecardCard: true,
		});

		// Send notification
		await sendPushToUser(
			userId,
			`💳 USD ${cardType.charAt(0).toUpperCase() + cardType.slice(1)} Card Created!`,
			`Your USD ${cardType} card ending in ${last4} has been created.`,
			{ type: "bridgecard_usd_card_created", cardId: result.cardId },
		);

		res.status(201).json({
			success: true,
			message: `USD ${cardType} card created successfully`,
			card: {
				id: newCard._id,
				cardId: result.cardId,
				currency: "USD",
				cardType,
				cardBrand,
				last4,
				expiryMonth,
				expiryYear,
				status: "active",
				cardholderName: req.user.fullName,
				details: result.cardDetails,
			},
		});
	} catch (error) {
		console.error("Create USD card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Fund USD Card
 */
export const fundUSDCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount, transactionReference = null } = req.body;

		// Validate amount
		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Valid amount required" });
		}

		// Get card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		// Fund via Bridgecard
		const result = await bridgecardService.fundCard(
			card.cardId,
			amount,
			"USD",
			transactionReference,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: "Card funded successfully",
			transactionReference: result.transactionReference,
			data: result.data,
		});
	} catch (error) {
		console.error("Fund card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get Card Balance
 */
export const getUSDCardBalance = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		const result = await bridgecardService.getCardBalance(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			balance: result.balance,
			bookBalance: result.bookBalance,
			availableBalance: result.availableBalance,
			currency: result.currency,
		});
	} catch (error) {
		console.error("Get card balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unload USD Card
 */
export const unloadUSDCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount, transactionReference = null } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Valid amount required" });
		}

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		// Check if enough balance
		const balance = await bridgecardService.getCardBalance(card.cardId);
		if (!balance.success || balance.availableBalance < amount) {
			return res.status(400).json({ error: "Insufficient balance" });
		}

		const result = await bridgecardService.unloadCard(
			card.cardId,
			amount,
			"USD",
			transactionReference,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: "Card unloaded successfully",
			transactionReference: result.transactionReference,
			data: result.data,
		});
	} catch (error) {
		console.error("Unload card error:", error);
		res.status(500).json({ error: error.message });
	}
};

export const fundIssuingWallet = async (req, res) => {
	try {
		// Only allow in development/sandbox
		if (process.env.NODE_ENV === "production") {
			return res.status(403).json({
				success: false,
				error: "This endpoint is only available in sandbox environment",
			});
		}

		const { amount = "1000", currency = "USD" } = req.body;

		if (!amount || isNaN(amount) || parseInt(amount) <= 0) {
			return res.status(400).json({
				success: false,
				error: "Valid amount required",
			});
		}

		const result = await bridgecardService.fundIssuingWallet(amount, currency);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: `Issuing wallet funded with ${amount} ${currency}`,
			data: result.data,
		});
	} catch (error) {
		console.error("Fund issuing wallet error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get issuing wallet balance
 */
export const getIssuingWalletBalance = async (req, res) => {
	try {
		const { currency = "USD" } = req.query;

		const result = await bridgecardService.getIssuingWalletBalance(currency);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			balance: result.balance,
			currency: result.currency,
			data: result.data,
		});
	} catch (error) {
		console.error("Get issuing wallet balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Freeze a Bridgecard card
 */
export const freezeCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		// Find the card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		// Check if already frozen
		if (card.status === "frozen") {
			return res.status(400).json({
				success: false,
				error: "Card is already frozen",
			});
		}

		// Freeze via Bridgecard API
		const result = await bridgecardService.freezeCard(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Update local status
		card.status = "frozen";
		await card.save();

		await sendPushToUser(
			userId,
			"🔒 Card Frozen",
			`Your USD ${card.cardType} card ending in ${card.last4} has been frozen.`,
			{ type: "card_frozen", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "Card frozen successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				status: card.status,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Freeze card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unfreeze a Bridgecard card
 */
export const unfreezeCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		// Find the card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		// Check if already active
		if (card.status === "active") {
			return res.status(400).json({
				success: false,
				error: "Card is already active",
			});
		}

		// Unfreeze via Bridgecard API
		const result = await bridgecardService.unfreezeCard(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Update local status
		card.status = "active";
		await card.save();

		await sendPushToUser(
			userId,
			"🔓 Card Unfrozen",
			`Your USD ${card.cardType} card ending in ${card.last4} has been unfrozen.`,
			{ type: "card_unfrozen", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "Card unfrozen successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				status: card.status,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Unfreeze card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Update card PIN
 */
export const updateCardPin = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { pin } = req.body;

		// Validate PIN
		if (!pin || !/^\d{4}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 4 digits",
			});
		}

		// Find the card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		// Update PIN via Bridgecard API
		const result = await bridgecardService.updateCardPin(card.cardId, pin);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		await sendPushToUser(
			userId,
			"🔑 Card PIN Updated",
			`Your USD ${card.cardType} card ending in ${card.last4} PIN has been updated.`,
			{ type: "card_pin_updated", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "Card PIN updated successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Update card PIN error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Delete/Cancel a card
 */
export const deleteCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		// Check if already cancelled
		if (card.status === "cancelled") {
			return res.status(400).json({
				success: false,
				error: "Card is already cancelled",
			});
		}

		// Try to unload remaining balance first
		const balance = await bridgecardService.getCardBalance(card.cardId);
		if (balance.success && balance.availableBalance > 0) {
			await bridgecardService.unloadCard(
				card.cardId,
				balance.availableBalance,
				"USD",
				`unload_before_delete_${Date.now()}`,
			);
		}

		// Delete via Bridgecard API
		const result = await bridgecardService.deleteCard(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Update local status
		card.status = "cancelled";
		await card.save();

		await sendPushToUser(
			userId,
			"🗑️ Card Deleted",
			`Your USD ${card.cardType} card ending in ${card.last4} has been deleted.`,
			{ type: "card_deleted", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "Card deleted successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				status: card.status,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Delete card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card transactions
 */
export const getCardTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { page = 1 } = req.query;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.getCardTransactions(
			card.cardId,
			parseInt(page),
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			transactions: result.transactions,
			pagination: {
				page: result.page,
				total: result.total,
				totalPages: result.totalPages,
			},
		});
	} catch (error) {
		console.error("Get card transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

// backend/controllers/bridgecardCardController.js - Updated createNGNCard

/**
 * Create NGN Virtual Card with retry logic
 */
export const createNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			cardType = "virtual",
			pin = null,
			nin = null,
			metadata = {},
		} = req.body;

		// Validate NIN
		if (!nin) {
			return res.status(400).json({
				success: false,
				error: "NIN (National Identification Number) is required for NGN cards",
			});
		}

		if (!/^\d{11}$/.test(nin)) {
			return res.status(400).json({
				success: false,
				error: "Invalid NIN format. Must be 11 digits.",
			});
		}

		// Validate PIN
		if (pin && !/^\d{4}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 4 digits",
			});
		}

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({
				success: false,
				error: "Cardholder not found. Please register first.",
			});
		}

		if (!cardholder.isActive || !cardholder.isIdVerified) {
			return res.status(403).json({
				success: false,
				error: "Cardholder not verified. Please complete KYC verification.",
				status: {
					isActive: cardholder.isActive,
					isIdVerified: cardholder.isIdVerified,
				},
			});
		}

		// Try to create NGN card with retry
		let result = null;
		let attempts = 0;
		const maxAttempts = 2;

		while (attempts < maxAttempts) {
			attempts++;
			console.log(`🔄 Attempt ${attempts} to create NGN card...`);

			result = await bridgecardService.createNGNCard({
				cardholderId: cardholder.cardholderId,
				cardType,
				pin,
				nin,
				metadata: {
					userId: userId.toString(),
					...metadata,
				},
			});

			// If success or not a timeout, break
			if (result.success || !result.isTimeout) {
				break;
			}

			console.log(`⏳ Timeout on attempt ${attempts}, retrying...`);
			// Wait 2 seconds before retry
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		if (!result || !result.success) {
			return res.status(400).json({
				success: false,
				error: result?.error || "NGN card creation failed",
				suggestion:
					"Try using the async endpoint or check your NGN wallet balance",
			});
		}

		// Get card details
		const cardDetails = await bridgecardService.getCardDetails(result.cardId);
		let last4 = "0000";
		let expiryMonth = "12";
		let expiryYear = "28";

		if (cardDetails.success && cardDetails.card) {
			last4 = cardDetails.card.last4 || "0000";
			expiryMonth = cardDetails.card.expiry_month || "12";
			expiryYear = cardDetails.card.expiry_year || "28";
		}

		// Save to database
		const newCard = await BridgecardCard.create({
			userId,
			cardholderId: cardholder.cardholderId,
			cardId: result.cardId,
			currency: "NGN",
			cardType: cardType,
			cardBrand: "mastercard",
			last4,
			expiryMonth,
			expiryYear,
			cardholderName: req.user.fullName,
			status: "active",
			metaData: {
				nin,
				...metadata,
				bridgecardData: result.cardDetails,
			},
			isBridgecardCard: true,
		});

		await sendPushToUser(
			userId,
			`💳 NGN ${cardType.charAt(0).toUpperCase() + cardType.slice(1)} Card Created!`,
			`Your NGN ${cardType} card ending in ${last4} has been created.`,
			{ type: "bridgecard_ngn_card_created", cardId: result.cardId },
		);

		res.status(201).json({
			success: true,
			message: `NGN ${cardType} card created successfully`,
			card: {
				id: newCard._id,
				cardId: result.cardId,
				currency: "NGN",
				cardType,
				last4,
				expiryMonth,
				expiryYear,
				status: "active",
				cardholderName: req.user.fullName,
				details: result.cardDetails,
			},
		});
	} catch (error) {
		console.error("Create NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Create NGN Card Asynchronously (Recommended)
 */
export const createNGNCardAsync = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			cardType = "virtual",
			pin = null,
			nin = null,
			metadata = {},
		} = req.body;

		// Validate NIN
		if (!nin || !/^\d{11}$/.test(nin)) {
			return res.status(400).json({
				success: false,
				error: "Valid 11-digit NIN is required for NGN cards",
			});
		}

		// Validate PIN
		if (pin && !/^\d{4}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 4 digits",
			});
		}

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({
				success: false,
				error: "Cardholder not found. Please register first.",
			});
		}

		if (!cardholder.isActive || !cardholder.isIdVerified) {
			return res.status(403).json({
				success: false,
				error: "Cardholder not verified. Please complete KYC verification.",
			});
		}

		// Create NGN card asynchronously
		const result = await bridgecardService.createNGNCardAsync({
			cardholderId: cardholder.cardholderId,
			cardType,
			pin,
			nin,
			metadata: {
				userId: userId.toString(),
				...metadata,
			},
		});

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(202).json({
			success: true,
			message:
				"NGN card creation initiated. You will receive a webhook when ready.",
			status: "pending",
			cardholderId: result.cardholderId,
		});
	} catch (error) {
		console.error("Create NGN card async error:", error);
		res.status(500).json({ error: error.message });
	}
};
/**
 * Fund NGN Card
 */
export const fundNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount, transactionReference = null } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Valid amount required",
			});
		}

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.fundNGNCard(
			card.cardId,
			amount,
			transactionReference,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		await sendPushToUser(
			userId,
			"💰 NGN Card Funded",
			`₦${amount} has been added to your NGN card ending in ${card.last4}.`,
			{ type: "ngn_card_funded", cardId: card.cardId, amount },
		);

		res.status(200).json({
			success: true,
			message: "NGN card funded successfully",
			transactionReference: result.transactionReference,
			data: result.data,
		});
	} catch (error) {
		console.error("Fund NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unload NGN Card
 */
export const unloadNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount, transactionReference = null } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Valid amount required",
			});
		}

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.unloadNGNCard(
			card.cardId,
			amount,
			transactionReference,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		await sendPushToUser(
			userId,
			"💸 NGN Card Unloaded",
			`₦${amount} has been withdrawn from your NGN card ending in ${card.last4}.`,
			{ type: "ngn_card_unloaded", cardId: card.cardId, amount },
		);

		res.status(200).json({
			success: true,
			message: "NGN card unloaded successfully",
			transactionReference: result.transactionReference,
			data: result.data,
		});
	} catch (error) {
		console.error("Unload NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get NGN Card Balance
 */
export const getNGNCardBalance = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		// Get cardholder
		const cardholder = await BridgecardCardholder.findOne({ userId });
		if (!cardholder) {
			return res.status(404).json({
				success: false,
				error: "Cardholder not found",
			});
		}

		const result = await bridgecardService.getNGNCardBalance(
			cardholder.cardholderId,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			balance: result.balance,
			currency: "NGN",
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Get NGN card balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get NGN Card Transactions
 */
export const getNGNCardTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { page = 1 } = req.query;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.getNGNCardTransactions(
			card.cardId,
			parseInt(page),
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			transactions: result.transactions,
			pagination: {
				page: result.page,
				total: result.total,
				totalPages: result.totalPages,
			},
		});
	} catch (error) {
		console.error("Get NGN card transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get OTP for NGN Card Transaction
 */
export const getNGNCardOTP = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { amount } = req.query;

		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Valid amount required",
			});
		}

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.getNGNCardOTP(
			card.cardId,
			parseFloat(amount),
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			otp: result.otp,
			message: result.message,
			data: result.data,
		});
	} catch (error) {
		console.error("Get NGN card OTP error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Freeze NGN Card
 */
export const freezeNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		if (card.status === "frozen") {
			return res.status(400).json({
				success: false,
				error: "Card is already frozen",
			});
		}

		const result = await bridgecardService.freezeNGNCard(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		card.status = "frozen";
		await card.save();

		await sendPushToUser(
			userId,
			"🔒 NGN Card Frozen",
			`Your NGN card ending in ${card.last4} has been frozen.`,
			{ type: "ngn_card_frozen", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "NGN card frozen successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				status: card.status,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Freeze NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unfreeze NGN Card
 */
export const unfreezeNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		if (card.status === "active") {
			return res.status(400).json({
				success: false,
				error: "Card is already active",
			});
		}

		const result = await bridgecardService.unfreezeNGNCard(card.cardId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		card.status = "active";
		await card.save();

		await sendPushToUser(
			userId,
			"🔓 NGN Card Unfrozen",
			`Your NGN card ending in ${card.last4} has been unfrozen.`,
			{ type: "ngn_card_unfrozen", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "NGN card unfrozen successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				status: card.status,
				last4: card.last4,
			},
		});
	} catch (error) {
		console.error("Unfreeze NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Mock Debit NGN Card (Sandbox only)
 */
export const mockDebitNGNCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount = 100 } = req.body;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		const result = await bridgecardService.mockDebitNGNCard(
			card.cardId,
			amount,
		);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			message: "Mock debit successful",
			data: result.data,
		});
	} catch (error) {
		console.error("Mock debit NGN card error:", error);
		res.status(500).json({ error: error.message });
	}
};
