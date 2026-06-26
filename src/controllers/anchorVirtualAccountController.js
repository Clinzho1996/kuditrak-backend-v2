// backend/controllers/anchorVirtualAccountController.js - Fixed

import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Create or get a deposit account (virtual account) for the user
 */
// backend/controllers/anchorVirtualAccountController.js - Remove mock fallback

export const createDepositAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productName = "SAVINGS", metadata = {} } = req.body;

		console.log(`🔵 Creating deposit account for user: ${userId}`);

		// Get user's Anchor customer
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found. Please complete KYC first.",
			});
		}

		console.log(`✅ Anchor customer found: ${anchorCustomer.anchorCustomerId}`);

		// Check if KYC is completed
		if (anchorCustomer.kycLevel === "TIER_0") {
			return res.status(403).json({
				success: false,
				error: "KYC verification required to create deposit account",
				message: "Please complete KYC verification first",
			});
		}

		// ✅ STEP 1: Check if account exists on Anchor's side first
		let anchorAccountId = null;
		let existingAnchorAccount = null;

		try {
			const accountsResponse = await anchorService.getDepositAccounts(
				anchorCustomer.anchorCustomerId,
			);

			console.log("📊 Anchor accounts response:", accountsResponse);

			if (accountsResponse.success && accountsResponse.accounts) {
				const accounts = accountsResponse.accounts;
				if (accounts.length > 0) {
					existingAnchorAccount = accounts[0];
					anchorAccountId =
						existingAnchorAccount.id || existingAnchorAccount.accountId;
					console.log(`✅ Found existing Anchor account: ${anchorAccountId}`);
				}
			}
		} catch (err) {
			console.log("⚠️ Could not fetch accounts from Anchor:", err.message);
		}

		// ✅ STEP 2: Check if account exists in local database
		let existingLocalAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		if (existingLocalAccount) {
			console.log(
				`✅ Found local account: ${existingLocalAccount.accountNumber}`,
			);

			if (anchorAccountId && !existingLocalAccount.anchorReference) {
				existingLocalAccount.anchorReference = anchorAccountId;
				await existingLocalAccount.save();
				console.log(`✅ Synced local account with Anchor: ${anchorAccountId}`);
			}

			return res.status(200).json({
				success: true,
				message: "Deposit account already exists",
				account: {
					id: existingLocalAccount._id,
					accountNumber: existingLocalAccount.accountNumber,
					bankName: existingLocalAccount.bankName,
					accountName: existingLocalAccount.accountName,
					isActive: existingLocalAccount.isActive,
				},
			});
		}

		// ✅ STEP 3: If account exists on Anchor but not locally, create local record
		if (anchorAccountId && existingAnchorAccount) {
			console.log(
				`🔄 Creating local record for existing Anchor account: ${anchorAccountId}`,
			);

			const accountDetails =
				await anchorService.getDepositAccount(anchorAccountId);

			let accountNumber = "pending";
			let bankName = "Anchor Bank";

			if (accountDetails.success && accountDetails.account) {
				accountNumber = accountDetails.account.accountNumber || accountNumber;
				bankName = accountDetails.account.bankName || bankName;
			}

			const virtualAccount = await AnchorVirtualAccount.create({
				userId,
				anchorCustomerId: anchorCustomer.anchorCustomerId,
				walletId: null,
				accountNumber: accountNumber,
				bankName: bankName,
				bankCode: "000",
				accountName: req.user.fullName || "Kuditrak User",
				anchorReference: anchorAccountId,
				isActive: true,
				isMock: false,
			});

			await sendPushToUser(
				userId,
				"🏦 Virtual Account Synced",
				`Your virtual account ${accountNumber} (${bankName}) is ready to receive money.`,
				{
					type: "virtual_account_created",
					accountNumber: accountNumber,
				},
			);

			return res.status(201).json({
				success: true,
				message: "Virtual account synced successfully",
				account: {
					id: virtualAccount._id,
					accountNumber: virtualAccount.accountNumber,
					bankName: virtualAccount.bankName,
					accountName: virtualAccount.accountName,
					isActive: true,
				},
			});
		}

		// ✅ STEP 4: No account exists - create new one
		console.log("🆕 Creating new deposit account with Anchor...");

		const accountResponse = await anchorService.createDepositAccount(
			anchorCustomer.anchorCustomerId,
			productName,
			{ userId: userId.toString(), platform: "kuditrak", ...metadata },
		);

		if (!accountResponse.success) {
			console.error(
				"❌ Anchor account creation failed:",
				accountResponse.error,
			);
			return res.status(400).json({
				success: false,
				error:
					accountResponse.error || "Failed to create deposit account in Anchor",
			});
		}

		const newAccountId = accountResponse.accountId;
		console.log(`✅ Anchor account created: ${newAccountId}`);

		// Create virtual NUBAN
		const nubanResponse = await anchorService.createVirtualNuban(newAccountId, {
			userId: userId.toString(),
			platform: "kuditrak",
		});

		if (!nubanResponse.success) {
			console.error("❌ Virtual NUBAN creation failed:", nubanResponse.error);
			return res.status(400).json({
				success: false,
				error:
					nubanResponse.error || "Failed to create virtual NUBAN in Anchor",
			});
		}

		console.log(`✅ Virtual NUBAN created: ${nubanResponse.accountNumber}`);

		// Save to local database
		const virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: null,
			accountNumber: nubanResponse.accountNumber,
			bankName: nubanResponse.bankName || "Anchor Bank",
			bankCode: nubanResponse.bankCode || "000",
			accountName: req.user.fullName || "Kuditrak User",
			anchorReference: newAccountId,
			isActive: true,
			isMock: false,
		});

		await sendPushToUser(
			userId,
			"🏦 Virtual Account Created",
			`Your virtual account ${virtualAccount.accountNumber} (${virtualAccount.bankName}) is ready to receive money.`,
			{
				type: "virtual_account_created",
				accountNumber: virtualAccount.accountNumber,
			},
		);

		res.status(201).json({
			success: true,
			message: "Deposit account created successfully",
			account: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				isActive: true,
			},
		});
	} catch (error) {
		console.error("❌ Create deposit account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to create deposit account",
		});
	}
};

