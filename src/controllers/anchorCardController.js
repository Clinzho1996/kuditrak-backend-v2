// backend/controllers/anchorCardController.js - Fixed version

import AnchorCard from "../models/AnchorCard.js";
import AnchorCustomer from "../models/AnchorCustomer.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

// Helper function for error handling in controller
const handleControllerError = (error, res) => {
	console.error("Controller error:", error);
	return res.status(500).json({
		success: false,
		message: error.message || "Internal server error",
	});
};

/**
 * Create a virtual card
 */
// backend/controllers/anchorCardController.js - Updated createVirtualCard

export const createVirtualCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			cardholderName,
			cardDesign,
			transactionLimit,
			dailyLimit,
			monthlyLimit,
		} = req.body;

		if (!cardholderName) {
			return res.status(400).json({ error: "Cardholder name is required" });
		}

		// Get user's Anchor customer
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		// Check KYC level (need at least Tier 1 for cards)
		if (anchorCustomer.kycLevel === "TIER_0") {
			return res.status(403).json({
				success: false,
				error: "KYC upgrade required",
				message: "Please complete your KYC verification to create a card",
				requiredLevel: "TIER_1",
			});
		}

		// Create virtual card using service
		const cardResponse = await anchorService.createVirtualCard(
			anchorCustomer.anchorCustomerId,
			null, // No wallet ID needed for now
			cardholderName,
			cardDesign || "default",
			{ transactionLimit, dailyLimit, monthlyLimit },
			{ userId: userId.toString(), platform: "kuditrak" },
		);

		if (!cardResponse.success) {
			return res.status(400).json({
				success: false,
				error: cardResponse.error,
			});
		}

		// Save card to database without walletId
		const savedCard = await AnchorCard.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null, // Explicitly set to null
			cardId: cardResponse.cardId,
			cardBrand: cardResponse.cardBrand,
			last4: cardResponse.last4,
			expiryMonth: cardResponse.expiryMonth,
			expiryYear: cardResponse.expiryYear,
			cardholderName: cardholderName,
			cardType: "virtual",
			status: "active",
			limits: {
				transactionLimit: transactionLimit || null,
				dailyLimit: dailyLimit || null,
				monthlyLimit: monthlyLimit || null,
			},
			cardDesign: cardDesign || "default",
			isMock: cardResponse.isMock || false,
		});

		// Send push notification
		try {
			await sendPushToUser(
				userId,
				"💳 Virtual Card Created!",
				`Your ${cardResponse.cardBrand} virtual card ending in ${cardResponse.last4} has been created.`,
				{
					type: "card_created",
					cardId: cardResponse.cardId,
					last4: cardResponse.last4,
				},
			);
		} catch (pushError) {
			console.error("Push notification error:", pushError);
		}

		res.status(201).json({
			success: true,
			message: "Virtual card created successfully",
			card: {
				id: savedCard._id,
				cardId: cardResponse.cardId,
				cardBrand: cardResponse.cardBrand,
				last4: cardResponse.last4,
				expiryMonth: cardResponse.expiryMonth,
				expiryYear: cardResponse.expiryYear,
				cardholderName: cardholderName,
				status: "active",
				cardDesign: cardDesign || "default",
				pan: cardResponse.pan,
				isMock: cardResponse.isMock || false,
			},
		});
	} catch (error) {
		console.error("Create virtual card error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get user's cards
 */
export const getUserCards = async (req, res) => {
	try {
		const userId = req.user._id;

		const cards = await AnchorCard.find({ userId })
			.sort({ createdAt: -1 })
			.lean();

		const processedCards = cards.map((card) => ({
			...card,
			maskedPan: `**** **** **** ${card.last4}`,
			pan: undefined, // Never return full PAN in normal requests
		}));

		res.status(200).json({
			success: true,
			cards: processedCards,
			count: processedCards.length,
		});
	} catch (error) {
		console.error("Get user cards error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card details
 */

export const getCardDetails = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		console.log("Looking for card with:", { userId, cardId });

		// Try to find by cardId field first, then by _id
		let card = await AnchorCard.findOne({
			userId,
			$or: [
				{ cardId: cardId }, // Search by cardId field
				{ _id: cardId }, // Search by MongoDB _id
			],
		});

		if (!card) {
			// If still not found, list all user's cards for debugging
			const userCards = await AnchorCard.find({ userId }).select(
				"cardId _id last4",
			);
			console.log("Available cards for user:", userCards);

			return res.status(404).json({
				success: false,
				error: "Card not found",
				message: `No card found with id: ${cardId}`,
				availableCards: userCards.map((c) => ({
					id: c._id,
					cardId: c.cardId,
					last4: c.last4,
				})),
			});
		}

		res.status(200).json({
			success: true,
			card: {
				...card.toObject(),
				maskedPan: `**** **** **** ${card.last4}`,
				pan: undefined, // Never return full PAN
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

		console.log("Toggling card status:", { userId, cardId, action });

		// Try to find by cardId field first, then by _id
		let card = await AnchorCard.findOne({
			userId,
			$or: [
				{ cardId: cardId }, // Search by cardId field
				{ _id: cardId }, // Search by MongoDB _id
			],
		});

		if (!card) {
			// List available cards for debugging
			const userCards = await AnchorCard.find({ userId }).select(
				"cardId _id last4 status",
			);
			console.log(
				"Available cards:",
				userCards.map((c) => ({
					id: c._id,
					cardId: c.cardId,
					last4: c.last4,
				})),
			);

			return res.status(404).json({
				success: false,
				error: "Card not found",
				message: `No card found with id: ${cardId}`,
				availableCards: userCards.map((c) => ({
					id: c._id,
					cardId: c.cardId,
					last4: c.last4,
				})),
			});
		}

		const newStatus = action === "freeze" ? "frozen" : "active";

		// Try to update in Anchor, but if it fails, just update local
		try {
			if (anchorService.updateCardStatus) {
				await anchorService.updateCardStatus(card.cardId, newStatus);
			}
		} catch (apiError) {
			console.log("Anchor API error, updating local only:", apiError.message);
		}

		card.status = newStatus;
		await card.save();

		try {
			await sendPushToUser(
				userId,
				action === "freeze" ? "🔒 Card Frozen" : "🔓 Card Unfrozen",
				`Your card ending in ${card.last4} has been ${action === "freeze" ? "frozen" : "unfrozen"}.`,
				{ type: "card_status_changed", cardId: card.cardId, status: newStatus },
			);
		} catch (pushError) {
			console.error("Push notification error:", pushError);
		}

		res.status(200).json({
			success: true,
			message: `Card ${action === "freeze" ? "frozen" : "unfrozen"} successfully`,
			status: card.status,
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
				status: card.status,
			},
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

		console.log("Cancelling card:", { userId, cardId });

		// Try to find by cardId field first, then by _id
		let card = await AnchorCard.findOne({
			userId,
			$or: [
				{ cardId: cardId }, // Search by cardId field
				{ _id: cardId }, // Search by MongoDB _id
			],
		});

		if (!card) {
			// List available cards for debugging
			const userCards = await AnchorCard.find({ userId }).select(
				"cardId _id last4 status",
			);

			return res.status(404).json({
				success: false,
				error: "Card not found",
				message: `No card found with id: ${cardId}`,
				availableCards: userCards.map((c) => ({
					id: c._id,
					cardId: c.cardId,
					last4: c.last4,
				})),
			});
		}

		// Check if card is already cancelled
		if (card.status === "cancelled") {
			return res.status(400).json({
				success: false,
				error: "Card already cancelled",
				message: `Card ending in ${card.last4} is already cancelled`,
			});
		}

		// Try to cancel in Anchor
		try {
			if (anchorService.cancelCard) {
				await anchorService.cancelCard(card.cardId);
			}
		} catch (apiError) {
			console.log("Anchor API error, updating local only:", apiError.message);
		}

		card.status = "cancelled";
		await card.save();

		try {
			await sendPushToUser(
				userId,
				"🗑️ Card Cancelled",
				`Your card ending in ${card.last4} has been cancelled.`,
				{ type: "card_cancelled", cardId: card.cardId },
			);
		} catch (pushError) {
			console.error("Push notification error:", pushError);
		}

		res.status(200).json({
			success: true,
			message: "Card cancelled successfully",
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
				status: card.status,
			},
		});
	} catch (error) {
		console.error("Cancel card error:", error);
		res.status(500).json({ error: error.message });
	}
};
/**
 * Add test card (development only)
 */
export const addTestCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardholderName } = req.body;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({ error: "Anchor customer not found" });
		}

		const testCard = await AnchorCard.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null,
			cardId: `test_card_${Date.now()}`,
			cardBrand: "visa",
			last4: Math.floor(1000 + Math.random() * 9000).toString(),
			expiryMonth: "12",
			expiryYear: "28",
			cardholderName: cardholderName || req.user.fullName,
			cardType: "virtual",
			status: "active",
			limits: {
				transactionLimit: 1000000,
				dailyLimit: 500000,
				monthlyLimit: 5000000,
			},
			isMock: true,
		});

		res.status(201).json({
			success: true,
			message: "Test card added successfully",
			card: {
				id: testCard._id,
				cardId: testCard.cardId,
				cardBrand: testCard.cardBrand,
				last4: testCard.last4,
				expiryMonth: testCard.expiryMonth,
				expiryYear: testCard.expiryYear,
				cardholderName: testCard.cardholderName,
				status: testCard.status,
				testCardNumber: "4111111111111111",
				testCVV: "123",
			},
		});
	} catch (error) {
		console.error("Add test card error:", error);
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
		const { limit = 50, offset = 0 } = req.query;

		const card = await AnchorCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		// Return mock transactions for development
		const mockTransactions = [
			{
				id: "tx_1",
				amount: 2500,
				currency: "NGN",
				type: "debit",
				description: "Purchase at Store",
				merchantName: "Local Store",
				status: "success",
				date: new Date(),
			},
			{
				id: "tx_2",
				amount: 50000,
				currency: "NGN",
				type: "debit",
				description: "Online Shopping",
				merchantName: "Online Mart",
				status: "success",
				date: new Date(Date.now() - 86400000),
			},
		];

		res.status(200).json({
			success: true,
			transactions: mockTransactions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total: mockTransactions.length,
			},
		});
	} catch (error) {
		console.error("Get card transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};
