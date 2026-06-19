// backend/services/anchorService.js - Complete version

import axios from "axios";
import crypto from "crypto";

const ANCHOR_BASE_URL =
	process.env.ANCHOR_BASE_URL || "https://api.sandbox.getanchor.co/api/v1";
const ANCHOR_API_KEY = process.env.ANCHOR_API_KEY;
const ANCHOR_WEBHOOK_SECRET = process.env.ANCHOR_WEBHOOK_SECRET;

// Helper function to make requests with fresh headers each time
const makeAnchorRequest = async (method, url, data = null) => {
	const headers = {
		"Content-Type": "application/json",
		"x-anchor-key": ANCHOR_API_KEY,
	};

	console.log(`📤 Anchor API Request: ${method.toUpperCase()} ${url}`);
	console.log(
		`   API Key present: ${headers["x-anchor-key"] ? "Yes (length: " + headers["x-anchor-key"].length + ")" : "No"}`,
	);

	try {
		const config = {
			method,
			url: `${ANCHOR_BASE_URL}${url}`,
			headers,
			timeout: 30000,
		};

		if (data && (method === "post" || method === "put" || method === "patch")) {
			config.data = data;
		}

		const response = await axios(config);
		return response;
	} catch (error) {
		console.error(`❌ Anchor API Error (${method.toUpperCase()} ${url}):`);
		if (error.response) {
			console.error(`   Status: ${error.response.status}`);
			console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
		} else if (error.request) {
			console.error(`   No response received`);
		} else {
			console.error(`   Error: ${error.message}`);
		}
		throw error;
	}
};

// Helper for error handling
const handleAnchorError = (error) => {
	if (error.response) {
		return {
			success: false,
			error:
				error.response.data?.message ||
				error.response.data?.error ||
				"Anchor API error",
			statusCode: error.response.status,
			details: error.response.data,
		};
	}
	if (error.request) {
		return {
			success: false,
			error: "No response from Anchor API",
			statusCode: 503,
		};
	}
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
						addressLine_1: address.addressLine_1,
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

		console.log(
			"📝 Creating Anchor customer payload:",
			JSON.stringify(payload, null, 2).substring(0, 500),
		);

		const response = await makeAnchorRequest("post", "/customers", payload);

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
						addressLine_1: address.addressLine_1,
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

		console.log("📝 Creating Anchor customer with KYC");

		const response = await makeAnchorRequest("post", "/customers", payload);

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

		console.log("📝 Upgrade KYC Payload:", JSON.stringify(payload, null, 2));

		const response = await makeAnchorRequest(
			"post",
			`/customers/${customerId}/verification/individual`,
			payload,
		);

		if (response.data?.data) {
			console.log("✅ KYC upgrade initiated successfully");
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
		console.error("❌ Upgrade KYC error details:");
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));
		}
		return handleAnchorError(error);
	}
};

/**
 * Get customer details
 */
export const getAnchorCustomer = async (customerId) => {
	try {
		const response = await makeAnchorRequest("get", `/customers/${customerId}`);

		if (response.data?.data) {
			const attributes = response.data.data.attributes || {};
			const verification = attributes.verification || {};

			console.log("📊 Customer Attributes:", Object.keys(attributes));

			return {
				success: true,
				customer: response.data.data,
				kycLevel: verification.level || attributes.kycLevel || "TIER_0",
				kycStatus: verification.status || attributes.kycStatus || "unverified",
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

/**
 * Update customer details
 */
export const updateCustomer = async (customerId, updateData) => {
	try {
		const payload = {
			data: {
				type: "IndividualCustomer",
				attributes: updateData,
			},
		};

		console.log(
			"📝 Update Customer Payload:",
			JSON.stringify(payload, null, 2),
		);

		const response = await makeAnchorRequest(
			"patch",
			`/customers/${customerId}`,
			payload,
		);

		if (response.data?.data) {
			return {
				success: true,
				customer: response.data.data,
			};
		}

		return {
			success: false,
			error: "Failed to update customer",
		};
	} catch (error) {
		console.error("❌ Update customer error:");
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));
		}
		return handleAnchorError(error);
	}
};

// ==================== DEPOSIT ACCOUNTS (WALLET LEDGER) ====================

/**
 * Create a deposit account (main wallet) for a customer
 * This is the foundation of your wallet system
 */
export const createDepositAccount = async (
	customerId,
	productName = "SAVINGS",
	metadata = {},
) => {
	try {
		const payload = {
			data: {
				type: "DepositAccount",
				attributes: {
					productName: productName,
					metadata: {
						...metadata,
						type: "wallet",
						created_at: new Date().toISOString(),
					},
				},
				relationships: {
					customer: {
						data: {
							id: customerId,
							type: "IndividualCustomer",
						},
					},
				},
			},
		};

		console.log(
			"📝 Creating deposit account (wallet):",
			JSON.stringify(payload, null, 2),
		);

		const response = await makeAnchorRequest(
			"post",
			"/deposit-accounts",
			payload,
		);

		if (response.data?.data) {
			const account = response.data.data;
			console.log(`✅ Deposit account created: ${account.id}`);

			return {
				success: true,
				accountId: account.id,
				account: account,
				status: account.attributes?.status,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		console.error("❌ Create deposit account error:");
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));
		}
		return handleAnchorError(error);
	}
};

