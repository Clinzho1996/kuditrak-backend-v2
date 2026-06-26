// backend/services/anchorService.js - Fixed with correct endpoints

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
 * ✅ FIXED: Use the correct verification endpoint
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
 * Get all deposit accounts for a customer
 */
export const getDepositAccounts = async (customerId) => {
	try {
		console.log(`🔍 Fetching deposit accounts for customer: ${customerId}`);

		const response = await makeAnchorRequest(
			"get",
			`/deposit-accounts?customerId=${customerId}`,
		);

		console.log("📥 Get deposit accounts response:", response.data);

		if (response.data?.data) {
			const accounts = response.data.data.map((account) => {
				const attributes = account.attributes || {};
				return {
					id: account.id,
					accountId: account.id,
					productName: attributes.productName,
					status: attributes.status,
					balance: attributes.balance || 0,
					currency: attributes.currency || "NGN",
					createdAt: attributes.createdAt,
					updatedAt: attributes.updatedAt,
				};
			});

			return {
				success: true,
				accounts: accounts,
				total: response.data.meta?.total || accounts.length,
			};
		}

		return {
			success: false,
			error: "Failed to fetch accounts",
		};
	} catch (error) {
		console.error("❌ Get deposit accounts error:", error);
		return handleAnchorError(error);
	}
};

/**
 * Get a single deposit account by ID
 */
export const getDepositAccount = async (accountId) => {
	try {
		console.log(`🔍 Fetching deposit account: ${accountId}`);

		const response = await makeAnchorRequest(
			"get",
			`/deposit-accounts/${accountId}`,
		);

		console.log("📥 Get deposit account response:", response.data);

		if (response.data?.data) {
			const account = response.data.data;
			const attributes = account.attributes || {};

			return {
				success: true,
				account: {
					id: account.id,
					accountId: account.id,
					productName: attributes.productName,
					status: attributes.status,
					balance: attributes.balance || 0,
					currency: attributes.currency || "NGN",
					accountNumber: attributes.accountNumber || attributes.nuban,
					bankName: attributes.bankName || "Anchor Bank",
					createdAt: attributes.createdAt,
					updatedAt: attributes.updatedAt,
				},
			};
		}

		return {
			success: false,
			error: "Account not found",
		};
	} catch (error) {
		console.error("❌ Get deposit account error:", error);
		return handleAnchorError(error);
	}
};

/**
 * Get deposit account balance
 * ✅ FIXED: Use the correct wallet balance endpoint
 */
export const getDepositAccountBalance = async (depositAccountId) => {
	try {
		// ✅ CORRECT ENDPOINT: /wallet-balances instead of /deposit-accounts/:id/balance
		const response = await makeAnchorRequest(
			"get",
			`/wallet-balances?walletId=${depositAccountId}`,
		);

		if (response.data?.data && response.data.data.length > 0) {
			const balanceData = response.data.data[0];
			const attributes = balanceData.attributes || {};
			return {
				success: true,
				balance: attributes.balance || 0,
				currency: attributes.currency || "NGN",
				availableBalance:
					attributes.availableBalance || attributes.balance || 0,
			};
		}

		// Fallback: Try getting balance from deposit account
		try {
			const accountResponse = await getDepositAccount(depositAccountId);
			if (accountResponse.success && accountResponse.account) {
				return {
					success: true,
					balance: accountResponse.account.balance || 0,
					currency: accountResponse.account.currency || "NGN",
				};
			}
		} catch (fallbackError) {
			console.log("⚠️ Fallback balance fetch failed:", fallbackError.message);
		}

		return {
			success: false,
			error: "Failed to fetch balance",
		};
	} catch (error) {
		console.error("❌ Get deposit account balance error:", error);
		return handleAnchorError(error);
	}
};

/**
 * Get account transactions
 */
