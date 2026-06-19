// backend/services/cardCreationService.js - Complete Integration

import { initializeDefaultCategories } from "../controllers/categoryController.js";
import AnchorWallet from "../models/AnchorWallet.js";
import BridgecardCard from "../models/BridgecardCard.js";
import BridgecardCardholder from "../models/BridgecardCardholder.js";
import Budget from "../models/Budget.js";
import CardRequest from "../models/CardRequest.js";
import Category from "../models/Category.js";
import User from "../models/User.js";
import anchorService from "./anchorService.js";
import bridgecardService from "./bridgecardService.js";
import { sendPushToUser } from "./pushService.js";

export const createCardRequest = async (userId, cardData) => {
	try {
		// Ensure user has default categories
		await initializeDefaultCategories(userId);

		// ✅ Normalize budgetCategory to lowercase
		const normalizedCategory =
			cardData.budgetCategory?.toLowerCase() || "other";

		// Find or create the category for this budget
		let category = await Category.findOne({
			userId,
			name: { $regex: new RegExp(`^${normalizedCategory}$`, "i") },
		});

		// If category doesn't exist, create it
		if (!category) {
			// Map UI category names to our category system
			const categoryMap = {
				food: { name: "Food & Drinks", type: "expense" },
				transport: { name: "Transport", type: "expense" },
				entertain: { name: "Entertainment", type: "expense" },
				shopping: { name: "Shopping", type: "expense" },
				utilities: { name: "Bills & Utilities", type: "expense" },
				health: { name: "Healthcare", type: "expense" },
				education: { name: "Education", type: "expense" },
				other: { name: "Miscellaneous", type: "expense" },
			};

			const categoryInfo =
				categoryMap[normalizedCategory] || categoryMap["other"];

			category = await Category.create({
				userId,
				name: categoryInfo.name,
				type: categoryInfo.type,
				keywords: [normalizedCategory],
			});
		}

		// Find or create budget for this category
		let budget = await Budget.findOne({
			userId,
			name: { $regex: new RegExp(`^${cardData.cardName}$`, "i") },
		});

		if (!budget) {
			budget = await Budget.create({
				userId,
				name: cardData.cardName,
				amount: cardData.spendingLimit || 0,
				spent: 0,
				frequency: "Monthly",
				startDate: new Date(),
				endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
			});

			await User.findByIdAndUpdate(userId, {
				$push: { budgets: budget._id },
			});
		}

		// ✅ Create the card request with normalized budgetCategory
		const cardRequest = await CardRequest.create({
			userId,
			categoryId: category._id,
			budgetId: budget._id,
			cardDetails: {
				cardType: cardData.cardType || "virtual",
				color: cardData.color || "green",
				cardName: cardData.cardName,
				currency: cardData.currency || "USD",
				budgetCategory: normalizedCategory, // ✅ Use normalized lowercase value
				spendingLimit: cardData.spendingLimit || 0,
			},
			spendingControls: {
				totalLimit: cardData.spendingLimit || 0,
				alertThreshold: cardData.alertThreshold || 75,
				dailySpendingLimitEnabled: cardData.dailySpendingLimitEnabled || false,
				dailyMaximum: cardData.dailyMaximum || 0,
			},
			notifications: {
				transactionAlerts: cardData.transactionAlerts !== false,
				limitWarnings: cardData.limitWarnings !== false,
				autoRefillAlerts: cardData.autoRefillAlerts || false,
			},
			status: "pending",
		});

		// Update budget with card reference
		budget.cardId = cardRequest._id;
		await budget.save();

		return {
			success: true,
			requestId: cardRequest._id,
			cardRequest,
			category,
			budget,
		};
	} catch (error) {
		console.error("Create card request error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Process card creation (Step 2 & 3 combined)
 */
export const processCardCreation = async (requestId) => {
	try {
		const cardRequest = await CardRequest.findById(requestId);
		if (!cardRequest) {
			return { success: false, error: "Card request not found" };
		}

		if (cardRequest.status !== "pending") {
			return {
				success: false,
				error: `Card request already ${cardRequest.status}`,
			};
		}

		cardRequest.status = "processing";
		await cardRequest.save();

		const userId = cardRequest.userId;
		const { cardType, currency, cardName, budgetCategory, spendingLimit } =
			cardRequest.cardDetails;

		let result;

		// Route to appropriate provider based on currency
		if (currency === "USD") {
			result = await createBridgecardCard(userId, cardRequest);
		} else if (currency === "NGN") {
			result = await createAnchorCard(userId, cardRequest);
		} else {
			throw new Error("Unsupported currency");
		}

		if (!result.success) {
			cardRequest.status = "failed";
			cardRequest.metadata = { ...cardRequest.metadata, error: result.error };
			await cardRequest.save();
			return result;
		}

		// Update card request
		cardRequest.status = "completed";
		cardRequest.bridgecardCardId = result.cardId;
		cardRequest.metadata = {
			...cardRequest.metadata,
			provider: result.provider,
			cardCreatedAt: new Date(),
		};
		await cardRequest.save();

		// Update budget with spending limit and card reference
		if (cardRequest.budgetId) {
			await Budget.findByIdAndUpdate(cardRequest.budgetId, {
				amount: spendingLimit,
				cardId: result.cardId,
				cardRequestId: requestId,
				isActive: true,
			});
		}

		// Send notification
		await sendPushToUser(
			userId,
			`💳 ${currency} ${cardType.charAt(0).toUpperCase() + cardType.slice(1)} Card Ready!`,
			`Your "${cardName}" card for ${budgetCategory} has been created successfully.`,
			{
				type: "card_created",
				cardId: result.cardId,
				cardName: cardName,
				currency: currency,
				category: budgetCategory,
			},
		);

		return {
			success: true,
			cardId: result.cardId,
			provider: result.provider,
			cardRequest,
			card: result.card,
		};
	} catch (error) {
		console.error("Process card creation error:", error);
		return { success: false, error: error.message };
	}
};

// backend/services/cardCreationService.js - Complete createBridgecardCard

/**
 * Create Bridgecard USD Card with category & budget links
 */
const createBridgecardCard = async (userId, cardRequest) => {
	try {
		console.log("🔵 createBridgecardCard called for user:", userId);
		console.log("📊 Card Request:", {
			cardName: cardRequest.cardDetails?.cardName,
			cardType: cardRequest.cardDetails?.cardType,
			currency: cardRequest.cardDetails?.currency,
			spendingLimit: cardRequest.cardDetails?.spendingLimit,
			budgetCategory: cardRequest.cardDetails?.budgetCategory,
		});

		// Get user details
		const user = await User.findById(userId);
		if (!user) {
			console.error("❌ User not found:", userId);
			return { success: false, error: "User not found" };
		}

		// Get or create cardholder
		let cardholder = await BridgecardCardholder.findOne({ userId });
		console.log(
			"📊 Existing cardholder:",
			cardholder ? cardholder.cardholderId : "None",
		);

		if (!cardholder) {
			console.log("🔄 No cardholder found, registering...");

			// Format phone number correctly (E.164 format)
			const phoneNumber = bridgecardService.formatPhoneNumber(
				user.phoneNumber || "08000000000",
			);
			console.log("📊 Phone number:", phoneNumber);

			// Format address correctly
			const address = {
				address: user.kyc?.address?.street || "9 Jibowu Street",
				city: user.kyc?.address?.city || "Aba North",
				state: user.kyc?.address?.state || "Abia",
				country: "Nigeria",
				postal_code: user.kyc?.address?.postalCode || "1000242",
				house_no: "13",
			};
			console.log("📊 Address:", address);

			// Format BVN for Bridgecard (needs 12 digits)
			let bvnForBridgecard = "222222222222"; // Default test BVN
			if (user.kyc?.bvn) {
				// Bridgecard expects 12 digits, pad with leading zeros if needed
				bvnForBridgecard = user.kyc.bvn.padStart(12, "0");
				// If still not 12 digits, use the last 12 characters
				if (bvnForBridgecard.length > 12) {
					bvnForBridgecard = bvnForBridgecard.slice(-12);
				}
			}
			console.log("📊 BVN for Bridgecard:", bvnForBridgecard);

			// ✅ CORRECT identity object format for Bridgecard
			// Option 1: Use BVN verification (most common)
			const identity = {
				id_type: "NIGERIAN_BVN_VERIFICATION",
				bvn: bvnForBridgecard,
				selfie_image: user.profileImage || "https://example.com/selfie.jpg",
			};

			// Option 2: If user has NIN, use that instead (more reliable)
			if (
				user.kyc?.identification?.number &&
				user.kyc.identification.type === "nin"
			) {
				console.log("📊 Using NIN instead of BVN");
				identity.id_type = "NIGERIAN_NIN";
				identity.id_no = user.kyc.identification.number;
				identity.id_image =
					user.kyc.identification.imageUrl || "https://example.com/id.jpg";
				identity.bvn = bvnForBridgecard; // Still include BVN for verification
			}

			console.log("📊 Identity object:", JSON.stringify(identity, null, 2));

			// Split full name
			const nameParts = user.fullName.trim().split(/\s+/);
			const firstName = nameParts[0] || "John";
			const lastName = nameParts.slice(1).join(" ") || "Doe";

			// ✅ CORRECT payload for Bridgecard cardholder registration
			const cardholderData = {
				first_name: firstName,
				last_name: lastName,
				address: address,
				phone: phoneNumber,
				email_address: user.email,
				identity: identity,
				meta_data: {
					userId: user._id.toString(),
					platform: "kuditrak",
					registrationType: "card_creation",
				},
			};

			console.log(
				"📊 Full cardholder data:",
				JSON.stringify(cardholderData, null, 2),
			);

			// Try synchronous registration first
			let registerResult =
				await bridgecardService.registerCardholderSync(cardholderData);

			// If sync fails with 422, try async
			if (!registerResult.success && registerResult.statusCode === 422) {
				console.log("🔄 Sync registration failed, trying async...");
				registerResult =
					await bridgecardService.registerCardholderAsync(cardholderData);
			}

			console.log("📊 Register result:", registerResult);

			if (!registerResult.success) {
				console.error(
					"❌ Failed to register cardholder:",
					registerResult.error,
				);
				console.error("❌ Details:", registerResult.details);

				// Check if it's a verification issue
				if (registerResult.statusCode === 422) {
					return {
						success: false,
						error:
							"Cardholder registration failed. Please ensure KYC information is correct.",
						details: registerResult.details,
						requiresManualVerification: true,
					};
				}

				return {
					success: false,
					error: "Failed to register cardholder: " + registerResult.error,
					details: registerResult.details,
				};
			}

			console.log("✅ Cardholder registered:", registerResult.cardholderId);

			// Save cardholder to database
			cardholder = await BridgecardCardholder.create({
				userId: user._id,
				cardholderId: registerResult.cardholderId,
				isActive: false,
				isIdVerified: false,
				bridgecardData: registerResult.data || {},
				metaData: {
					registeredAt: new Date(),
					registrationMethod: "card_creation",
				},
			});

			console.log("✅ Cardholder saved to database:", cardholder.cardholderId);
		}

		if (!cardholder) {
			console.error("❌ Cardholder still not found after registration");
			return {
				success: false,
				error: "Cardholder not found after registration",
			};
		}

		// ✅ Refresh cardholder status from Bridgecard
		console.log("🔄 Refreshing cardholder status...");
		const cardholderStatus = await bridgecardService.getCardholder(
			cardholder.cardholderId,
		);

		if (cardholderStatus.success) {
			console.log("📊 Cardholder Status from Bridgecard:", {
				cardholderId: cardholder.cardholderId,
				isActive: cardholderStatus.isActive,
				isIdVerified: cardholderStatus.isIdVerified,
				cardholder: cardholderStatus.cardholder,
			});

			// Update local status
			cardholder.isActive = cardholderStatus.isActive || false;
			cardholder.isIdVerified = cardholderStatus.isIdVerified || false;
			cardholder.bridgecardData = cardholderStatus.cardholder || {};
			await cardholder.save();
		}

		// Check if cardholder is verified
		if (!cardholder.isActive || !cardholder.isIdVerified) {
			console.error("❌ Cardholder not verified");
			return {
				success: false,
				error:
					"Cardholder not verified. Please complete KYC verification on Bridgecard dashboard.",
				status: {
					isActive: cardholder.isActive,
					isIdVerified: cardholder.isIdVerified,
				},
				requiresKYC: true,
				dashboardUrl: "https://issuecards.api.bridgecard.co/dashboard",
			};
		}

		// Get category and budget info
		const category = cardRequest.categoryId
			? await Category.findById(cardRequest.categoryId)
			: null;
		const budget = cardRequest.budgetId
			? await Budget.findById(cardRequest.budgetId)
			: null;

		console.log("📊 Category:", category?.name || "None");
		console.log("📊 Budget:", budget?.name || "None");

		// ✅ Create the card with proper payload
		const cardData = {
			cardholderId: cardholder.cardholderId,
			cardType: cardRequest.cardDetails.cardType || "virtual",
			cardBrand: "Mastercard",
			cardLimit: "500000", // $5,000 limit
			fundingAmount: "300", // Minimum $3 for $5K limit
			metadata: {
				userId: userId.toString(),
				cardName: cardRequest.cardDetails.cardName || "My Card",
				budgetCategory: cardRequest.cardDetails.budgetCategory || "other",
				spendingLimit: cardRequest.cardDetails.spendingLimit || 0,
				cardRequestId: cardRequest._id.toString(),
				categoryId: cardRequest.categoryId?.toString() || null,
				budgetId: cardRequest.budgetId?.toString() || null,
				color: cardRequest.cardDetails.color || "green",
				dailyLimit: cardRequest.spendingControls?.dailyMaximum || 0,
				alertThreshold: cardRequest.spendingControls?.alertThreshold || 75,
			},
		};

		console.log(
			"📤 Creating USD card with data:",
			JSON.stringify(cardData, null, 2),
		);

		const result = await bridgecardService.createUSDCard(cardData);

		console.log("📊 Bridgecard create card result:", result);

		if (!result.success) {
			console.error("❌ Bridgecard card creation failed:", result.error);
			console.error("❌ Details:", result.details);

			// If it's a funding issue, try with a different funding amount
			if (
				result.error?.includes("funding") ||
				result.error?.includes("balance")
			) {
				console.log("🔄 Retrying with higher funding amount...");
				cardData.fundingAmount = "500"; // Increase funding amount
				const retryResult = await bridgecardService.createUSDCard(cardData);
				if (retryResult.success) {
					return await saveCardToDatabase(
						userId,
						cardholder,
						retryResult,
						cardRequest,
					);
				}
			}

			return { success: false, error: result.error, details: result.details };
		}

		// Save card to database
		return await saveCardToDatabase(userId, cardholder, result, cardRequest);
	} catch (error) {
		console.error("❌ Create Bridgecard card error:", error);
		console.error("❌ Error stack:", error.stack);
		return { success: false, error: error.message };
	}
};

/**
 * Helper function to save card to database
 */
const saveCardToDatabase = async (userId, cardholder, result, cardRequest) => {
	try {
		// Get card details for last4 and expiry
		const cardDetails = await bridgecardService.getCardDetails(result.cardId);
		let last4 = "0000";
		let expiryMonth = "12";
		let expiryYear = "28";

		if (cardDetails.success && cardDetails.card) {
			last4 = cardDetails.card.last4 || "0000";
			expiryMonth = cardDetails.card.expiry_month || "12";
			expiryYear = cardDetails.card.expiry_year || "28";
		}

		// Save card to database with all links
		const newCard = await BridgecardCard.create({
			userId,
			cardholderId: cardholder.cardholderId,
			cardId: result.cardId,
			currency: "USD",
			cardType: cardRequest.cardDetails.cardType || "virtual",
			cardBrand: "mastercard",
			last4,
			expiryMonth,
			expiryYear,
			cardholderName: cardRequest.cardDetails.cardName || "My Card",
			status: "active",
			metaData: {
				cardName: cardRequest.cardDetails.cardName,
				budgetCategory: cardRequest.cardDetails.budgetCategory,
				spendingLimit: cardRequest.cardDetails.spendingLimit,
				color: cardRequest.cardDetails.color,
				categoryId: cardRequest.categoryId,
				budgetId: cardRequest.budgetId,
				dailyMaximum: cardRequest.spendingControls?.dailyMaximum || 0,
				alertThreshold: cardRequest.spendingControls?.alertThreshold || 75,
				transactionAlerts:
					cardRequest.notifications?.transactionAlerts !== false,
				limitWarnings: cardRequest.notifications?.limitWarnings !== false,
				autoRefillAlerts: cardRequest.notifications?.autoRefillAlerts || false,
				bridgecardData: result.cardDetails || {},
			},
			isBridgecardCard: true,
		});

		console.log("✅ Card saved to database:", newCard.cardId);

		return {
			success: true,
			cardId: result.cardId,
			provider: "bridgecard",
			card: newCard,
			details: result.cardDetails,
		};
	} catch (error) {
		console.error("❌ Failed to save card to database:", error);
		return {
			success: false,
			error: "Card created but failed to save: " + error.message,
		};
	}
};

/**
 * Create Anchor NGN Virtual Account (acts as NGN "card")
 */
const createAnchorCard = async (userId, cardRequest) => {
	try {
		// Get or create Anchor customer
		const anchorResult = await anchorService.getOrCreateAnchorCustomer(userId);
		if (!anchorResult.success) {
			return { success: false, error: "Failed to create Anchor customer" };
		}

		// Get main wallet
		let wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			const walletResponse = await anchorService.createAnchorWallet(
				anchorResult.customerId,
				"Main Wallet",
				{ userId: userId.toString() },
			);
			if (walletResponse.success) {
				wallet = await AnchorWallet.create({
					userId,
					anchorCustomerId: anchorResult.customerId,
					walletId: walletResponse.walletId,
					walletType: "main",
					balance: 0,
					name: "Main Wallet",
				});
			}
		}

		// Create virtual account (NGN)
		const accountResult = await anchorService.createVirtualAccount(
			anchorResult.customerId,
			wallet?.walletId,
			{
				userId: userId.toString(),
				cardName: cardRequest.cardDetails.cardName,
				budgetCategory: cardRequest.cardDetails.budgetCategory,
				categoryId: cardRequest.categoryId,
				budgetId: cardRequest.budgetId,
				type: "card",
			},
		);

		if (!accountResult.success) {
			return { success: false, error: "Failed to create virtual account" };
		}

		// Save as card in our system
		const newCard = await BridgecardCard.create({
			userId,
			anchorCustomerId: anchorResult.customerId,
			walletId: wallet?._id,
			cardId: accountResult.accountNumber || `anchor_${Date.now()}`,
			currency: "NGN",
			cardType: "virtual",
			cardBrand: "anchor",
			last4: accountResult.accountNumber?.slice(-4) || "0000",
			expiryMonth: "12",
			expiryYear: "28",
			cardholderName: cardRequest.cardDetails.cardName,
			status: "active",
			metaData: {
				cardName: cardRequest.cardDetails.cardName,
				budgetCategory: cardRequest.cardDetails.budgetCategory,
				spendingLimit: cardRequest.cardDetails.spendingLimit,
				color: cardRequest.cardDetails.color,
				categoryId: cardRequest.categoryId,
				budgetId: cardRequest.budgetId,
				accountNumber: accountResult.accountNumber,
				bankName: accountResult.bankName,
				dailyMaximum: cardRequest.spendingControls.dailyMaximum || 0,
				alertThreshold: cardRequest.spendingControls.alertThreshold || 75,
				transactionAlerts: cardRequest.notifications.transactionAlerts,
				limitWarnings: cardRequest.notifications.limitWarnings,
				autoRefillAlerts: cardRequest.notifications.autoRefillAlerts,
				isAnchorCard: true,
			},
			isBridgecardCard: false,
			isAnchorCard: true,
		});

		return {
			success: true,
			cardId: accountResult.accountNumber,
			provider: "anchor",
			card: newCard,
		};
	} catch (error) {
		console.error("Create Anchor card error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Get user's cards with full budget and category details
 */
export const getUserCardsWithDetails = async (userId) => {
	try {
		const cards = await BridgecardCard.find({ userId })
			.sort({ createdAt: -1 })
			.lean();

		// Enhance with category and budget details
		const enhancedCards = await Promise.all(
			cards.map(async (card) => {
				let category = null;
				let budget = null;

				if (card.metaData?.categoryId) {
					category = await Category.findById(card.metaData.categoryId).select(
						"name type",
					);
				}

				if (card.metaData?.budgetId) {
					budget = await Budget.findById(card.metaData.budgetId).select(
						"name amount spent frequency",
					);
				}

				return {
					...card,
					maskedPan: `**** **** **** ${card.last4}`,
					provider: card.isAnchorCard ? "anchor" : "bridgecard",
					displayName:
						card.metaData?.cardName || card.cardholderName || "My Card",
					color: card.metaData?.color || "green",
					budgetCategory: card.metaData?.budgetCategory || "other",
					spendingLimit: card.metaData?.spendingLimit || 0,
					dailyLimit: card.metaData?.dailyMaximum || 0,
					notifications: {
						transactionAlerts: card.metaData?.transactionAlerts !== false,
						limitWarnings: card.metaData?.limitWarnings !== false,
						autoRefillAlerts: card.metaData?.autoRefillAlerts || false,
					},
					category: category
						? {
								id: category._id,
								name: category.name,
								type: category.type,
							}
						: null,
					budget: budget
						? {
								id: budget._id,
								name: budget.name,
								amount: budget.amount,
								spent: budget.spent,
								remaining: budget.amount - budget.spent,
								frequency: budget.frequency,
							}
						: null,
				};
			}),
		);

		return {
			success: true,
			cards: enhancedCards,
		};
	} catch (error) {
		console.error("Get user cards with details error:", error);
		return { success: false, error: error.message };
	}
};

/**
 * Track card spending and update budget
 */
export const trackCardSpending = async (userId, cardId, amount, category) => {
	try {
		// Find the card
		const card = await BridgecardCard.findOne({ userId, cardId });
		if (!card) {
			return { success: false, error: "Card not found" };
		}

		// Get the budget
		const budgetId = card.metaData?.budgetId;
		if (!budgetId) {
			return { success: false, error: "No budget linked to this card" };
		}

		// Update budget spent amount
		const budget = await Budget.findByIdAndUpdate(
			budgetId,
			{ $inc: { spent: amount } },
			{ new: true },
		);

		if (!budget) {
			return { success: false, error: "Budget not found" };
		}

		// Check if spending limit exceeded
		const isOverLimit = budget.spent > budget.amount;
		const percentageUsed = (budget.spent / budget.amount) * 100;

		// Send alert if over limit
		if (isOverLimit) {
			await sendPushToUser(
				userId,
				"⚠️ Budget Alert: Spending Limit Exceeded",
				`Your "${card.metaData?.cardName}" card has exceeded its budget of ${budget.amount}.`,
				{ type: "budget_exceeded", cardId, budgetId, amount: budget.spent },
			);
		}

		// Send alert if approaching limit (80%)
		if (percentageUsed >= 80 && percentageUsed < 100) {
			await sendPushToUser(
				userId,
				"⚠️ Budget Alert: Approaching Limit",
				`You've used ${Math.round(percentageUsed)}% of your budget for "${card.metaData?.cardName}".`,
				{
					type: "budget_warning",
					cardId,
					budgetId,
					percentage: Math.round(percentageUsed),
				},
			);
		}

		return {
			success: true,
			budget,
			isOverLimit,
			percentageUsed,
		};
	} catch (error) {
		console.error("Track card spending error:", error);
		return { success: false, error: error.message };
	}
};

export const getCardStatus = async (userId, requestId) => {
	try {
		const cardRequest = await CardRequest.findOne({
			userId,
			_id: requestId,
		});

		if (!cardRequest) {
			return {
				success: false,
				error: "Card request not found",
			};
		}

		// Get additional details if completed
		let card = null;
		let budget = null;
		let category = null;

		if (cardRequest.status === "completed") {
			if (cardRequest.bridgecardCardId) {
				card = await BridgecardCard.findOne({
					userId,
					cardId: cardRequest.bridgecardCardId,
				});
			}
			if (cardRequest.budgetId) {
				budget = await Budget.findById(cardRequest.budgetId);
			}
			if (cardRequest.categoryId) {
				category = await Category.findById(cardRequest.categoryId);
			}
		}

		// ✅ Format the response with proper category name
		return {
			success: true,
			status: cardRequest.status,
			cardRequest: {
				...cardRequest.toObject(),
				card,
				budget,
				category: category
					? {
							id: category._id,
							name: category.name,
							type: category.type,
						}
					: null,
				// ✅ Add display category name
				displayCategory:
					category?.name || cardRequest.cardDetails.budgetCategory || "Other",
			},
		};
	} catch (error) {
		console.error("Get card status error:", error);
		return { success: false, error: error.message };
	}
};