/**
 * Get user's virtual account details
 * Now checks Anchor API first for real-time data
 */
export const getVirtualAccount = async (req, res) => {
	try {
		const userId = req.user._id;

		// Get customer info
		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found",
				message: "Please complete KYC first",
			});
		}

		// Check local database first
		let virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});

		// If not found locally, try to fetch from Anchor
		if (!virtualAccount) {
			console.log("🔍 No local account found, checking Anchor...");

			try {
				const accountsResponse = await anchorService.getDepositAccounts(
					anchorCustomer.anchorCustomerId,
				);

				if (accountsResponse.success && accountsResponse.accounts?.length > 0) {
					const anchorAccount = accountsResponse.accounts[0];
					const accountId = anchorAccount.id || anchorAccount.accountId;

					console.log(`✅ Found Anchor account: ${accountId}`);

					// Create local record
					const accountDetails =
						await anchorService.getDepositAccount(accountId);

					virtualAccount = await AnchorVirtualAccount.create({
						userId,
						anchorCustomerId: anchorCustomer.anchorCustomerId,
						walletId: null,
						accountNumber: accountDetails.success
							? accountDetails.account.accountNumber || "pending"
							: "pending",
						bankName: accountDetails.success
							? accountDetails.account.bankName || "Anchor Bank"
							: "Anchor Bank",
						bankCode: "000",
						accountName: req.user.fullName || "Kuditrak User",
						anchorReference: accountId,
						isActive: true,
						isMock: false,
					});

					console.log(
						`✅ Local account created from Anchor data: ${virtualAccount.accountNumber}`,
					);
				}
			} catch (err) {
				console.log("⚠️ Could not fetch accounts from Anchor:", err.message);
			}
		}

		if (!virtualAccount) {
			return res.status(404).json({
				success: false,
				error: "No virtual account found",
				message: "Create a deposit account first",
			});
		}

		// Refresh account details from Anchor if not mock
		if (!virtualAccount.isMock && virtualAccount.anchorReference) {
			try {
				const accountDetails = await anchorService.getDepositAccount(
					virtualAccount.anchorReference,
				);

				if (accountDetails.success && accountDetails.account) {
					// Update with latest data
					if (accountDetails.account.accountNumber) {
						virtualAccount.accountNumber = accountDetails.account.accountNumber;
					}
					if (accountDetails.account.bankName) {
						virtualAccount.bankName = accountDetails.account.bankName;
					}
					await virtualAccount.save();
					console.log(
						`✅ Account details refreshed: ${virtualAccount.accountNumber}`,
					);
				}
			} catch (err) {
				console.log("⚠️ Could not refresh account details:", err.message);
			}
		}

		res.status(200).json({
			success: true,
			account: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				isActive: virtualAccount.isActive,
				isMock: virtualAccount.isMock || false,
			},
		});
	} catch (error) {
		console.error("❌ Get virtual account error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Get account statement/transactions for virtual account
 */
export const getAccountTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 50, offset = 0 } = req.query;

		const virtualAccount = await AnchorVirtualAccount.findOne({
			userId,
			isActive: true,
		});
		if (!virtualAccount) {
			return res.status(404).json({ error: "No virtual account found" });
		}

		// Try to get real transactions from Anchor
		let transactions = [];
		let isMock = false;

		if (!virtualAccount.isMock && virtualAccount.anchorReference) {
			try {
				const result = await anchorService.getAccountTransactions(
					virtualAccount.anchorReference,
					parseInt(limit),
					parseInt(offset),
				);

				if (result.success && result.transactions) {
					transactions = result.transactions.map((tx) => ({
						id: tx.id || tx._id,
						amount: tx.amount || 0,
						type: tx.type === "credit" ? "credit" : "debit",
						description: tx.description || tx.narration || "Transaction",
						senderName: tx.senderName || tx.senderAccountName,
						senderAccount: tx.senderAccountNumber,
						status: tx.status || "completed",
						date: tx.date || tx.createdAt || new Date(),
						reference: tx.reference || tx.transactionReference,
					}));

					console.log(`✅ Found ${transactions.length} Anchor transactions`);
				}
			} catch (err) {
				console.log("⚠️ Could not fetch Anchor transactions:", err.message);
			}
		}

		// Fallback to mock transactions if no real ones found
		if (transactions.length === 0) {
			isMock = true;
			transactions = [
				{
					id: "tx_1",
					amount: 50000,
					type: "credit",
					description: "Transfer from John Doe",
					senderName: "John Doe",
					senderAccount: "0123456789",
					status: "completed",
					date: new Date(),
					reference: "REF001",
				},
				{
					id: "tx_2",
					amount: 25000,
					type: "credit",
					description: "Salary payment",
					senderName: "Employer Ltd",
					senderAccount: "9876543210",
					status: "completed",
					date: new Date(Date.now() - 86400000),
					reference: "REF002",
				},
			];
		}

		res.status(200).json({
			success: true,
			transactions,
			isMock,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total: transactions.length,
			},
		});
	} catch (error) {
		console.error("❌ Get account transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};
