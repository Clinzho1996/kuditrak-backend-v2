// backend/controllers/walletController.js - Complete version with all functions

import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Create a wallet (deposit account) for a user
 */
export const createWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currency = "NGN" } = req.body;

		console.log("🔵 Creating wallet for user:", userId);

		// Check if wallet already exists
		const existingWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (existingWallet) {
			console.log("✅ Wallet already exists:", existingWallet.walletId);
			return res.status(200).json({
				success: true,
				message: "Wallet already exists",
				wallet: {
					id: existingWallet._id,
					walletId: existingWallet.walletId,
					name: existingWallet.name,
					balance: existingWallet.balance,
					currency: existingWallet.currency,
					status: existingWallet.status,
					accountNumber: existingWallet.accountNumber,
					bankName: existingWallet.bankName,
				},
			});
		}

		// Ensure Anchor customer exists
		const customerResult = await getOrCreateAnchorCustomer(userId);
		if (!customerResult.success) {
			console.log(
				"❌ Failed to get/create Anchor customer:",
				customerResult.error,
			);

			// Create local wallet anyway
			const wallet = await AnchorWallet.create({
				userId,
				anchorCustomerId: `local_${Date.now()}`,
				walletId: `local_${Date.now()}_${userId.toString().slice(-6)}`,
				walletType: "main",
				balance: 0,
				name: "Main Wallet",
				currency: "NGN",
				status: "active",
				isLocal: true,
			});

			return res.status(201).json({
				success: true,
				message: "Local wallet created (Anchor customer unavailable)",
				wallet: {
					id: wallet._id,
					walletId: wallet.walletId,
					name: wallet.name,
					balance: wallet.balance,
					currency: wallet.currency,
					status: wallet.status,
					isLocal: true,
				},
			});
		}

		// Create deposit account (wallet) via Anchor
		let accountResponse;
		try {
			accountResponse = await anchorService.createDepositAccount(
				customerResult.customerId,
				"SAVINGS",
				{
					userId: userId.toString(),
					platform: "kuditrak",
					walletType: "main",
					currency: currency,
				},
			);
		} catch (anchorError) {
			console.log(
				"⚠️ Anchor deposit account creation failed:",
				anchorError.message,
			);
			accountResponse = { success: false };
		}

		// Create virtual NUBAN if account was created
		let virtualNuban = null;
		if (accountResponse?.success) {
			try {
				const nubanResponse = await anchorService.createVirtualNuban(
					accountResponse.accountId,
					{ userId: userId.toString() },
				);
				if (nubanResponse.success) {
					virtualNuban = nubanResponse;
					console.log(
						`✅ Virtual NUBAN created: ${nubanResponse.accountNumber}`,
					);
				}
			} catch (nubanError) {
				console.log("⚠️ Could not create virtual NUBAN:", nubanError.message);
			}
		}

		// Save wallet to database
		const walletData = {
			userId,
			anchorCustomerId: customerResult.customerId,
			walletId: accountResponse?.success
				? accountResponse.accountId
				: `local_${Date.now()}`,
			walletType: "main",
			balance: 0,
			name: "Main Wallet",
			currency: "NGN",
			status: "active",
			accountNumber: virtualNuban?.accountNumber || null,
			bankName: virtualNuban?.bankName || null,
			isLocal: !accountResponse?.success,
		};

		const wallet = await AnchorWallet.create(walletData);

		// Also save virtual account reference if NUBAN was created
		if (virtualNuban) {
			await AnchorVirtualAccount.create({
				userId,
				anchorCustomerId: customerResult.customerId,
				walletId: wallet._id,
				accountNumber: virtualNuban.accountNumber,
				bankName: virtualNuban.bankName,
				accountName: virtualNuban.accountName,
				bankCode: virtualNuban.bankCode,
				anchorReference: virtualNuban.virtualNubanId,
				isActive: true,
				provider: "anchor",
				currency: "NGN",
			});
		}

		console.log("✅ Wallet created:", wallet.walletId);

		res.status(201).json({
			success: true,
			message: accountResponse?.success
				? "Wallet created successfully"
				: "Local wallet created",
			wallet: {
				id: wallet._id,
				walletId: wallet.walletId,
				name: wallet.name,
				balance: wallet.balance,
				currency: wallet.currency,
				status: wallet.status,
				accountNumber: wallet.accountNumber,
				bankName: wallet.bankName,
				isLocal: wallet.isLocal || false,
			},
		});
	} catch (error) {
		console.error("Create wallet error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to create wallet",
		});
	}
};

