import BankConnection from "../models/BankConnection.js";
import User from "../models/User.js";
import mono from "../services/monoService.js";
import { checkLimits } from "../services/subscriptionService.js";

/**
 * Step 1: Initiate bank link → returns link + monoCustomerId
 */
export const initiateBankLink = async (req, res) => {
	try {
		// Check subscription limits before initiating
		await checkLimits(req.user._id, "bank_connection");

		const { name, email } = req.body;

		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(2, 8);
		const uniqueRef = `LINK_${timestamp}_${randomStr}`;

		// For Mono, you always need to create a new customer
		// The customer_id is for reference only, not for reusing
		const requestData = {
			customer: { name, email },
			meta: { ref: uniqueRef },
			scope: "auth",
			redirect_url: "https://kuditrak.com/mono-redirect",
		};

		console.log("Initiating Mono link with data:", requestData);

		const response = await mono.post("/accounts/initiate", requestData);

		console.log("Mono initiate response:", response.data);

		// Always save/update the customer ID
		if (response.data.data.customer) {
			req.user.monoCustomerId = response.data.data.customer;
			await req.user.save();
			console.log("Saved Mono customer ID:", req.user.monoCustomerId);
		}

		res.status(200).json({
			success: true,
			monoUrl: response.data.data.mono_url,
			monoCustomerId: req.user.monoCustomerId,
			ref: uniqueRef,
		});
	} catch (err) {
		console.error(
			"Initiate bank link error:",
			err.response?.data || err.message,
		);

		if (err.message.includes("Bank connection limit reached")) {
			return res.status(403).json({
				success: false,
				error: err.message,
				requiresUpgrade: true,
			});
		}

		res.status(500).json({
			success: false,
			error: err.message || "Failed to initiate bank linking",
			details: err.response?.data,
		});
	}
};

/**
 * Step 2: Save monoCustomerId to user before webhook
 */
export const saveMonoCustomerId = async (req, res) => {
	try {
		const { monoCustomerId } = req.body;
		if (!monoCustomerId) throw new Error("Missing monoCustomerId");

		req.user.monoCustomerId = monoCustomerId;
		await req.user.save();

		res.status(200).json({ success: true, monoCustomerId });
	} catch (err) {
		console.error("Save customer ID error:", err.message);
		res.status(500).json({ success: false, error: err.message });
	}
};

/**
 * Optional: direct linking for v2 accounts (frontend can skip if using webhook)
 */
export const linkBankAccount = async (req, res) => {
	try {
		const { accountId } = req.body;

		const user = await User.findById(req.user._id);
		if (!user.monoCustomerId) {
			return res.status(400).json({
				success: false,
				error: "Mono customer ID not saved. Initiate account first.",
			});
		}

		// Check subscription limits before linking
		await checkLimits(req.user._id, "bank_connection");

		const response = await mono.get(`/accounts/${accountId}`);
		const account = response.data.data;

		const existing = await BankConnection.findOne({
			userId: user._id,
			monoAccountId: account.id,
		});
		if (existing) {
			return res.status(400).json({
				success: false,
				error: "Account already linked",
			});
		}

		const connection = await BankConnection.create({
			userId: user._id,
			monoCustomerId: user.monoCustomerId,
			monoAccountId: account.id,
			accountName: account.name,
			accountNumber: account.account_number,
			bankName: account.institution?.name || "Unknown",
			balance: account.balance,
			currency: account.currency,
			bvn: account.bvn,
			provider: "mono",
			status: "Active",
			lastSync: new Date(),
		});

		res.status(200).json({ success: true, connection });
	} catch (err) {
		console.error("Link account error:", err.response?.data || err.message);

		// Handle subscription limit error specifically
		if (err.message.includes("Bank connection limit reached")) {
			return res.status(403).json({
				success: false,
				error: err.message,
				requiresUpgrade: true,
				currentLimit: err.message.match(/\d+/)?.[0] || null,
			});
		}

		res.status(500).json({
			success: false,
			error: err.message || "Failed to link bank account",
			details: err.response?.data,
		});
	}
};

/**
 * Get user bank accounts
 */
export const getUserBankAccounts = async (req, res) => {
	try {
		const accounts = await BankConnection.find({
			userId: req.user._id,
			status: "Active",
		}).sort({ lastSync: -1 });

		res.status(200).json({ success: true, accounts });
	} catch (err) {
		console.error("Get user bank accounts error:", err.message);
		res.status(500).json({ success: false, error: err.message });
	}
};

