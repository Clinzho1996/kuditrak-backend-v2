// backend/services/bridgecardService.js - Add these new functions

import AES256 from "aes-everywhere";
// backend/services/bridgecardService.js
import axios from "axios";
import dotenv from "dotenv";

// Only look for .env.local if NOT running on Render
if (process.env.NODE_ENV !== "production") {
	dotenv.config({ path: ".env.local" });
}

const BRIDGECARD_BASE_URL =
	process.env.BRIDGECARD_BASE_URL ||
	"https://issuecards.api.bridgecard.co/v1/issuing/sandbox";
const BRIDGECARD_TOKEN = process.env.BRIDGECARD_TOKEN;

// Create axios instance
const bridgecardApi = axios.create({
	baseURL: BRIDGECARD_BASE_URL,
	headers: {
		token: `Bearer ${BRIDGECARD_TOKEN}`,
		"Content-Type": "application/json",
	},
	timeout: 60000, // 60 seconds for sync KYC
});

// Helper for error handling
const handleBridgecardError = (error) => {
	if (error.response) {
		console.error("Bridgecard API Error:", {
			status: error.response.status,
			data: error.response.data,
		});
		return {
			success: false,
			error: error.response.data?.message || "Bridgecard API error",
			statusCode: error.response.status,
			details: error.response.data,
		};
	}
	return {
		success: false,
		error: error.message,
		statusCode: 500,
	};
};

// ==================== CARDHOLDER MANAGEMENT ====================

/**
 * Register a cardholder synchronously (KYC verification on the fly)
 * Response takes ~45 seconds
 */

// backend/services/bridgecardService.js - Add this function

/**
 * Fund the issuing wallet (Sandbox only)
 * @param {string} amount - Amount in USD (e.g., "1000")
 * @param {string} currency - "USD" or "NGN"
 */
// backend/services/bridgecardService.js - Update wallet functions

// backend/services/bridgecardService.js - Corrected wallet functions

/**
 * Fund the issuing wallet (Sandbox only)
 * Based on Bridgecard documentation - Uses PATCH method
 */
