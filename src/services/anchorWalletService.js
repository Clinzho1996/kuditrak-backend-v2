// backend/controllers/anchorWalletController.js
import AnchorSubAccount from "../models/AnchorSubAccount.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Get user's wallet balance
 */
export const getWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		// Ensure Anchor customer exists
		const customerResult = await getOrCreateAnchorCustomer(userId);
		if (!customerResult.success) {
			return res.status(400).json({ error: customerResult.error });
		}

		// Get user's main wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		// Get real-time balance from Anchor
		const balanceResponse = await anchorService.getWalletBalance(
			wallet.walletId,
		);

		if (balanceResponse.success) {
			// Update local balance
			wallet.balance = balanceResponse.balance;
			await wallet.save();

			return res.status(200).json({
				success: true,
				balance: balanceResponse.balance,
				currency: balanceResponse.currency,
				walletId: wallet.walletId,
				walletName: wallet.name,
			});
		}

		// Fallback to local balance
		return res.status(200).json({
			success: true,
			balance: wallet.balance,
			currency: wallet.currency,
			walletId: wallet.walletId,
			walletName: wallet.name,
		});
	} catch (error) {
		console.error("Get wallet balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get wallet transactions
 */
export const getWalletTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 50, offset = 0 } = req.query;

		// Get transactions from local database
		const transactions = await AnchorTransaction.find({ userId })
			.sort({ createdAt: -1 })
			.limit(parseInt(limit))
			.skip(parseInt(offset))
			.lean();

		const total = await AnchorTransaction.countDocuments({ userId });

		res.status(200).json({
			success: true,
			transactions,
			pagination: {
				limit: parseInt(limit),
				offset: parseInt(offset),
				total,
				hasMore: offset + limit < total,
			},
		});
	} catch (error) {
		console.error("Get wallet transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Create sub-account (savings goal)
 */
export const createSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { name, type, targetAmount, autoSave, icon, color } = req.body;

		// Get main wallet
		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

		// Create unique sub-account ID
		const subAccountId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const subAccount = await AnchorSubAccount.create({
			userId,
			parentWalletId: mainWallet._id,
			subAccountId,
			name,
			type: type || "savings",
			balance: 0,
			targetAmount: targetAmount || null,
			autoSave: autoSave || {
				enabled: false,
				amount: 0,
				frequency: "monthly",
				dayOfMonth: 1,
			},
			icon: icon || "💰",
			color: color || "#4F46E5",
			lockSettings: { enabled: false, unlockDate: null },
		});

		// Send notification
		await sendPushToUser(
			userId,
			"🎯 Savings Goal Created!",
			`You've created a new savings goal: ${name}`,
			{ type: "sub_account_created", subAccountId: subAccount.subAccountId },
		);

		res.status(201).json({
			success: true,
			message: "Sub-account created successfully",
			subAccount,
		});
	} catch (error) {
		console.error("Create sub-account error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get user's sub-accounts
 */
export const getSubAccounts = async (req, res) => {
	try {
		const userId = req.user._id;

		const subAccounts = await AnchorSubAccount.find({ userId })
			.sort({ createdAt: -1 })
			.lean();

		// Add virtual isLocked property
		const processedAccounts = subAccounts.map((account) => ({
			...account,
			isLocked: account.lockSettings?.enabled
				? new Date() < new Date(account.lockSettings.unlockDate)
				: false,
		}));

		res.status(200).json({
			success: true,
			subAccounts: processedAccounts,
		});
	} catch (error) {
		console.error("Get sub-accounts error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Fund sub-account from main wallet
 */
export const fundSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { subAccountId, amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		// Get main wallet
		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

		// Get sub-account
		const subAccount = await AnchorSubAccount.findOne({ userId, subAccountId });
		if (!subAccount) {
			return res.status(404).json({ error: "Sub-account not found" });
		}

		// Check if sub-account is locked
		if (subAccount.isLocked) {
			return res.status(400).json({
				error:
					"Sub-account is locked until " + subAccount.lockSettings.unlockDate,
			});
		}

		// Check if main wallet has sufficient balance
		const balanceResponse = await anchorService.getWalletBalance(
			mainWallet.walletId,
		);
		if (!balanceResponse.success || balanceResponse.balance < amount) {
			return res.status(400).json({ error: "Insufficient balance" });
		}

		// Transfer from main wallet to sub-account (internal transfer)
		// Note: For simplicity, we're doing a local transfer
		// In production, you'd use Anchor's internal transfer API

		// Update balances locally
		mainWallet.balance -= amount;
		subAccount.balance += amount;
		await mainWallet.save();
		await subAccount.save();

		// Record transaction
		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: mainWallet.anchorCustomerId,
			walletId: mainWallet._id,
			subAccountId: subAccount._id,
			amount,
			currency: "NGN",
			type: "debit",
			category: "transfer",
			status: "success",
			description: `Transfer to ${subAccount.name}`,
			source: "wallet",
			destination: "sub_account",
			metadata: { subAccountId: subAccount.subAccountId },
		});

		// Send notification
		await sendPushToUser(
			userId,
			"💰 Sub-Account Funded",
			`₦${amount.toLocaleString()} added to ${subAccount.name}`,
			{
				type: "sub_account_funded",
				subAccountId: subAccount.subAccountId,
				amount,
			},
		);

		res.status(200).json({
			success: true,
			message: "Sub-account funded successfully",
			transaction,
			newBalance: subAccount.balance,
		});
	} catch (error) {
		console.error("Fund sub-account error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Withdraw from sub-account
 */
export const withdrawFromSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { subAccountId, amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		// Get main wallet
		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

		// Get sub-account
		const subAccount = await AnchorSubAccount.findOne({ userId, subAccountId });
		if (!subAccount) {
			return res.status(404).json({ error: "Sub-account not found" });
		}

		// Check if sub-account is locked
		if (subAccount.isLocked) {
			// Calculate penalty for early withdrawal
			const penaltyMultiplier = 1.07;
			const penalty = amount * (penaltyMultiplier - 1);
			const totalDeduction = amount + penalty;

			if (subAccount.balance < totalDeduction) {
				return res
					.status(400)
					.json({ error: "Insufficient balance including penalty" });
			}

			// Deduct penalty
			subAccount.balance -= totalDeduction;
			mainWallet.balance += amount; // Only add back the original amount

			// Record penalty transaction
			await AnchorTransaction.create({
				userId,
				anchorCustomerId: mainWallet.anchorCustomerId,
				walletId: mainWallet._id,
				subAccountId: subAccount._id,
				amount: penalty,
				currency: "NGN",
				type: "debit",
				category: "fee",
				status: "success",
				description: `Early withdrawal penalty (7%) for ${subAccount.name}`,
				source: "sub_account",
				destination: "fee",
				metadata: { subAccountId, penalty, originalAmount: amount },
			});

			await sendPushToUser(
				userId,
				"⚠️ Early Withdrawal Penalty Applied",
				`A 7% penalty (₦${penalty.toLocaleString()}) was applied for early withdrawal from ${subAccount.name}`,
				{ type: "penalty_applied", subAccountId, penalty },
			);
		} else {
			// Normal withdrawal
			if (subAccount.balance < amount) {
				return res.status(400).json({ error: "Insufficient balance" });
			}
			subAccount.balance -= amount;
			mainWallet.balance += amount;
		}

		await mainWallet.save();
		await subAccount.save();

		// Record transaction
		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: mainWallet.anchorCustomerId,
			walletId: mainWallet._id,
			subAccountId: subAccount._id,
			amount,
			currency: "NGN",
			type: "credit",
			category: "transfer",
			status: "success",
			description: `Withdrawal from ${subAccount.name}`,
			source: "sub_account",
			destination: "wallet",
			metadata: { subAccountId: subAccount.subAccountId },
		});

		await sendPushToUser(
			userId,
			"💸 Sub-Account Withdrawal",
			`₦${amount.toLocaleString()} withdrawn from ${subAccount.name}`,
			{
				type: "sub_account_withdrawn",
				subAccountId: subAccount.subAccountId,
				amount,
			},
		);

		res.status(200).json({
			success: true,
			message: subAccount.isLocked
				? "Withdrawal completed with penalty"
				: "Withdrawal successful",
			transaction,
			newBalance: subAccount.balance,
		});
	} catch (error) {
		console.error("Withdraw from sub-account error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Lock sub-account
 */
export const lockSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { subAccountId, unlockDate } = req.body;

		if (!unlockDate) {
			return res.status(400).json({ error: "Unlock date is required" });
		}

		const subAccount = await AnchorSubAccount.findOne({ userId, subAccountId });
		if (!subAccount) {
			return res.status(404).json({ error: "Sub-account not found" });
		}

		subAccount.lockSettings = {
			enabled: true,
			unlockDate: new Date(unlockDate),
			lockedAt: new Date(),
		};
		await subAccount.save();

		await sendPushToUser(
			userId,
			"🔒 Sub-Account Locked",
			`${subAccount.name} is locked until ${new Date(unlockDate).toLocaleDateString()}`,
			{ type: "sub_account_locked", subAccountId, unlockDate },
		);

		res.status(200).json({
			success: true,
			message: "Sub-account locked successfully",
			lockSettings: subAccount.lockSettings,
		});
	} catch (error) {
		console.error("Lock sub-account error:", error);
		res.status(500).json({ error: error.message });
	}
};