// Add this to your monoController.js
export const syncMissingAccounts = async (req, res) => {
	try {
		const user = await User.findById(req.user._id);
		if (!user.monoCustomerId) {
			return res.status(400).json({
				success: false,
				error: "No Mono customer ID found for this user",
			});
		}

		// Fetch all accounts for this customer from Mono
		const response = await mono.get(
			`/customers/${user.monoCustomerId}/accounts`,
		);
		const accounts = response.data.data;

		const syncedAccounts = [];
		const errors = [];

		for (const account of accounts) {
			try {
				// Check if account already exists
				let connection = await BankConnection.findOne({
					monoAccountId: account.id,
				});

				if (!connection) {
					// Create new connection
					connection = await BankConnection.create({
						userId: user._id,
						monoCustomerId: user.monoCustomerId,
						monoAccountId: account.id,
						accountName: account.name,
						accountNumber: account.account_number,
						bankName: account.institution?.name,
						balance: account.balance,
						currency: account.currency,
						bvn: account.bvn,
						status: "Active",
						lastSync: new Date(),
						provider: "mono",
					});
					syncedAccounts.push(connection);
				} else {
					// Update existing connection
					connection.accountName = account.name || connection.accountName;
					connection.accountNumber =
						account.account_number || connection.accountNumber;
					connection.bankName =
						account.institution?.name || connection.bankName;
					connection.balance = account.balance ?? connection.balance;
					connection.currency = account.currency || connection.currency;
					connection.bvn = account.bvn || connection.bvn;
					connection.lastSync = new Date();
					await connection.save();
					syncedAccounts.push(connection);
				}
			} catch (err) {
				errors.push({ account: account.id, error: err.message });
			}
		}

		res.status(200).json({
			success: true,
			message: `Synced ${syncedAccounts.length} accounts`,
			syncedAccounts,
			errors,
		});
	} catch (err) {
		console.error("Sync missing accounts error:", err.message);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

/**
 * Unlink (delete) a bank account
 * Removes the bank connection from the database
 */
export const unlinkBankAccount = async (req, res) => {
	try {
		const { accountId } = req.params;

		if (!accountId) {
			return res.status(400).json({
				success: false,
				error: "Account ID is required",
			});
		}

		// Find and verify the account belongs to the user
		const account = await BankConnection.findOne({
			_id: accountId,
			userId: req.user._id,
		});

		if (!account) {
			return res.status(404).json({
				success: false,
				error: "Bank account not found",
			});
		}

		// Optional: Check if the account has any transactions before unlinking
		const Transaction = await import("../models/Transaction.js").then(
			(m) => m.default,
		);
		const transactionCount = await Transaction.countDocuments({
			bankConnectionId: account._id,
		});

		if (transactionCount > 0) {
			// Option 1: Soft delete - mark as inactive instead of deleting
			account.status = "Inactive";
			await account.save();

			return res.status(200).json({
				success: true,
				message: `Bank account unlinked successfully. ${transactionCount} transactions will remain in your history.`,
				account: {
					_id: account._id,
					bankName: account.bankName,
					accountNumber: account.accountNumber,
					status: account.status,
				},
			});
		}

		// No transactions - hard delete
		await account.deleteOne();

		res.status(200).json({
			success: true,
			message: `Bank account (${account.bankName} - ${account.accountNumber}) unlinked successfully.`,
			accountId: account._id,
		});
	} catch (err) {
		console.error("Unlink bank account error:", err.message);
		res.status(500).json({
			success: false,
			error: err.message || "Failed to unlink bank account",
		});
	}
};

/**
 * Unlink all bank accounts for a user
 * Useful for account deletion or cleanup
 */
export const unlinkAllBankAccounts = async (req, res) => {
	try {
		const result = await BankConnection.updateMany(
			{ userId: req.user._id, status: "Active" },
			{ $set: { status: "Inactive", lastSync: new Date() } },
		);

		res.status(200).json({
			success: true,
			message: `${result.modifiedCount} bank account(s) unlinked successfully`,
			count: result.modifiedCount,
		});
	} catch (err) {
		console.error("Unlink all bank accounts error:", err.message);
		res.status(500).json({
			success: false,
			error: err.message || "Failed to unlink bank accounts",
		});
	}
};
