// backend/services/anchorService.js
import axios from "axios";
import crypto from "crypto";

const ANCHOR_BASE_URL = process.env.ANCHOR_BASE_URL;
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;
const ANCHOR_WEBHOOK_SECRET = process.env.ANCHOR_WEBHOOK_SECRET;

const anchorApi = axios.create({
	baseURL: ANCHOR_BASE_URL,
	headers: {
		"Content-Type": "application/json",
		"x-anchor-key": ANCHOR_API_KEY,
	},
});

// Helper for error handling
const handleAnchorError = (error) => {
	if (error.response) {
		console.error("Anchor API Error:", {
			status: error.response.status,
			data: error.response.data,
			headers: error.response.headers,
		});
		return {
			success: false,
			error: error.response.data?.message || "Anchor API error",
			statusCode: error.response.status,
			details: error.response.data,
		};
	}
	console.error("Anchor API Request Error:", error.message);
	return {
		success: false,
		error: error.message,
		statusCode: 500,
	};
};

// ==================== CUSTOMER MANAGEMENT ====================

/**
 * Create an individual customer in Anchor (Tier 0)
 */
export const createAnchorCustomer = async (userData) => {
	try {
		const {
			firstName,
			lastName,
			middleName,
			maidenName,
			email,
			phoneNumber,
			address,
			metadata,
		} = userData;

		const payload = {
			data: {
				type: "IndividualCustomer",
				attributes: {
					fullName: {
						firstName,
						lastName,
						middleName: middleName || null,
						maidenName: maidenName || null,
					},
					address: {
						addressLine_1: address.street,
						addressLine_2: address.addressLine_2 || null,
						city: address.city,
						state: address.state,
						postalCode: address.postalCode || "000000",
						country: address.country || "NG",
					},
					email,
					phoneNumber,
					metadata: metadata || {},
				},
			},
		};

		const response = await anchorApi.post("/customers", payload);

		if (response.data?.data) {
			return {
				success: true,
				customer: response.data.data,
				customerId: response.data.data.id,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Create customer with KYC Level 2 (BVN, DOB, Gender) - TIER 1
 */
export const createAnchorCustomerWithKYC = async (userData) => {
	try {
		const {
			firstName,
			lastName,
			middleName,
			maidenName,
			email,
			phoneNumber,
			address,
			bvn,
			dateOfBirth,
			gender,
			metadata,
		} = userData;

		const payload = {
			data: {
				type: "IndividualCustomer",
				attributes: {
					fullName: {
						firstName,
						lastName,
						middleName: middleName || null,
						maidenName: maidenName || null,
					},
					address: {
						addressLine_1: address.street,
						addressLine_2: address.addressLine_2 || null,
						city: address.city,
						state: address.state,
						postalCode: address.postalCode || "000000",
						country: address.country || "NG",
					},
					email,
					phoneNumber,
					identificationLevel2: {
						dateOfBirth,
						gender,
						bvn,
					},
					metadata: metadata || {},
				},
			},
		};

		const response = await anchorApi.post("/customers", payload);

		if (response.data?.data) {
			return {
				success: true,
				customer: response.data.data,
				customerId: response.data.data.id,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Upgrade customer KYC from Tier 0 to Tier 1
 */
export const upgradeCustomerKYC = async (
	customerId,
	bvn,
	dateOfBirth,
	gender,
) => {
	try {
		const payload = {
			data: {
				type: "Verification",
				attributes: {
					level: "TIER_1",
					level2: {
						bvn,
						dateOfBirth,
						gender,
					},
				},
			},
		};

		const response = await anchorApi.post(
			`/customers/${customerId}/verification/individual`,
			payload,
		);

		if (response.data?.data) {
			return {
				success: true,
				verification: response.data.data,
				verificationId: response.data.data.id,
				status: response.data.data.attributes?.status || "pending",
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Upgrade customer KYC to Tier 2 (Document verification)
 */
export const upgradeCustomerKYCTier2 = async (
	customerId,
	documentType,
	documentNumber,
	documentImageUrl,
) => {
	try {
		const payload = {
			data: {
				type: "Verification",
				attributes: {
					level: "TIER_2",
					level2: {
						documentType,
						documentNumber,
						documentImageUrl,
					},
				},
			},
		};

		const response = await anchorApi.post(
			`/customers/${customerId}/verification/individual`,
			payload,
		);

		if (response.data?.data) {
			return {
				success: true,
				verification: response.data.data,
				verificationId: response.data.data.id,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get customer details
 */
export const getAnchorCustomer = async (customerId) => {
	try {
		const response = await anchorApi.get(`/customers/${customerId}`);

		if (response.data?.data) {
			return {
				success: true,
				customer: response.data.data,
			};
		}

		return {
			success: false,
			error: "Customer not found",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== WALLET MANAGEMENT ====================

/**
 * Create a wallet for a customer
 */
export const createAnchorWallet = async (
	customerId,
	walletName,
	metadata = {},
) => {
	try {
		const payload = {
			data: {
				type: "Wallet",
				attributes: {
					customerId,
					name: walletName,
					currency: "NGN",
					metadata,
				},
			},
		};

		const response = await anchorApi.post("/wallets", payload);

		if (response.data?.data) {
			return {
				success: true,
				wallet: response.data.data,
				walletId: response.data.data.id,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get wallet balance
 */
export const getWalletBalance = async (walletId) => {
	try {
		const response = await anchorApi.get(`/wallets/${walletId}/balance`);

		if (response.data?.data) {
			return {
				success: true,
				balance: response.data.data.attributes?.balance || 0,
				currency: response.data.data.attributes?.currency || "NGN",
			};
		}

		return {
			success: false,
			error: "Unable to fetch balance",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get wallet transactions
 */
export const getWalletTransactions = async (
	walletId,
	limit = 50,
	offset = 0,
) => {
	try {
		const response = await anchorApi.get(
			`/wallets/${walletId}/transactions?limit=${limit}&offset=${offset}`,
		);

		if (response.data?.data) {
			return {
				success: true,
				transactions: response.data.data,
			};
		}

		return {
			success: false,
			error: "Unable to fetch transactions",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== VIRTUAL ACCOUNTS ====================

/**
 * Create a virtual account for a customer
 */
export const createVirtualAccount = async (
	customerId,
	walletId,
	metadata = {},
) => {
	try {
		const payload = {
			data: {
				type: "VirtualAccount",
				attributes: {
					customerId,
					walletId,
					currency: "NGN",
					metadata,
				},
			},
		};

		const response = await anchorApi.post("/virtual-accounts", payload);

		if (response.data?.data) {
			const attributes = response.data.data.attributes;
			return {
				success: true,
				virtualAccount: response.data.data,
				accountNumber: attributes?.accountNumber,
				bankName: attributes?.bankName,
				bankCode: attributes?.bankCode,
				accountName: attributes?.accountName,
				reference: response.data.data.id,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get virtual account details
 */
export const getVirtualAccount = async (virtualAccountId) => {
	try {
		const response = await anchorApi.get(
			`/virtual-accounts/${virtualAccountId}`,
		);

		if (response.data?.data) {
			return {
				success: true,
				virtualAccount: response.data.data,
			};
		}

		return {
			success: false,
			error: "Virtual account not found",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== CARD MANAGEMENT ====================

/**
 * Create a virtual card for a customer
 */
export const createVirtualCard = async (
	customerId,
	walletId,
	cardholderName,
	cardDesign = "default",
	limits = {},
	metadata = {},
) => {
	try {
		const payload = {
			data: {
				type: "Card",
				attributes: {
					customerId,
					walletId,
					cardType: "virtual",
					cardholderName,
					cardDesign,
					limits: {
						transactionLimit: limits.transactionLimit || null,
						dailyLimit: limits.dailyLimit || null,
						monthlyLimit: limits.monthlyLimit || null,
					},
					metadata,
				},
			},
		};

		const response = await anchorApi.post("/cards", payload);

		if (response.data?.data) {
			const attributes = response.data.data.attributes;
			return {
				success: true,
				card: response.data.data,
				cardId: response.data.data.id,
				last4: attributes?.last4,
				expiryMonth: attributes?.expiryMonth,
				expiryYear: attributes?.expiryYear,
				cardBrand: attributes?.cardBrand,
				// PAN is returned only once, store securely
				pan: attributes?.pan,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get card details
 */
export const getCardDetails = async (cardId) => {
	try {
		const response = await anchorApi.get(`/cards/${cardId}`);

		if (response.data?.data) {
			return {
				success: true,
				card: response.data.data,
			};
		}

		return {
			success: false,
			error: "Card not found",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Freeze/unfreeze card
 */
export const updateCardStatus = async (cardId, status) => {
	try {
		const payload = {
			data: {
				type: "Card",
				attributes: {
					status,
				},
			},
		};

		const response = await anchorApi.patch(`/cards/${cardId}`, payload);

		if (response.data?.data) {
			return {
				success: true,
				card: response.data.data,
				status: response.data.data.attributes?.status,
			};
		}

		return {
			success: false,
			error: "Unable to update card status",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Cancel/delete card
 */
export const cancelCard = async (cardId) => {
	try {
		const response = await anchorApi.delete(`/cards/${cardId}`);

		if (response.status === 204) {
			return {
				success: true,
				message: "Card cancelled successfully",
			};
		}

		return {
			success: false,
			error: "Unable to cancel card",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get card transactions
 */
export const getCardTransactions = async (cardId, limit = 50, offset = 0) => {
	try {
		const response = await anchorApi.get(
			`/cards/${cardId}/transactions?limit=${limit}&offset=${offset}`,
		);

		if (response.data?.data) {
			return {
				success: true,
				transactions: response.data.data,
			};
		}

		return {
			success: false,
			error: "Unable to fetch transactions",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== TRANSFERS ====================

/**
 * Transfer from wallet to bank account
 */
export const transferToBank = async (
	walletId,
	amount,
	recipientBankCode,
	recipientAccountNumber,
	recipientAccountName,
	narration = "",
) => {
	try {
		const payload = {
			data: {
				type: "Transfer",
				attributes: {
					walletId,
					amount,
					currency: "NGN",
					destination: {
						type: "bank_account",
						bankCode: recipientBankCode,
						accountNumber: recipientAccountNumber,
						accountName: recipientAccountName,
					},
					narration,
				},
			},
		};

		const response = await anchorApi.post("/transfers", payload);

		if (response.data?.data) {
			return {
				success: true,
				transfer: response.data.data,
				transferId: response.data.data.id,
				status: response.data.data.attributes?.status,
				reference: response.data.data.attributes?.reference,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Transfer between wallets
 */
export const transferToWallet = async (
	sourceWalletId,
	destinationWalletId,
	amount,
	narration = "",
) => {
	try {
		const payload = {
			data: {
				type: "Transfer",
				attributes: {
					sourceWalletId,
					destinationWalletId,
					amount,
					currency: "NGN",
					narration,
				},
			},
		};

		const response = await anchorApi.post("/transfers", payload);

		if (response.data?.data) {
			return {
				success: true,
				transfer: response.data.data,
				transferId: response.data.data.id,
				status: response.data.data.attributes?.status,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

/**
 * Get transfer status
 */
export const getTransferStatus = async (transferId) => {
	try {
		const response = await anchorApi.get(`/transfers/${transferId}`);

		if (response.data?.data) {
			return {
				success: true,
				transfer: response.data.data,
				status: response.data.data.attributes?.status,
			};
		}

		return {
			success: false,
			error: "Transfer not found",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== WEBHOOK VERIFICATION ====================

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = (payload, signature, timestamp) => {
	try {
		const message = `${timestamp}.${JSON.stringify(payload)}`;
		const expectedSignature = crypto
			.createHmac("sha256", ANCHOR_WEBHOOK_SECRET)
			.update(message)
			.digest("hex");

		return signature === expectedSignature;
	} catch (error) {
		console.error("Webhook verification error:", error);
		return false;
	}
};

export default {
	// Customer
	createAnchorCustomer,
	createAnchorCustomerWithKYC,
	upgradeCustomerKYC,
	upgradeCustomerKYCTier2,
	getAnchorCustomer,

	// Wallet
	createAnchorWallet,
	getWalletBalance,
	getWalletTransactions,

	// Virtual Account
	createVirtualAccount,
	getVirtualAccount,

	// Card
	createVirtualCard,
	getCardDetails,
	updateCardStatus,
	cancelCard,
	getCardTransactions,

	// Transfer
	transferToBank,
	transferToWallet,
	getTransferStatus,

	// Webhook
	verifyWebhookSignature,
};