/**
 * Get deposit account balance
 */
export const getDepositAccountBalance = async (depositAccountId) => {
	try {
		const response = await makeAnchorRequest(
			"get",
			`/deposit-accounts/${depositAccountId}/balance`,
		);

		if (response.data?.data) {
			const attributes = response.data.data.attributes || {};
			return {
				success: true,
				balance: attributes.balance || 0,
				currency: attributes.currency || "NGN",
			};
		}

		return {
			success: false,
			error: "Failed to fetch balance",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== VIRTUAL NUBAN (VIRTUAL ACCOUNTS) ====================

/**
 * Create a virtual NUBAN for wallet funding via bank transfer
 * This is what you use for wallet top-up accounts
 */
export const createVirtualNuban = async (depositAccountId, metadata = {}) => {
	try {
		const payload = {
			data: {
				type: "VirtualNuban",
				attributes: {
					metadata: {
						...metadata,
						created_at: new Date().toISOString(),
					},
				},
				relationships: {
					depositAccount: {
						data: {
							id: depositAccountId,
							type: "DepositAccount",
						},
					},
				},
			},
		};

		console.log("📝 Creating virtual NUBAN:", JSON.stringify(payload, null, 2));

		const response = await makeAnchorRequest(
			"post",
			"/virtual-nubans",
			payload,
		);

		if (response.data?.data) {
			const nuban = response.data.data;
			const attributes = nuban.attributes || {};

			console.log(`✅ Virtual NUBAN created: ${attributes.accountNumber}`);

			return {
				success: true,
				virtualNubanId: nuban.id,
				accountNumber: attributes.accountNumber,
				bankName: attributes.bankName,
				accountName: attributes.accountName,
				bankCode: attributes.bankCode,
			};
		}

		return {
			success: false,
			error: "Invalid response from Anchor",
		};
	} catch (error) {
		console.error("❌ Create virtual NUBAN error:");
		if (error.response) {
			console.error("Status:", error.response.status);
			console.error("Data:", JSON.stringify(error.response.data, null, 2));
		}
		return handleAnchorError(error);
	}
};

/**
 * Get virtual NUBANs for a deposit account
 */
export const getVirtualNubans = async (depositAccountId) => {
	try {
		const response = await makeAnchorRequest(
			"get",
			`/virtual-nubans?depositAccountId=${depositAccountId}`,
		);

		if (response.data?.data) {
			const nubans = response.data.data.map((nuban) => {
				const attributes = nuban.attributes || {};
				return {
					id: nuban.id,
					accountNumber: attributes.accountNumber,
					bankName: attributes.bankName,
					accountName: attributes.accountName,
					bankCode: attributes.bankCode,
				};
			});

			return {
				success: true,
				nubans,
			};
		}

		return {
			success: false,
			error: "Failed to fetch virtual NUBANs",
		};
	} catch (error) {
		return handleAnchorError(error);
	}
};

// ==================== WEBHOOK ====================

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = (payload, signature, timestamp) => {
	try {
		if (!signature || !timestamp) {
			console.error("Missing signature or timestamp");
			return false;
		}

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

// Export all functions
export default {
	// Customers
	createAnchorCustomer,
	createAnchorCustomerWithKYC,
	upgradeCustomerKYC,
	getAnchorCustomer,
	updateCustomer,

	// Deposit Accounts (Wallets)
	createDepositAccount,
	getDepositAccountBalance,

	// Virtual NUBAN (Top-up accounts)
	createVirtualNuban,
	getVirtualNubans,

	// Webhook
	verifyWebhookSignature,
};
