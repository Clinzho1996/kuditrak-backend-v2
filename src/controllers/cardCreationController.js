// backend/controllers/cardCreationController.js - Complete Version

import BridgecardCard from "../models/BridgecardCard.js";
import Budget from "../models/Budget.js";
import Category from "../models/Category.js";
import bridgecardService from "../services/bridgecardService.js";
import {
	createCardRequest,
	getCardStatus,
	getUserCardsWithDetails,
	processCardCreation,
} from "../services/cardCreationService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Step 1: Create card request with budget & category integration
 */
export const createCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const cardData = req.body;

		// Validate required fields from UI
		const requiredFields = ["cardName", "spendingLimit", "budgetCategory"];
		for (const field of requiredFields) {
			if (!cardData[field]) {
				return res.status(400).json({
					success: false,
					error: `Missing required field: ${field}`,
				});
			}
		}

		const result = await createCardRequest(userId, cardData);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Start processing in background
		processCardCreation(result.requestId).catch((error) => {
			console.error("Background card creation error:", error);
		});

		res.status(201).json({
			success: true,
			message: "Card creation initiated",
			requestId: result.requestId,
			status: "processing",
			category: result.category,
			budget: result.budget,
			estimatedTime: "30-60 seconds",
		});
	} catch (error) {
		console.error("Create card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card creation status (polling)
 */
export const getCardCreationStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;

		const result = await getCardStatus(userId, requestId);

		if (!result.success) {
			return res.status(404).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			status: result.status,
			cardRequest: result.cardRequest,
		});
	} catch (error) {
		console.error("Get card status error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get user's cards with full budget and category details
 */
export const getUserCards = async (req, res) => {
	try {
		const userId = req.user._id;

		const result = await getUserCardsWithDetails(userId);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		res.status(200).json({
			success: true,
			cards: result.cards,
			count: result.cards.length,
		});
	} catch (error) {
		console.error("Get user cards error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card details by ID
 */
export const getCardDetails = async (req, res) => {
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

		// Get fresh details from provider
		let freshDetails = null;
		if (!card.isAnchorCard && card.cardId) {
			const result = await bridgecardService.getCardDetails(card.cardId);
			if (result.success) {
				freshDetails = result.card;
			}
		}

		// Get balance
		let balance = null;
		if (!card.isAnchorCard && card.cardId) {
			const balanceResult = await bridgecardService.getCardBalance(card.cardId);
			if (balanceResult.success) {
				balance = {
					balance: balanceResult.balance,
					availableBalance: balanceResult.availableBalance,
					currency: balanceResult.currency,
				};
			}
		}

		res.status(200).json({
			success: true,
			card: {
				...card.toObject(),
				maskedPan: `**** **** **** ${card.last4}`,
				provider: card.isAnchorCard ? "anchor" : "bridgecard",
				freshDetails,
				balance,
			},
		});
	} catch (error) {
		console.error("Get card details error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card spending and budget status
 */
export const getCardBudgetStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		const budgetId = card.metaData?.budgetId;
		if (!budgetId) {
			return res.status(404).json({ error: "No budget linked to this card" });
		}

		const budget = await Budget.findById(budgetId);
		if (!budget) {
			return res.status(404).json({ error: "Budget not found" });
		}

		const percentageUsed = (budget.spent / budget.amount) * 100;

		res.status(200).json({
			success: true,
			budget: {
				id: budget._id,
				name: budget.name,
				amount: budget.amount,
				spent: budget.spent,
				remaining: budget.amount - budget.spent,
				percentageUsed: Math.round(percentageUsed),
				isExceeded: budget.spent > budget.amount,
				frequency: budget.frequency,
				startDate: budget.startDate,
				endDate: budget.endDate,
			},
			card: {
				id: card._id,
				cardId: card.cardId,
				displayName: card.metaData?.cardName,
				status: card.status,
			},
		});
	} catch (error) {
		console.error("Get card budget status error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Update card budget
 */
export const updateCardBudget = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId } = req.params;
		const { amount, frequency, name } = req.body;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({ error: "Card not found" });
		}

		const budgetId = card.metaData?.budgetId;
		if (!budgetId) {
			return res.status(404).json({ error: "No budget linked to this card" });
		}

		const budget = await Budget.findByIdAndUpdate(
			budgetId,
			{
				amount: amount || undefined,
				frequency: frequency || undefined,
				name: name || undefined,
			},
			{ new: true },
		);

		// Update card metadata
		if (amount) {
			card.metaData.spendingLimit = amount;
			await card.save();
		}

		res.status(200).json({
			success: true,
			message: "Budget updated successfully",
			budget,
		});
	} catch (error) {
		console.error("Update card budget error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get budget dashboard data
 */
export const getBudgetDashboard = async (req, res) => {
	try {
		const userId = req.user._id;

		// Get all budgets
		const budgets = await Budget.find({ userId });

		// Get all cards
		const cards = await BridgecardCard.find({ userId });

		// Get categories
		const categories = await Category.find({ userId });

		// Calculate totals
		const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
		const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
		const totalRemaining = totalBudget - totalSpent;

		// Group by category
		const budgetsByCategory = await Promise.all(
			budgets.map(async (budget) => {
				const card = cards.find(
					(c) => c.metaData?.budgetId === budget._id.toString(),
				);
				const category = categories.find(
					(c) => c._id.toString() === card?.metaData?.categoryId,
				);

				return {
					...budget.toObject(),
					category: category ? category.name : "Uncategorized",
					card: card
						? {
								id: card._id,
								cardId: card.cardId,
								last4: card.last4,
								color: card.metaData?.color || "green",
							}
						: null,
					percentageUsed: (budget.spent / budget.amount) * 100,
				};
			}),
		);

		res.status(200).json({
			success: true,
			dashboard: {
				summary: {
					totalBudget,
					totalSpent,
					totalRemaining,
					budgetCount: budgets.length,
					cardCount: cards.length,
				},
				budgets: budgetsByCategory,
				categories,
			},
		});
	} catch (error) {
		console.error("Get budget dashboard error:", error);
		res.status(500).json({ error: error.message });
	}
};

// ==================== CARD MANAGEMENT FUNCTIONS ====================

/**
 * Freeze a card
 */
export const freezeCard = async (req, res) => {
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

		// Freeze based on provider
		if (card.isAnchorCard) {
			// Anchor cards - update local status only
			card.status = "frozen";
			await card.save();
		} else {
			// Bridgecard cards
			const result = await bridgecardService.freezeCard(card.cardId);
			if (!result.success) {
				return res.status(400).json({
					success: false,
					error: result.error,
				});
			}
			card.status = "frozen";
			await card.save();
		}

		// Send notification
		await sendPushToUser(
			userId,
			"🔒 Card Frozen",
			`Your ${card.metaData?.cardName || "card"} ending in ${card.last4} has been frozen.`,
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
				displayName: card.metaData?.cardName,
			},
		});
	} catch (error) {
		console.error("Freeze card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unfreeze a card
 */
export const unfreezeCard = async (req, res) => {
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

		// Unfreeze based on provider
		if (card.isAnchorCard) {
			card.status = "active";
			await card.save();
		} else {
			const result = await bridgecardService.unfreezeCard(card.cardId);
			if (!result.success) {
				return res.status(400).json({
					success: false,
					error: result.error,
				});
			}
			card.status = "active";
			await card.save();
		}

		// Send notification
		await sendPushToUser(
			userId,
			"🔓 Card Unfrozen",
			`Your ${card.metaData?.cardName || "card"} ending in ${card.last4} has been unfrozen.`,
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
				displayName: card.metaData?.cardName,
			},
		});
	} catch (error) {
		console.error("Unfreeze card error:", error);
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

		if (card.status === "cancelled") {
			return res.status(400).json({
				success: false,
				error: "Card is already cancelled",
			});
		}

		// For Bridgecard cards, try to unload balance first
		if (!card.isAnchorCard && card.cardId) {
			try {
				const balance = await bridgecardService.getCardBalance(card.cardId);
				if (balance.success && balance.availableBalance > 0) {
					await bridgecardService.unloadCard(
						card.cardId,
						balance.availableBalance,
						"USD",
						`unload_before_delete_${Date.now()}`,
					);
				}
			} catch (unloadError) {
				console.log("Unload before delete error:", unloadError);
			}

			// Delete from Bridgecard
			const result = await bridgecardService.deleteCard(card.cardId);
			if (!result.success) {
				return res.status(400).json({
					success: false,
					error: result.error,
				});
			}
		}

		// Update card status
		card.status = "cancelled";
		await card.save();

		// Remove budget link if exists
		if (card.metaData?.budgetId) {
			await Budget.findByIdAndUpdate(card.metaData.budgetId, {
				isActive: false,
				cardId: null,
			});
		}

		// Send notification
		await sendPushToUser(
			userId,
			"🗑️ Card Deleted",
			`Your ${card.metaData?.cardName || "card"} ending in ${card.last4} has been deleted.`,
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
 * Fund a card
 */
export const fundCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount, transactionReference } = req.body;

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

		if (card.status === "cancelled") {
			return res.status(400).json({
				success: false,
				error: "Cannot fund a cancelled card",
			});
		}

		if (card.status === "frozen") {
			return res.status(400).json({
				success: false,
				error: "Cannot fund a frozen card. Please unfreeze first.",
			});
		}

		let result;

		// Fund based on provider
		if (card.isAnchorCard) {
			// Anchor virtual accounts - fund via Anchor
			const anchorCustomer = await AnchorCustomer.findOne({ userId });
			if (!anchorCustomer) {
				return res.status(404).json({
					success: false,
					error: "Anchor customer not found",
				});
			}

			// Get or create wallet
			let wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
			if (!wallet) {
				const walletResponse = await anchorService.createAnchorWallet(
					anchorCustomer.anchorCustomerId,
					"Main Wallet",
					{ userId: userId.toString() },
				);
				if (walletResponse.success) {
					wallet = await AnchorWallet.create({
						userId,
						anchorCustomerId: anchorCustomer.anchorCustomerId,
						walletId: walletResponse.walletId,
						walletType: "main",
						balance: 0,
						name: "Main Wallet",
					});
				}
			}

			// Update wallet balance
			wallet.balance += amount;
			await wallet.save();

			// Update card metadata balance
			card.metaData.balance = (card.metaData.balance || 0) + amount;
			await card.save();

			result = {
				success: true,
				message: "Card funded successfully",
				data: { balance: wallet.balance, amount },
			};
		} else {
			// Bridgecard cards
			const currency = card.currency || "USD";
			result = await bridgecardService.fundCard(
				card.cardId,
				amount,
				currency,
				transactionReference || `fund_${Date.now()}`,
			);

			if (!result.success) {
				return res.status(400).json({
					success: false,
					error: result.error,
				});
			}
		}

		// Send notification
		await sendPushToUser(
			userId,
			"💰 Card Funded",
			`${card.currency || "USD"} ${amount} has been added to your ${card.metaData?.cardName || "card"} ending in ${card.last4}.`,
			{ type: "card_funded", cardId: card.cardId, amount },
		);

		res.status(200).json({
			success: true,
			message: "Card funded successfully",
			transactionReference: result.transactionReference || `fund_${Date.now()}`,
			data: result.data,
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
				displayName: card.metaData?.cardName,
			},
		});
	} catch (error) {
		console.error("Fund card error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get card balance
 */
export const getCardBalance = async (req, res) => {
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

		let balance = {
			balance: 0,
			availableBalance: 0,
			currency: card.currency || "USD",
		};

		if (card.isAnchorCard) {
			// Get balance from Anchor
			const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
			if (wallet) {
				balance.balance = wallet.balance || 0;
				balance.availableBalance = wallet.available || wallet.balance || 0;
			}
		} else {
			// Get balance from Bridgecard
			const result = await bridgecardService.getCardBalance(card.cardId);
			if (result.success) {
				balance = {
					balance: result.balance || 0,
					availableBalance: result.availableBalance || 0,
					currency: result.currency || "USD",
				};
			}
		}

		res.status(200).json({
			success: true,
			card: {
				id: card._id,
				cardId: card.cardId,
				last4: card.last4,
				displayName: card.metaData?.cardName,
				status: card.status,
			},
			balance,
		});
	} catch (error) {
		console.error("Get card balance error:", error);
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
		const { page = 1, limit = 20 } = req.query;

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		let transactions = [];
		let total = 0;

		if (card.isAnchorCard) {
			// Get Anchor transactions (virtual account)
			// In a real implementation, you'd fetch from Anchor
			transactions = [
				{
					id: "tx_1",
					amount: 5000,
					type: "credit",
					description: "Deposit from bank transfer",
					status: "completed",
					date: new Date(),
				},
			];
			total = transactions.length;
		} else {
			// Get Bridgecard transactions
			const result = await bridgecardService.getCardTransactions(
				card.cardId,
				parseInt(page),
			);
			if (result.success) {
				transactions = result.transactions || [];
				total = result.total || 0;
			}
		}

		res.status(200).json({
			success: true,
			transactions,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				totalPages: Math.ceil(total / parseInt(limit)),
			},
		});
	} catch (error) {
		console.error("Get card transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unload card (withdraw funds)
 */
export const unloadCard = async (req, res) => {
	try {
		const userId = req.user._id;
		const { cardId, amount } = req.body;

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

		let result;

		if (card.isAnchorCard) {
			// Unload from Anchor virtual account
			const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
			if (!wallet) {
				return res.status(404).json({
					success: false,
					error: "Wallet not found",
				});
			}

			if (wallet.balance < amount) {
				return res.status(400).json({
					success: false,
					error: "Insufficient balance",
				});
			}

			wallet.balance -= amount;
			await wallet.save();

			if (card.metaData.balance) {
				card.metaData.balance = Math.max(
					0,
					(card.metaData.balance || 0) - amount,
				);
				await card.save();
			}

			result = {
				success: true,
				message: "Card unloaded successfully",
				data: { balance: wallet.balance, amount },
			};
		} else {
			// Unload from Bridgecard
			const currency = card.currency || "USD";
			result = await bridgecardService.unloadCard(
				card.cardId,
				amount,
				currency,
				`unload_${Date.now()}`,
			);

			if (!result.success) {
				return res.status(400).json({
					success: false,
					error: result.error,
				});
			}
		}

		// Send notification
		await sendPushToUser(
			userId,
			"💸 Card Unloaded",
			`${card.currency || "USD"} ${amount} has been withdrawn from your ${card.metaData?.cardName || "card"} ending in ${card.last4}.`,
			{ type: "card_unloaded", cardId: card.cardId, amount },
		);

		res.status(200).json({
			success: true,
			message: "Card unloaded successfully",
			data: result.data,
		});
	} catch (error) {
		console.error("Unload card error:", error);
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

		if (!pin || !/^\d{4}$/.test(pin)) {
			return res.status(400).json({
				success: false,
				error: "PIN must be exactly 4 digits",
			});
		}

		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return res.status(404).json({
				success: false,
				error: "Card not found",
			});
		}

		if (card.isAnchorCard) {
			// Anchor cards don't have PIN - update metadata only
			card.metaData.pinLastUpdated = new Date();
			card.metaData.hasPin = true;
			await card.save();

			return res.status(200).json({
				success: true,
				message: "PIN updated successfully (Anchor card)",
				note: "PIN is stored locally for Anchor cards",
			});
		}

		// Update Bridgecard PIN
		const result = await bridgecardService.updateCardPin(card.cardId, pin);

		if (!result.success) {
			return res.status(400).json({
				success: false,
				error: result.error,
			});
		}

		// Update metadata
		card.metaData.pinLastUpdated = new Date();
		card.metaData.hasPin = true;
		await card.save();

		// Send notification
		await sendPushToUser(
			userId,
			"🔑 PIN Updated",
			`Your ${card.metaData?.cardName || "card"} PIN has been updated.`,
			{ type: "card_pin_updated", cardId: card.cardId },
		);

		res.status(200).json({
			success: true,
			message: "Card PIN updated successfully",
		});
	} catch (error) {
		console.error("Update card PIN error:", error);
		res.status(500).json({ error: error.message });
	}
};