export const getAccountTransactions = async (
	accountId,
	limit = 50,
	offset = 0,
) => {
	try {
		console.log(`🔍 Fetching transactions for account: ${accountId}`);

		const response = await makeAnchorRequest(
			"get",
			`/deposit-accounts/${accountId}/transactions?limit=${limit}&offset=${offset}`,
		);

		console.log("📥 Get account transactions response:", response.data);

		if (response.data?.data) {
			const transactions = response.data.data.map((tx) => {
				const attributes = tx.attributes || {};
				return {
					id: tx.id,
					amount: attributes.amount || 0,
					type: attributes.type || "unknown",
					description:
						attributes.description || attributes.narration || "Transaction",
					senderName: attributes.senderName || attributes.senderAccountName,
					senderAccountNumber: attributes.senderAccountNumber,
					status: attributes.status || "completed",
					date: attributes.date || attributes.createdAt || new Date(),
					reference: attributes.reference || attributes.transactionReference,
					currency: attributes.currency || "NGN",
				};
			});

			return {
				success: true,
				transactions: transactions,
				total: response.data.meta?.total || transactions.length,
				pagination: {
					limit: limit,
					offset: offset,
					hasMore:
						offset + limit < (response.data.meta?.total || transactions.length),
				},
			};
		}

		return {
			success: false,
			error: "Failed to fetch transactions",
		};
	} catch (error) {
		console.error("❌ Get account transactions error:", error);
		return handleAnchorError(error);
	}
};

// ==================== VIRTUAL NUBAN (VIRTUAL ACCOUNTS) ====================

/**
 * Create a virtual NUBAN for wallet funding via bank transfer
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

/**
 * Get account number from deposit account
 */
export const getAccountNumber = async (depositAccountId) => {
	try {
		console.log(`🔍 Getting account number for: ${depositAccountId}`);

		// First try to get virtual NUBANs
		const nubanResult = await getVirtualNubans(depositAccountId);

		if (nubanResult.success && nubanResult.nubans.length > 0) {
			const nuban = nubanResult.nubans[0];
			return {
				success: true,
				accountNumber: nuban.accountNumber,
				bankName: nuban.bankName,
				accountName: nuban.accountName,
				bankCode: nuban.bankCode,
			};
		}

		// If no virtual NUBAN, try to get from deposit account
		const accountResult = await getDepositAccount(depositAccountId);

		if (accountResult.success) {
			return {
				success: true,
				accountNumber: accountResult.account.accountNumber || "pending",
				bankName: accountResult.account.bankName || "Anchor Bank",
				accountName: accountResult.account.accountName || "Kuditrak User",
				bankCode: "000",
			};
		}

		return {
			success: false,
			error: "Could not get account number",
		};
	} catch (error) {
		console.error("❌ Get account number error:", error);
		return handleAnchorError(error);
	}
};

// ==================== WALLET BALANCES (NEW ENDPOINT) ====================

/**
 * Get wallet balance using the correct endpoint
 * ✅ NEW METHOD - Uses /wallet-balances endpoint
 */
export const getWalletBalance = async (walletId) => {
	try {
		console.log(`🔍 Fetching wallet balance for: ${walletId}`);

		const response = await makeAnchorRequest(
			"get",
			`/wallet-balances?walletId=${walletId}`,
		);

		if (response.data?.data && response.data.data.length > 0) {
			const balanceData = response.data.data[0];
			const attributes = balanceData.attributes || {};
			return {
				success: true,
				balance: attributes.balance || 0,
				currency: attributes.currency || "NGN",
				availableBalance:
					attributes.availableBalance || attributes.balance || 0,
			};
		}

		return {
			success: false,
			error: "No balance data found",
		};
	} catch (error) {
		console.error("❌ Get wallet balance error:", error);
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
	getDepositAccount,
	getDepositAccounts,
	getDepositAccountBalance,
	getAccountTransactions,
	getAccountNumber,
	getWalletBalance, // ✅ New method

	// Virtual NUBAN (Top-up accounts)
	createVirtualNuban,
	getVirtualNubans,

	// Webhook
	verifyWebhookSignature,
};