/**
 * Get wallet balance
 */
export const getBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
				message: "Please create a wallet first",
				requiresWalletCreation: true,
			});
		}

		// Get virtual accounts for additional info
		const virtualAccounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		// Try to get real-time balance from Anchor
		let balance = wallet.balance;
		try {
			if (!wallet.isLocal) {
				const balanceResponse = await anchorService.getDepositAccountBalance(
					wallet.walletId,
				);
				if (balanceResponse.success) {
					balance = balanceResponse.balance;
					wallet.balance = balance;
					await wallet.save();
				}
			}
		} catch (err) {
			console.log("⚠️ Could not fetch real-time balance:", err.message);
		}

		const responseData = {
			success: true,
			balance: balance,
			available: balance,
			currency: "NGN",
			walletId: wallet.walletId,
			walletName: wallet.name,
			accountNumber:
				virtualAccounts[0]?.accountNumber || wallet.accountNumber || null,
			bankName: virtualAccounts[0]?.bankName || wallet.bankName || null,
			anchorCustomerId: wallet.anchorCustomerId,
			isLocal: wallet.isLocal || false,
		};

		res.status(200).json(responseData);
	} catch (error) {
		console.error("Get balance error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
		});
	}
};

/**
 * Refresh wallet balance
 */
export const refreshBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		// Get fresh balance from Anchor
		if (!wallet.isLocal) {
			try {
				const balanceResponse = await anchorService.getDepositAccountBalance(
					wallet.walletId,
				);
				if (balanceResponse.success) {
					wallet.balance = balanceResponse.balance;
					await wallet.save();
				}
			} catch (err) {
				console.log("⚠️ Could not fetch real-time balance:", err.message);
			}
		}

		res.status(200).json({
			success: true,
			balance: wallet.balance,
			currency: wallet.currency || "NGN",
		});
	} catch (error) {
		console.error("Refresh balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get USD wallet balance specifically
 */
export const getUSDWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;

		// For now, return USD balance from Bridgecard cards
		const BridgecardCard = await import("../models/BridgecardCard.js").then(
			(m) => m.default,
		);
		const usdCards = await BridgecardCard.find({
			userId,
			currency: "USD",
			status: "active",
		});

		const totalUSDBalance = usdCards.reduce(
			(sum, card) => sum + (card.balance || 0),
			0,
		);

		res.status(200).json({
			success: true,
			balance: totalUSDBalance,
			currency: "USD",
			cards: usdCards.length,
		});
	} catch (error) {
		console.error("Get USD balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get NGN wallet balance specifically
 */
export const getNGNWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;
		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });

		res.status(200).json({
			success: true,
			balance: wallet?.balance || 0,
			currency: "NGN",
		});
	} catch (error) {
		console.error("Get NGN balance error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * List all virtual accounts
 */
export const listVirtualAccounts = async (req, res) => {
	try {
		const userId = req.user._id;
		const accounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		res.status(200).json({
			success: true,
			accounts: accounts.map((acc) => ({
				id: acc._id,
				accountNumber: acc.accountNumber,
				bankName: acc.bankName,
				accountName: acc.accountName,
				provider: acc.provider || "anchor",
				currency: acc.currency || "NGN",
				isActive: acc.isActive,
				isMock: acc.isMock || false,
			})),
			count: accounts.length,
		});
	} catch (error) {
		console.error("List virtual accounts error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Top up wallet
 */
export const topupWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { amount, currency = "NGN" } = req.body;

		console.log("🔵 Topup request:", { userId, amount, currency });

		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid amount",
				message: "Amount must be greater than 0",
			});
		}

		if (amount < 100) {
			return res.status(400).json({
				success: false,
				error: "Minimum amount is ₦100",
				message: "Please enter a valid amount",
			});
		}

		// Get wallet
		const wallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
				message: "Please create a wallet first",
				requiresWalletCreation: true,
			});
		}

		// For sandbox, simulate successful topup
		const isSandbox = process.env.NODE_ENV !== "production" || true;
		const reference = `TOPUP_${Date.now()}_${userId.toString().slice(-6)}`;

		// Create a transaction record
		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount,
			currency: currency,
			type: "credit",
			category: "deposit",
			status: isSandbox ? "success" : "pending",
			description: `Wallet top-up of ${currency} ${amount}`,
			source: "manual",
			destination: "wallet",
			metadata: {
				reference,
				isSandbox,
				simulated: isSandbox,
				timestamp: new Date().toISOString(),
			},
		});

		// Update wallet balance immediately in sandbox
		if (isSandbox) {
			wallet.balance += amount;
			await wallet.save();
			console.log(
				`✅ Sandbox topup: +${amount}, new balance: ${wallet.balance}`,
			);
		}

		// Send notification
		await sendPushToUser(
			userId,
			"💰 Wallet Funded",
			`${currency} ${amount.toLocaleString()} has been added to your wallet.`,
			{
				type: "wallet_funded",
				amount,
				currency,
				reference,
				isSandbox,
			},
		);

		console.log("✅ Topup processed:", {
			reference,
			amount,
			newBalance: wallet.balance,
		});

		res.status(200).json({
			success: true,
			message: isSandbox
				? "Wallet topped up successfully (sandbox)"
				: "Topup initiated",
			reference,
			transactionId: transaction._id,
			fee: 0,
			totalToCharge: amount,
			newBalance: wallet.balance,
			isSandbox,
		});
	} catch (error) {
		console.error("❌ Topup wallet error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to process topup request",
		});
	}
};