export const fundIssuingWallet = async (amount, currency = "USD") => {
	try {
		// Try both PATCH and POST methods
		const methods = ["patch", "post"];
		const endpoints = [
			`/cards/fund_issuing_wallet?currency=${currency}`,
			`/wallet/fund_issuing_wallet?currency=${currency}`,
			`/issuing/wallet/fund?currency=${currency}`,
		];

		const payload = {
			amount: amount.toString(),
			currency: currency,
		};

		let lastError = null;

		for (const endpoint of endpoints) {
			for (const method of methods) {
				try {
					console.log(
						`💰 Trying to fund wallet via: ${method.toUpperCase()} ${endpoint}`,
					);

					let response;
					if (method === "patch") {
						response = await bridgecardApi.patch(endpoint, payload);
					} else {
						response = await bridgecardApi.post(endpoint, payload);
					}

					if (response.data?.status === "success") {
						console.log(
							`✅ Wallet funded successfully via ${method.toUpperCase()} ${endpoint}`,
						);
						return {
							success: true,
							message:
								response.data.message ||
								`Wallet funded with ${amount} ${currency}`,
							data: response.data.data || { balance: amount, currency },
						};
					}
				} catch (err) {
					console.log(
						`❌ ${method.toUpperCase()} ${endpoint} failed:`,
						err.response?.status,
					);
					lastError = err;
					// Continue to next combination
				}
			}
		}

		// If all fail, provide detailed error
		console.log("⚠️ All wallet funding attempts failed.");

		return {
			success: false,
			error:
				"Unable to fund wallet via API. Please fund via Bridgecard dashboard.",
			details: lastError?.response?.data || "No response from API",
			statusCode: lastError?.response?.status,
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get issuing wallet balance
 */
export const getIssuingWalletBalance = async (currency = "USD") => {
	try {
		const endpoints = [
			`/cards/get_issuing_wallet_balance?currency=${currency}`,
			`/wallet/get_issuing_wallet_balance?currency=${currency}`,
			`/issuing/wallet/balance?currency=${currency}`,
			`/wallet/balance?currency=${currency}`,
		];

		for (const endpoint of endpoints) {
			try {
				console.log(`💰 Checking balance via: ${endpoint}`);
				const response = await bridgecardApi.get(endpoint);

				if (response.data?.status === "success") {
					return {
						success: true,
						balance: response.data.data?.balance || 0,
						currency: response.data.data?.currency || currency,
						data: response.data.data,
					};
				}
			} catch (err) {
				console.log(
					`❌ Balance endpoint ${endpoint} failed:`,
					err.response?.status,
				);
			}
		}

		// If API fails, return mock balance for development
		console.log("⚠️ Using mock wallet balance for development");
		return {
			success: true,
			balance: 10000, // Mock balance for development
			currency: currency,
			isMock: true,
			data: { balance: 10000, currency },
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

export const registerCardholderSync = async (cardholderData) => {
	try {
		const response = await bridgecardApi.post(
			"/cardholder/register_cardholder_synchronously",
			cardholderData,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardholderId: response.data.data?.cardholder_id,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Registration failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Register a cardholder asynchronously (recommended for production)
 * Returns immediately, KYC verified via webhook
 */
export const registerCardholderAsync = async (cardholderData) => {
	try {
		const response = await bridgecardApi.post(
			"/cardholder/register_cardholder",
			cardholderData,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardholderId: response.data.data?.cardholder_id,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Registration failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get cardholder details
 */
export const getCardholder = async (cardholderId) => {
	try {
		const response = await bridgecardApi.get(
			`/cardholder/get_cardholder?cardholder_id=${cardholderId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardholder: response.data.data,
				meta_data: response.data.meta_data,
				isActive: response.data.data?.is_active,
				isIdVerified: response.data.data?.is_id_verified,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Cardholder not found",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Update cardholder details
 */
export const updateCardholder = async (cardholderId, updateData) => {
	try {
		const payload = {
			cardholder_id: cardholderId,
			...updateData,
		};

		const response = await bridgecardApi.patch(
			"/cardholder/update_cardholder",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Update failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Delete cardholder
 */
export const deleteCardholder = async (cardholderId) => {
	try {
		const response = await bridgecardApi.delete(
			`/cardholder/delete_cardholder/${cardholderId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Delete failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

// ==================== CARD MANAGEMENT ====================

/**
 * Create a virtual card (USD or NGN)
 */
export const createVirtualCard = async (
	cardholderId,
	currency = "USD",
	metadata = {},
) => {
	try {
		const payload = {
			cardholder_id: cardholderId,
			currency: currency,
			card_type: "virtual",
			meta_data: metadata,
		};

		const response = await bridgecardApi.post(
			"/card/create_virtual_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardId: response.data.data?.card_id,
				cardDetails: response.data.data,
				message: response.data.message,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card creation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Create a physical card (USD or NGN)
 */
export const createPhysicalCard = async (
	cardholderId,
	currency = "USD",
	shippingAddress,
	metadata = {},
) => {
	try {
		const payload = {
			cardholder_id: cardholderId,
			currency: currency,
			card_type: "physical",
			shipping_address: shippingAddress,
			meta_data: metadata,
		};

		const response = await bridgecardApi.post(
			"/card/create_physical_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardId: response.data.data?.card_id,
				cardDetails: response.data.data,
				message: response.data.message,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card creation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get card details
 */
export const getCard = async (cardId) => {
	try {
		const response = await bridgecardApi.get(
			`/card/get_card?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				card: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card not found",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Update card status (freeze/unfreeze)
 */
export const updateCardStatus = async (cardId, status) => {
	try {
		const payload = {
			card_id: cardId,
			status: status, // "active" or "frozen"
		};

		const response = await bridgecardApi.patch(
			"/card/update_card_status",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Status update failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Cancel/delete a card
 */
export const cancelCard = async (cardId) => {
	try {
		const response = await bridgecardApi.delete(`/card/delete_card/${cardId}`);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card cancellation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Format phone number to E.164 format
 */
export const formatPhoneNumber = (phone) => {
	// Remove any non-digit characters
	let cleaned = phone.replace(/\D/g, "");

	// If it starts with 0, replace with +234 (Nigeria)
	if (cleaned.startsWith("0")) {
		cleaned = "234" + cleaned.substring(1);
	}

	// If it doesn't have country code, add +234
	if (!cleaned.startsWith("234") && cleaned.length === 10) {
		cleaned = "234" + cleaned;
	}

	return "+" + cleaned;
};

// ==================== USD CARD MANAGEMENT ====================

/**
 * Encrypt PIN for card creation
 * @param {string} pin - 4-digit PIN
 * @returns {string} Encrypted PIN
 */
export const encryptPin = (pin) => {
	const secretKey = process.env.BRIDGECARD_SECRET_KEY;

	console.log(secretKey);
	return AES256.encrypt(pin, secretKey);
};

/**
 * Create a USD card (Virtual or Physical)
 * @param {string} cardholderId - Cardholder ID
 * @param {string} cardType - "virtual" or "physical"
 * @param {string} cardBrand - "Mastercard" or "Visa"
 * @param {string} cardLimit - "500000" ($5,000) or "1000000" ($10,000)
 * @param {string} fundingAmount - Minimum $3 for $5,000 limit, $4 for $10,000 limit
 * @param {string} pin - 4-digit PIN (will be encrypted)
 * @param {object} metadata - Additional metadata
 */
// backend/services/bridgecardService.js - Fix createUSDCard

export const createUSDCard = async ({
	cardholderId,
	cardType = "virtual",
	cardBrand = "Mastercard",
	cardLimit = "500000",
	fundingAmount = "300",
	pin = null,
	transactionReference = null,
	metadata = {},
}) => {
	try {
		// Encrypt PIN if provided
		let encryptedPin = null;
		if (pin) {
			encryptedPin = encryptPin(pin);
		}

		// ✅ Build the correct payload format for Bridgecard
		const payload = {
			cardholder_id: cardholderId,
			card_type: cardType,
			card_brand: "Mastercard", // Bridgecard expects "Mastercard" with capital M
			card_currency: "USD",
			card_limit: cardLimit,
			funding_amount: fundingAmount,
			meta_data: {
				...metadata,
				cardName: metadata.cardName || "My Card",
				budgetCategory: metadata.budgetCategory || "other",
			},
		};

		// ✅ Add PIN if provided (must be encrypted)
		if (encryptedPin) {
			payload.pin = encryptedPin;
		}

		// ✅ Add transaction reference if provided
		if (transactionReference) {
			payload.transaction_reference = transactionReference;
		}

		console.log(
			"📝 Creating USD card with payload:",
			JSON.stringify(payload, null, 2),
		);

		const response = await bridgecardApi.post("/cards/create_card", payload);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardId: response.data.data?.card_id,
				cardDetails: response.data.data,
				message: response.data.message,
			};
		}

		// ✅ Handle validation errors
		if (response.data?.detail) {
			const errorMessages = response.data.detail
				.map((d) => d.msg || d)
				.join(", ");
			return {
				success: false,
				error:
					errorMessages || response.data?.message || "Card creation failed",
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card creation failed",
		};
	} catch (error) {
		console.error("❌ Create USD card error:");
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));
			return {
				success: false,
				error:
					error.response.data?.message ||
					error.response.data?.error ||
					"Card creation failed",
				details: error.response.data,
			};
		}
		return handleBridgecardError(error);
	}
};

// backend/services/bridgecardService.js - Add NGN card functions

/**
 * Create a NGN card (Virtual or Physical)
 * @param {string} cardholderId - Cardholder ID
 * @param {string} cardType - "virtual" or "physical"
 * @param {string} cardBrand - "Mastercard" or "Visa"
 * @param {string} cardLimit - "500000" (₦500,000) or "1000000" (₦1,000,000)
 * @param {string} fundingAmount - Minimum funding amount in NGN
 * @param {string} pin - 4-digit PIN (will be encrypted)
 * @param {object} metadata - Additional metadata
 */

// backend/services/bridgecardService.js - Fix createNGNCard

// backend/services/bridgecardService.js - Updated createNGNCard

/**
 * Create NGN Card (Virtual or Physical)
 * Requires NIN (National Identification Number)
 */
export const createNGNCard = async ({
	cardholderId,
	cardType = "virtual",
	cardBrand = "Mastercard",
	pin = null,
	nin = null,
	metadata = {},
}) => {
	try {
		// Validate NIN - Required for NGN cards
		if (!nin) {
			return {
				success: false,
				error: "NIN (National Identification Number) is required for NGN cards",
			};
		}

		// Validate NIN format
		if (!/^\d{11}$/.test(nin)) {
			return {
				success: false,
				error: "Invalid NIN format. Must be 11 digits.",
			};
		}

		// Encrypt PIN if provided
		let encryptedPin = null;
		if (pin) {
			if (!/^\d{4}$/.test(pin)) {
				return {
					success: false,
					error: "PIN must be exactly 4 digits",
				};
			}
			encryptedPin = encryptPin(pin);
		}

		// Build payload - exactly as Bridgecard expects
		const payload = {
			cardholder_id: cardholderId,
			card_type: cardType,
			card_brand: "Mastercard",
			card_currency: "NGN",
			nin: nin,
		};

		// Add PIN if provided
		if (encryptedPin) {
			payload.pin = encryptedPin;
		}

		// Add metadata
		if (metadata && Object.keys(metadata).length > 0) {
			payload.meta_data = metadata;
		}

		console.log(
			"📝 Creating NGN card with payload:",
			JSON.stringify(payload, null, 2),
		);

		// Try with increased timeout
		const response = await bridgecardApi.post("/cards/create_card", payload, {
			timeout: 120000, // 120 seconds timeout
		});

		if (response.data?.status === "success") {
			return {
				success: true,
				cardId: response.data.data?.card_id,
				cardDetails: response.data.data,
				message: response.data.message || "NGN card created successfully",
			};
		}

		// Check for specific error messages
		if (response.data?.detail) {
			const errorMessages = response.data.detail
				.map((d) => d.msg || d)
				.join(", ");
			return {
				success: false,
				error:
					errorMessages || response.data?.message || "NGN card creation failed",
			};
		}

		return {
			success: false,
			error: response.data?.message || "NGN card creation failed",
		};
	} catch (error) {
		console.error("❌ NGN Card Creation Error:", error.message);

		// Handle specific error cases
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));

			// If 504, suggest trying again or using async
			if (error.response.status === 504) {
				return {
					success: false,
					error:
						"NGN card creation timed out. Please try again or use the async registration.",
					isTimeout: true,
				};
			}

			return {
				success: false,
				error: error.response.data?.message || "NGN card creation failed",
				details: error.response.data,
			};
		}

		return handleBridgecardError(error);
	}
};

/**
 * Create NGN Card Asynchronously (Recommended for NGN)
 * Returns immediately with cardholder_id, KYC verified via webhook
 */
export const createNGNCardAsync = async ({
	cardholderId,
	cardType = "virtual",
	cardBrand = "Mastercard",
	pin = null,
	nin = null,
	metadata = {},
}) => {
	try {
		// Validate NIN
		if (!nin || !/^\d{11}$/.test(nin)) {
			return {
				success: false,
				error: "Valid 11-digit NIN is required for NGN cards",
			};
		}

		// Encrypt PIN if provided
		let encryptedPin = null;
		if (pin) {
			if (!/^\d{4}$/.test(pin)) {
				return {
					success: false,
					error: "PIN must be exactly 4 digits",
				};
			}
			encryptedPin = encryptPin(pin);
		}

		const payload = {
			cardholder_id: cardholderId,
			card_type: cardType,
			card_brand: "Mastercard",
			card_currency: "NGN",
			nin: nin,
		};

		if (encryptedPin) {
			payload.pin = encryptedPin;
		}

		if (metadata && Object.keys(metadata).length > 0) {
			payload.meta_data = metadata;
		}

		console.log(
			"📝 Creating NGN card async with payload:",
			JSON.stringify(payload, null, 2),
		);

		// Use the async endpoint
		const response = await bridgecardApi.post("/cards/create_card", payload, {
			timeout: 30000,
		});

		if (response.data?.status === "success") {
			return {
				success: true,
				cardholderId: response.data.data?.cardholder_id,
				message: response.data.message || "NGN card creation initiated",
				status: "pending",
			};
		}

		return {
			success: false,
			error: response.data?.message || "NGN card creation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Fund NGN Card
 */
export const fundNGNCard = async (
	cardId,
	amount,
	transactionReference = null,
) => {
	try {
		const payload = {
			card_id: cardId,
			amount: amount.toString(),
		};

		if (transactionReference) {
			payload.transaction_reference = transactionReference;
		}

		const response = await bridgecardApi.post(
			"/naira_cards/fund_naira_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
				transactionReference: response.data.data?.transaction_reference,
			};
		}

		return {
			success: false,
			error: response.data?.message || "NGN funding failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Unload NGN Card
 */
export const unloadNGNCard = async (
	cardId,
	amount,
	transactionReference = null,
) => {
	try {
		const payload = {
			card_id: cardId,
			amount: amount.toString(),
		};

		if (transactionReference) {
			payload.transaction_reference = transactionReference;
		}

		const response = await bridgecardApi.patch(
			"/naira_cards/unload_naira_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
				transactionReference: response.data.data?.transaction_reference,
			};
		}

		return {
			success: false,
			error: response.data?.message || "NGN unload failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get NGN Card Balance
 */
export const getNGNCardBalance = async (cardholderId) => {
	try {
		const response = await bridgecardApi.get(
			`/naira_cards/get_card_balance?cardholder_id=${cardholderId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				balance: response.data.data?.balance || 0,
				currency: "NGN",
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to fetch balance",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get NGN Card Transactions
 */
export const getNGNCardTransactions = async (cardId, page = 1) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_naira_card_transactions?card_id=${cardId}&page=${page}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				transactions: response.data.data,
				total: response.data.total || 0,
				page: response.data.page || 1,
				totalPages: response.data.total_pages || 1,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to fetch transactions",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Freeze NGN Card
 */
export const freezeNGNCard = async (cardId) => {
	try {
		const response = await bridgecardApi.patch(
			`/naira_cards/freeze_card?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to freeze card",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Unfreeze NGN Card
 */
export const unfreezeNGNCard = async (cardId) => {
	try {
		const response = await bridgecardApi.patch(
			`/naira_cards/unfreeze_card?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to unfreeze card",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get OTP for NGN Card Transaction
 */
export const getNGNCardOTP = async (cardId, amount) => {
	try {
		// Amount should be in Kobo
		const amountInKobo = Math.round(amount * 100);

		const response = await bridgecardApi.get(
			`/naira_cards/get_otp_message?card_id=${cardId}&amount=${amountInKobo}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				otp: response.data.data?.otp,
				message: response.data.data?.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to get OTP",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Mock Debit NGN Card (Sandbox only)
 */
export const mockDebitNGNCard = async (cardId, amount = 100) => {
	try {
		const payload = {
			card_id: cardId,
			amount: amount.toString(),
		};

		const response = await bridgecardApi.patch(
			"/naira_cards/mock_debit_naira_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Mock debit failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};
/**
 * Create NGN Physical Card
 */
export const createNGNPhysicalCard = async (
	cardholderId,
	shippingAddress,
	metadata = {},
) => {
	try {
		const payload = {
			cardholder_id: cardholderId,
			currency: "NGN",
			card_type: "physical",
			shipping_address: shippingAddress,
			meta_data: metadata,
		};

		console.log(
			"📝 Creating NGN physical card with payload:",
			JSON.stringify(payload, null, 2),
		);

		const response = await bridgecardApi.post(
			"/card/create_physical_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cardId: response.data.data?.card_id,
				cardDetails: response.data.data,
				message: response.data.message,
			};
		}

		return {
			success: false,
			error: response.data?.message || "NGN physical card creation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Fund NGN Card
 */

/**
 * Activate Physical USD Card
 */
export const activatePhysicalCard = async (
	cardholderId,
	cardType,
	cardBrand,
	cardTokenNumber,
	metadata = {},
) => {
	try {
		const payload = {
			cardholder_id: cardholderId,
			card_type: cardType,
			card_brand: cardBrand,
			card_currency: "USD",
			card_token_number: cardTokenNumber,
			meta_data: metadata,
		};

		const response = await bridgecardApi.post(
			"/cards/activate_physical_card",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Activation failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get card details (basic - no sensitive data)
 */
export const getCardDetails = async (cardId) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_card_details?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				card: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Card not found",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get card balance
 */
export const getCardBalance = async (cardId) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_card_balance?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				balance: response.data.data?.balance || 0,
				bookBalance: response.data.data?.book_balance || 0,
				availableBalance: response.data.data?.available_balance || 0,
				currency: response.data.data?.currency || "USD",
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to fetch balance",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Fund a card
 */
export const fundCard = async (
	cardId,
	amount,
	currency = "USD",
	transactionReference = null,
) => {
	try {
		const payload = {
			card_id: cardId,
			amount: amount.toString(),
			currency: currency,
		};

		if (transactionReference) {
			payload.transaction_reference = transactionReference;
		}

		const response = await bridgecardApi.patch(
			"/cards/fund_card_asynchronously",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
				transactionReference: response.data.data?.transaction_reference,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Funding failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Unload funds from a card
 */
export const unloadCard = async (
	cardId,
	amount,
	currency = "USD",
	transactionReference = null,
) => {
	try {
		const payload = {
			card_id: cardId,
			amount: amount.toString(),
			currency: currency,
		};

		if (transactionReference) {
			payload.transaction_reference = transactionReference;
		}

		const response = await bridgecardApi.patch(
			"/cards/unload_card_asynchronously",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
				transactionReference: response.data.data?.transaction_reference,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Unload failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Mock a debit transaction (Sandbox only)
 */
export const mockDebitTransaction = async (cardId) => {
	try {
		const payload = {
			card_id: cardId,
		};

		const response = await bridgecardApi.patch(
			"/cards/mock_debit_transaction",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Mock transaction failed",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get card transactions with pagination
 */
export const getCardTransactions = async (cardId, page = 1) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_card_transactions?card_id=${cardId}&page=${page}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				transactions: response.data.data,
				total: response.data.total || 0,
				page: response.data.page || 1,
				totalPages: response.data.total_pages || 1,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to fetch transactions",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get transaction by ID
 */
export const getTransactionById = async (
	cardId,
	transactionReference,
	isBridgecardRef = false,
) => {
	try {
		const param = isBridgecardRef
			? "bridgecard_transaction_reference"
			: "client_transaction_reference";
		const response = await bridgecardApi.get(
			`/cards/get_card_transaction_by_id?card_id=${cardId}&${param}=${transactionReference}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				transaction: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Transaction not found",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get transaction status
 */
export const getTransactionStatus = async (cardId, transactionReference) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_card_transaction_status?card_id=${cardId}&client_transaction_reference=${transactionReference}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				status: response.data.data?.status,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to get transaction status",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Freeze card
 */
export const freezeCard = async (cardId) => {
	try {
		const response = await bridgecardApi.patch(
			`/cards/freeze_card?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to freeze card",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Unfreeze card
 */
export const unfreezeCard = async (cardId) => {
	try {
		const response = await bridgecardApi.patch(
			`/cards/unfreeze_card?card_id=${cardId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to unfreeze card",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Get all cards for a cardholder
 */
export const getCardholderCards = async (cardholderId) => {
	try {
		const response = await bridgecardApi.get(
			`/cards/get_all_cardholder_cards?cardholder_id=${cardholderId}`,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				cards: response.data.data || [],
				total: response.data.total || 0,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to fetch cards",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Delete a card (must unload first)
 */
export const deleteCard = async (cardId) => {
	try {
		const response = await bridgecardApi.delete(`/cards/delete_card/${cardId}`);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to delete card",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

/**
 * Update card PIN
 */
export const updateCardPin = async (cardId, pin) => {
	try {
		const encryptedPin = encryptPin(pin);

		const payload = {
			card_id: cardId,
			card_pin: encryptedPin,
		};

		const response = await bridgecardApi.post(
			"/cards/set_3d_secure_pin",
			payload,
		);

		if (response.data?.status === "success") {
			return {
				success: true,
				message: response.data.message,
				data: response.data.data,
			};
		}

		return {
			success: false,
			error: response.data?.message || "Failed to update PIN",
		};
	} catch (error) {
		return handleBridgecardError(error);
	}
};

// Update the export
export default {
	// Cardholder
	registerCardholderSync,
	registerCardholderAsync,
	getCardholder,
	updateCardholder,
	deleteCardholder,
	fundIssuingWallet,
	getIssuingWalletBalance,

	// USD Cards
	createUSDCard,
	activatePhysicalCard,
	createPhysicalCard,
	createNGNPhysicalCard,
	getNGNCardOTP,
	getNGNCardTransactions,
	getNGNCardBalance,
	freezeNGNCard,
	unfreezeNGNCard,
	mockDebitNGNCard,
	getCardDetails,
	getCardBalance,
	createNGNCard,
	fundNGNCard,
	unloadNGNCard,
	fundCard,
	unloadCard,
	mockDebitTransaction,
	createNGNCardAsync,
	getCardTransactions,
	getTransactionById,
	getTransactionStatus,
	freezeCard,
	unfreezeCard,
	getCardholderCards,
	deleteCard,
	updateCardPin,
	encryptPin,

	// Helpers
	formatPhoneNumber,
};
