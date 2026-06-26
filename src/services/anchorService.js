// backend/services/anchorService.js - Fixed with correct Anchor API endpoints

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
 * ✅ FIXED: Using correct endpoint and payload structure from Anchor docs
 */
export const upgradeCustomerKYC = async (
	customerId,
	bvn,
	dateOfBirth,
	gender,
) => {
	try {
		// ✅ According to Anchor docs, use the verification endpoint
		// with level: "TIER_2" (this is correct - Tier 1 is the result, not the request level)
		const payload = {
			data: {
				type: "Verification",
				attributes: {
					level: "TIER_2", // ✅ Always use TIER_2 for BVN verification
					level2: {
						bvn: bvn,
						dateOfBirth: dateOfBirth,
						gender: gender, // Should be "Male" or "Female" with capital letter
					},
				},
			},
		};

		console.log("📝 Upgrade KYC Payload:", JSON.stringify(payload, null, 2));

		// ✅ Use the verification endpoint
		const response = await makeAnchorRequest(
			"post",
			`/customers/${customerId}/verification/individual`,
			payload,
		);

		if (response.data?.data) {
			const attributes = response.data.data.attributes || {};
			console.log("✅ KYC upgrade initiated successfully");
			console.log(`   Status: ${attributes.status || "pending"}`);

			return {
				success: true,
				verification: response.data.data,
				verificationId: response.data.data.id,
				status: attributes.status || "pending",
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
 * ✅ FIXED: Using correct endpoint /api/v1/accounts
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

		// ✅ CORRECT ENDPOINT: /accounts (not /deposit-accounts)
		const response = await makeAnchorRequest("post", "/accounts", payload);

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
 * ✅ FIXED: Using correct endpoint
 */
export const getDepositAccounts = async (customerId) => {
	try {
		console.log(`🔍 Fetching deposit accounts for customer: ${customerId}`);

		// ✅ CORRECT ENDPOINT: /accounts?customerId={customerId}
		const response = await makeAnchorRequest(
			"get",
			`/accounts?customerId=${customerId}`,
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
 * ✅ FIXED: Using correct endpoint
 */
// backend/services/anchorService.js - Fixed getDepositAccount

export const getDepositAccount = async (accountId) => {
	try {
		console.log(`🔍 Fetching deposit account: ${accountId}`);

		// ✅ CORRECT ENDPOINT: /accounts/{accountId}?include=AccountNumber
		const response = await makeAnchorRequest(
			"get",
			`/accounts/${accountId}?include=AccountNumber`,
		);

		console.log(
			"📥 Get deposit account response:",
			JSON.stringify(response.data, null, 2),
		);

		if (response.data?.data) {
			const account = response.data.data;
			const attributes = account.attributes || {};
			const included = response.data.included || [];

			// ✅ Extract account number and bank details from included
			let accountNumber = null;
			let bankName = null;
			let bankCode = null;
			let accountName = null;
			let currency = "NGN";
			let status = "ACTIVE";

			for (const item of included) {
				if (item.type === "AccountNumber" || item.type === "VirtualNuban") {
					const itemAttributes = item.attributes || {};

					// ✅ Get the full unmasked account number
					if (itemAttributes.accountNumber) {
						accountNumber = itemAttributes.accountNumber;
					}

					// ✅ Get bank details from AccountNumber
					if (itemAttributes.bank) {
						const bank = itemAttributes.bank;
						if (bank.name) {
							bankName = bank.name;
						}
						if (bank.code) {
							bankCode = bank.code;
						}
					}

					// ✅ Get account name
					if (itemAttributes.name) {
						accountName = itemAttributes.name;
					}

					// ✅ Get currency and status
					if (itemAttributes.currency) {
						currency = itemAttributes.currency;
					}
					if (itemAttributes.status) {
						status = itemAttributes.status;
					}

					break;
				}
			}

			// ✅ If bank details not found in included, try attributes
			if (!bankName && attributes.bank) {
				const bank = attributes.bank;
				if (bank.name) {
					bankName = bank.name;
				}
				if (bank.code || bank.nipCode) {
					bankCode = bank.code || bank.nipCode;
				}
			}

			// ✅ If bank details still not found, use null (not "Anchor Bank")
			if (!bankName) {
				console.warn("⚠️ No bank name found in Anchor response");
				// ⚠️ DO NOT use "Anchor Bank" - use null
			}

			// ✅ If account number is still masked, try attributes
			if (!accountNumber || accountNumber.includes("*")) {
				if (
					attributes.accountNumber &&
					!attributes.accountNumber.includes("*")
				) {
					accountNumber = attributes.accountNumber;
				}
			}

			console.log(`📊 Extracted account details:`);
			console.log(`   Account Number: ${accountNumber}`);
			console.log(`   Bank Name: ${bankName}`);
			console.log(`   Bank Code: ${bankCode}`);
			console.log(`   Account Name: ${accountName}`);
			console.log(`   Currency: ${currency}`);
			console.log(`   Status: ${status}`);

			return {
				success: true,
				account: {
					id: account.id,
					accountId: account.id,
					productName: attributes.productName,
					status: attributes.status || status,
					balance: attributes.balance || attributes.availableBalance || 0,
					currency: attributes.currency || currency,
					accountNumber: accountNumber,
					bankName: bankName, // ✅ Will be null if not found
					bankCode: bankCode, // ✅ Will be null if not found
					accountName: accountName || attributes.accountName,
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
 * ✅ FIXED: Using correct endpoint /api/v1/accounts/balance/{accountId}
 */

export const getDepositAccountBalance = async (depositAccountId) => {
	try {
		const response = await makeAnchorRequest(
			"get",
			`/accounts/balance/${depositAccountId}`,
		);

		if (response.data?.data) {
			const data = response.data.data;
			return {
				success: true,
				balance: data.availableBalance || 0, // ✅ Raw (in kobo)
				balanceInNGN: (data.availableBalance || 0) / 100,
				ledgerBalance: data.ledgerBalance || 0,
				hold: data.hold || 0,
				pending: data.pending || 0,
				currency: "NGN",
			};
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
 * Get account number for a deposit account
 * ✅ NEW METHOD: /api/v1/account-numbers?AccountId={depositAccountId}
 */
// In anchorService.js

// backend/services/anchorService.js

// backend/services/anchorService.js - Make sure this returns bank details

export const getAccountNumberForDeposit = async (depositAccountId) => {
	try {
		console.log(
			`🔍 Fetching account number for deposit account: ${depositAccountId}`,
		);

		const response = await makeAnchorRequest(
			"get",
			`/accounts/${depositAccountId}?include=AccountNumber,VirtualNuban`,
		);

		if (response.data?.data) {
			const account = response.data.data;
			const attributes = account.attributes || {};

			let accountNumber = attributes.accountNumber || null;
			let accountName = attributes.accountName || null;
			let currency = attributes.currency || "NGN";
			let status = attributes.status || "ACTIVE";
			let bankName = null;
			let bankCode = null;

			// ✅ Look through included data for AccountNumber
			const included = response.data.included || [];
			for (const item of included) {
				if (item.type === "AccountNumber" || item.type === "VirtualNuban") {
					const itemAttributes = item.attributes || {};

					// ✅ Get full unmasked account number
					if (
						itemAttributes.accountNumber &&
						!itemAttributes.accountNumber.includes("*")
					) {
						accountNumber = itemAttributes.accountNumber;
					}

					// ✅ Get bank details
					if (itemAttributes.bank) {
						const bank = itemAttributes.bank;
						if (bank.name) {
							bankName = bank.name;
						}
						if (bank.code) {
							bankCode = bank.code;
						}
					}

					if (itemAttributes.name) {
						accountName = itemAttributes.name;
					}
					if (itemAttributes.currency) {
						currency = itemAttributes.currency;
					}
					if (itemAttributes.status) {
						status = itemAttributes.status;
					}
					break;
				}
			}

			// ✅ If bank details not found, try attributes
			if (!bankName && attributes.bank) {
				const bank = attributes.bank;
				if (bank.name) bankName = bank.name;
				if (bank.code || bank.nipCode) bankCode = bank.code || bank.nipCode;
			}

			console.log(`📊 Extracted bank details: ${bankName} (${bankCode})`);

			return {
				success: true,
				accountNumber: accountNumber,
				bankName: bankName, // ✅ Will be "PROVIDUS BANK"
				bankCode: bankCode, // ✅ Will be "000023"
				accountName: accountName,
				currency: currency,
				status: status,
			};
		}

		return {
			success: false,
			error: "No account number found",
		};
	} catch (error) {
		console.error("❌ Get account number error:", error);
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
			`/accounts/${accountId}/transactions?limit=${limit}&offset=${offset}`,
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

// ==================== WALLET BALANCES ====================

/**
 * Get wallet balance
 * ✅ Uses /accounts/balance/{walletId}
 */
// backend/services/anchorService.js - Update getWalletBalance

export const getWalletBalance = async (walletId) => {
	try {
		console.log(`🔍 Fetching wallet balance for: ${walletId}`);

		// ✅ CORRECT ENDPOINT: /accounts/balance/{walletId}
		const response = await makeAnchorRequest(
			"get",
			`/accounts/balance/${walletId}`,
		);

		if (response.data?.data) {
			const data = response.data.data;

			// ✅ Return the raw balance (in kobo) - let the controller handle conversion
			return {
				success: true,
				balance: data.availableBalance || 0, // ✅ Raw value from Anchor (in kobo)
				ledgerBalance: data.ledgerBalance || 0,
				hold: data.hold || 0,
				pending: data.pending || 0,
				currency: "NGN",
				// Also return the converted values for convenience
				balanceInNGN: (data.availableBalance || 0) / 100,
				ledgerBalanceInNGN: (data.ledgerBalance || 0) / 100,
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
	getAccountNumberForDeposit, // ✅ New method
	getWalletBalance,

	// Webhook
	verifyWebhookSignature,
};