/**
 * Verify topup
 */
export const verifyTopup = async (req, res) => {
	try {
		const userId = req.user._id;
		const { reference } = req.query;

		if (!reference) {
			return res.status(400).json({
				success: false,
				error: "Reference is required",
			});
		}

		// Find transaction
		const transaction = await AnchorTransaction.findOne({
			userId,
			"metadata.reference": reference,
		});

		if (!transaction) {
			return res.status(404).json({
				success: false,
				error: "Transaction not found",
			});
		}

		// If already successful, return
		if (transaction.status === "success") {
			return res.status(200).json({
				success: true,
				message: "Transaction already verified",
				transaction,
				newBalance: transaction.amount,
			});
		}

		// Update transaction status
		transaction.status = "success";
		await transaction.save();

		// Update wallet balance if not already updated
		const wallet = await AnchorWallet.findById(transaction.walletId);
		if (wallet) {
			wallet.balance += transaction.amount;
			await wallet.save();
		}

		await sendPushToUser(
			userId,
			"✅ Payment Verified",
			`Your topup of ${transaction.currency} ${transaction.amount.toLocaleString()} has been verified.`,
			{
				type: "topup_verified",
				amount: transaction.amount,
				currency: transaction.currency,
				reference,
			},
		);

		res.status(200).json({
			success: true,
			message: "Payment verified successfully",
			transaction,
			newBalance: wallet?.balance || 0,
		});
	} catch (error) {
		console.error("Verify topup error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Withdraw to bank account
 */
export const withdrawToBank = async (req, res) => {
	try {
		const userId = req.user._id;
		const { bankAccountId, amount } = req.body;

		if (!bankAccountId || !amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid request parameters",
			});
		}

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

		// Deduct from wallet (sandbox)
		wallet.balance -= amount;
		await wallet.save();

		const reference = `WITHDRAW_${Date.now()}_${userId.toString().slice(-6)}`;

		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount,
			currency: "NGN",
			type: "debit",
			category: "withdrawal",
			status: "success",
			description: `Withdrawal to bank account`,
			source: "wallet",
			destination: "bank",
			metadata: {
				bankAccountId,
				reference,
				isSandbox: true,
				timestamp: new Date().toISOString(),
			},
		});

		res.status(200).json({
			success: true,
			message: "Withdrawal successful",
			reference,
			transactionId: transaction._id,
			newBalance: wallet.balance,
			fee: 0,
			amountSent: amount,
		});
	} catch (error) {
		console.error("Withdraw error:", error);
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

// backend/controllers/walletController.js - Additional functions

/**
 * Freeze wallet
 */
export const freezeWallet = async (req, res) => {
	try {
		const userId = req.user._id;
		const { reason = "User requested freeze" } = req.body;

		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		if (wallet.status === "frozen") {
			return res.status(400).json({
				success: false,
				error: "Wallet is already frozen",
			});
		}

		wallet.status = "frozen";
		wallet.frozenAt = new Date();
		wallet.frozenReason = reason;
		await wallet.save();

		await sendPushToUser(
			userId,
			"🔒 Wallet Frozen",
			"Your wallet has been frozen for security reasons.",
			{ type: "wallet_frozen", reason },
		);

		res.status(200).json({
			success: true,
			message: "Wallet frozen successfully",
			wallet: {
				id: wallet._id,
				status: wallet.status,
				frozenAt: wallet.frozenAt,
				frozenReason: wallet.frozenReason,
			},
		});
	} catch (error) {
		console.error("Freeze wallet error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Unfreeze wallet
 */
export const unfreezeWallet = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		if (wallet.status !== "frozen") {
			return res.status(400).json({
				success: false,
				error: "Wallet is not frozen",
			});
		}

		wallet.status = "active";
		wallet.frozenAt = null;
		wallet.frozenReason = null;
		await wallet.save();

		await sendPushToUser(
			userId,
			"🔓 Wallet Unfrozen",
			"Your wallet has been unfrozen.",
			{ type: "wallet_unfrozen" },
		);

		res.status(200).json({
			success: true,
			message: "Wallet unfrozen successfully",
			wallet: {
				id: wallet._id,
				status: wallet.status,
			},
		});
	} catch (error) {
		console.error("Unfreeze wallet error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get wallet statistics
 */
export const getWalletStats = async (req, res) => {
	try {
		const userId = req.user._id;

		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const stats = await AnchorTransaction.aggregate([
			{ $match: { userId, createdAt: { $gte: thirtyDaysAgo } } },
			{
				$group: {
					_id: null,
					totalIncome: {
						$sum: { $cond: [{ $eq: ["$type", "credit"] }, "$amount", 0] },
					},
					totalExpenses: {
						$sum: { $cond: [{ $eq: ["$type", "debit"] }, "$amount", 0] },
					},
					transactionCount: { $sum: 1 },
					uniqueCategories: { $addToSet: "$category" },
				},
			},
		]);

		const result =
			stats.length > 0
				? stats[0]
				: {
						totalIncome: 0,
						totalExpenses: 0,
						transactionCount: 0,
						uniqueCategories: [],
					};

		res.status(200).json({
			success: true,
			stats: {
				balance: wallet.balance,
				totalIncome: result.totalIncome,
				totalExpenses: result.totalExpenses,
				netChange: result.totalIncome - result.totalExpenses,
				transactionCount: result.transactionCount,
				categories: result.uniqueCategories.length,
				currency: wallet.currency,
			},
		});
	} catch (error) {
		console.error("Get wallet stats error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get wallet activity timeline
 */
export const getWalletActivity = async (req, res) => {
	try {
		const userId = req.user._id;
		const { days = 7, type = "all" } = req.query;

		const sinceDate = new Date();
		sinceDate.setDate(sinceDate.getDate() - parseInt(days));

		const matchQuery = {
			userId,
			createdAt: { $gte: sinceDate },
		};

		if (type !== "all") {
			matchQuery.type = type === "income" ? "credit" : "debit";
		}

		const transactions = await AnchorTransaction.find(matchQuery)
			.sort({ createdAt: -1 })
			.lean();

		// Group by day
		const grouped = transactions.reduce((acc, tx) => {
			const date = tx.createdAt.toISOString().split("T")[0];
			if (!acc[date]) {
				acc[date] = {
					date,
					income: 0,
					expenses: 0,
					count: 0,
					transactions: [],
				};
			}
			if (tx.type === "credit") {
				acc[date].income += tx.amount;
			} else {
				acc[date].expenses += tx.amount;
			}
			acc[date].count++;
			acc[date].transactions.push(tx);
			return acc;
		}, {});

		const activity = Object.values(grouped).sort((a, b) =>
			a.date.localeCompare(b.date),
		);

		res.status(200).json({
			success: true,
			activity,
			summary: {
				totalDays: activity.length,
				totalIncome: activity.reduce((sum, d) => sum + d.income, 0),
				totalExpenses: activity.reduce((sum, d) => sum + d.expenses, 0),
			},
		});
	} catch (error) {
		console.error("Get wallet activity error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Export transactions (CSV/PDF)
 */
export const exportTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { format = "csv", startDate, endDate } = req.query;

		const query = { userId };
		if (startDate && endDate) {
			query.createdAt = {
				$gte: new Date(startDate),
				$lte: new Date(endDate),
			};
		}

		const transactions = await AnchorTransaction.find(query)
			.sort({ createdAt: -1 })
			.lean();

		if (format === "csv") {
			// Generate CSV
			const headers =
				"Date,Amount,Type,Category,Description,Status,Reference\n";
			const rows = transactions
				.map(
					(tx) =>
						`${tx.createdAt.toISOString().split("T")[0]},${tx.amount},${tx.type},${tx.category},${tx.description},${tx.status},${tx.metadata?.reference || ""}`,
				)
				.join("\n");

			res.setHeader("Content-Type", "text/csv");
			res.setHeader(
				"Content-Disposition",
				`attachment; filename=transactions_${Date.now()}.csv`,
			);
			res.status(200).send(headers + rows);
		} else {
			// Return JSON
			res.status(200).json({
				success: true,
				count: transactions.length,
				transactions,
			});
		}
	} catch (error) {
		console.error("Export transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get wallet statement (monthly summary)
 */
export const getWalletStatement = async (req, res) => {
	try {
		const userId = req.user._id;
		const { month, year } = req.query;

		const targetMonth = month ? parseInt(month) : new Date().getMonth();
		const targetYear = year ? parseInt(year) : new Date().getFullYear();

		const startDate = new Date(targetYear, targetMonth, 1);
		const endDate = new Date(targetYear, targetMonth + 1, 1);

		const transactions = await AnchorTransaction.find({
			userId,
			createdAt: { $gte: startDate, $lt: endDate },
		})
			.sort({ createdAt: 1 })
			.lean();

		const summary = transactions.reduce(
			(acc, tx) => {
				if (tx.type === "credit") {
					acc.totalIncome += tx.amount;
				} else {
					acc.totalExpenses += tx.amount;
				}
				acc.transactionCount++;
				return acc;
			},
			{ totalIncome: 0, totalExpenses: 0, transactionCount: 0 },
		);

		// Group by category
		const byCategory = transactions.reduce((acc, tx) => {
			const category = tx.category || "uncategorized";
			if (!acc[category]) {
				acc[category] = { income: 0, expenses: 0, count: 0 };
			}
			if (tx.type === "credit") {
				acc[category].income += tx.amount;
			} else {
				acc[category].expenses += tx.amount;
			}
			acc[category].count++;
			return acc;
		}, {});

		res.status(200).json({
			success: true,
			statement: {
				month: targetMonth + 1,
				year: targetYear,
				summary,
				byCategory,
				transactions,
				openingBalance: transactions[0]?.openingBalance || 0,
				closingBalance:
					transactions[transactions.length - 1]?.closingBalance || 0,
			},
		});
	} catch (error) {
		console.error("Get wallet statement error:", error);
		res.status(500).json({ error: error.message });
	}
};

/**
 * Get transaction by ID
 */
export const getWalletTransactionById = async (req, res) => {
	try {
		const userId = req.user._id;
		const { id } = req.params;

		const transaction = await AnchorTransaction.findOne({ _id: id, userId });
		if (!transaction) {
			return res.status(404).json({
				success: false,
				error: "Transaction not found",
			});
		}

		res.status(200).json({
			success: true,
			transaction,
		});
	} catch (error) {
		console.error("Get transaction error:", error);
		res.status(500).json({ error: error.message });
	}
};
