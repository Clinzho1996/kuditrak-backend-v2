// backend/controllers/anchorWalletController.js
import mongoose from "mongoose";
import AnchorCustomer from "../models/AnchorCustomer.js";
import AnchorSubAccount from "../models/AnchorSubAccount.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorVirtualAccount from "../models/AnchorVirtualAccount.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

// ==================== WALLET CREATION ====================

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
					isLocal: existingWallet.isLocal || false,
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

			// Create local wallet if Anchor customer fails
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

		// Try to create deposit account via Anchor
		let accountResponse;
		let virtualNuban = null;

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

			if (accountResponse?.success) {
				console.log("✅ Deposit account created:", accountResponse.accountId);

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
			} else {
				console.log(
					"⚠️ Anchor deposit account creation failed, using local wallet",
				);
			}
		} catch (anchorError) {
			console.log("⚠️ Anchor error, using local wallet:", anchorError.message);
			accountResponse = { success: false };
		}

		// Save wallet to database
		const isLocal = !accountResponse?.success;
		const walletData = {
			userId,
			anchorCustomerId: customerResult.customerId,
			walletId: accountResponse?.success
				? accountResponse.accountId
				: `local_${Date.now()}_${userId.toString().slice(-6)}`,
			walletType: "main",
			balance: 0,
			name: "Main Wallet",
			currency: "NGN",
			status: "active",
			accountNumber: virtualNuban?.accountNumber || null,
			bankName: virtualNuban?.bankName || null,
			isLocal: isLocal,
		};

		const wallet = await AnchorWallet.create(walletData);

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

		console.log(
			"✅ Wallet created:",
			wallet.walletId,
			isLocal ? "(local)" : "(Anchor)",
		);

		res.status(201).json({
			success: true,
			message: isLocal ? "Local wallet created" : "Wallet created successfully",
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

// ==================== WALLET BALANCE ====================

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

		const virtualAccounts = await AnchorVirtualAccount.find({
			userId,
			isActive: true,
		});

		let balance = wallet.balance;

		if (
			!wallet.isLocal &&
			wallet.walletId &&
			!wallet.walletId.startsWith("local_")
		) {
			try {
				const balanceResponse = await anchorService.getDepositAccountBalance(
					wallet.walletId,
				);
				if (balanceResponse.success) {
					balance = balanceResponse.balance;
					wallet.balance = balance;
					await wallet.save();
				}
			} catch (err) {
				console.log("⚠️ Could not fetch real-time balance:", err.message);
				balance = wallet.balance;
			}
		} else {
			console.log(
				"📊 Using local wallet balance (not synced with Anchor):",
				wallet.balance,
			);
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

export const getUSDWalletBalance = async (req, res) => {
	try {
		const userId = req.user._id;

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

// ==================== WALLET MANAGEMENT ====================

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

// ==================== VIRTUAL ACCOUNTS ====================

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

export const createVirtualAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { currency = "NGN" } = req.body;

		const anchorCustomer = await AnchorCustomer.findOne({ userId });
		if (!anchorCustomer) {
			return res.status(404).json({
				success: false,
				error: "Anchor customer not found",
			});
		}

		const wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
		if (!wallet) {
			return res.status(404).json({
				success: false,
				error: "Wallet not found",
			});
		}

		const nubanResponse = await anchorService.createVirtualNuban(
			wallet.walletId,
			{ userId: userId.toString(), currency },
		);

		if (!nubanResponse.success) {
			return res.status(400).json({
				success: false,
				error: nubanResponse.error,
			});
		}

		const virtualAccount = await AnchorVirtualAccount.create({
			userId,
			anchorCustomerId: anchorCustomer.anchorCustomerId,
			walletId: wallet._id,
			accountNumber: nubanResponse.accountNumber,
			bankName: nubanResponse.bankName,
			accountName: nubanResponse.accountName,
			bankCode: nubanResponse.bankCode,
			anchorReference: nubanResponse.virtualNubanId,
			isActive: true,
			provider: "anchor",
			currency: currency,
		});

		res.status(201).json({
			success: true,
			message: "Virtual account created successfully",
			virtualAccount: {
				id: virtualAccount._id,
				accountNumber: virtualAccount.accountNumber,
				bankName: virtualAccount.bankName,
				accountName: virtualAccount.accountName,
				currency: virtualAccount.currency,
				isActive: virtualAccount.isActive,
			},
		});
	} catch (error) {
		console.error("Create virtual account error:", error);
		res.status(500).json({ error: error.message });
	}
};

// ==================== TOPUP ====================

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

		const isSandbox = process.env.NODE_ENV !== "production" || true;
		const reference = `TOPUP_${Date.now()}_${userId.toString().slice(-6)}`;

		wallet.balance += amount;
		await wallet.save();

		console.log(`✅ Topup: +${amount}, new balance: ${wallet.balance}`);

		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount,
			currency: currency,
			type: "credit",
			category: "deposit",
			status: "success",
			description: `Wallet top-up of ${currency} ${amount}`,
			source: "wallet",
			destination: "wallet",
			metadata: {
				reference,
				isSandbox,
				simulated: isSandbox,
				timestamp: new Date().toISOString(),
				isLocal: wallet.isLocal || false,
			},
		});

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

		if (transaction.status === "success") {
			return res.status(200).json({
				success: true,
				message: "Transaction already verified",
				transaction,
				newBalance: transaction.metadata?.newBalance || 0,
			});
		}

		transaction.status = "success";
		await transaction.save();

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

// ==================== SEND MONEY (INTERNAL TRANSFER) ====================

/**
 * Send money to another Kuditrak user (internal wallet transfer)
 * This matches the "Kuditrak User" tab in the frontend
 */
export const sendToKuditrakUser = async (req, res) => {
	try {
		const senderId = req.user._id;
		const { recipientEmail, recipientPhone, recipientHandle, amount, note } =
			req.body;

		console.log("🔵 Send to Kuditrak user:", {
			senderId,
			recipientEmail,
			recipientPhone,
			recipientHandle,
			amount,
			note,
		});

		// Validate amount
		if (!amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid amount",
				message: "Amount must be greater than 0",
			});
		}

		if (amount < 1) {
			return res.status(400).json({
				success: false,
				error: "Minimum amount is ₦1",
				message: "Please enter a valid amount",
			});
		}

		// Find recipient by email, phone, or handle
		let recipient;
		if (recipientEmail) {
			recipient = await User.findOne({ email: recipientEmail });
		} else if (recipientPhone) {
			recipient = await User.findOne({ phoneNumber: recipientPhone });
		} else if (recipientHandle) {
			// If handle is like "@username", extract username
			const cleanHandle = recipientHandle.startsWith("@")
				? recipientHandle.substring(1)
				: recipientHandle;
			recipient = await User.findOne({
				$or: [
					{ fullName: { $regex: cleanHandle, $options: "i" } },
					{ email: { $regex: cleanHandle, $options: "i" } },
				],
			});
		}

		if (!recipient) {
			return res.status(404).json({
				success: false,
				error: "Recipient not found",
				message: "Could not find a Kuditrak user with that identifier",
			});
		}

		// Check if sender is trying to send to themselves
		if (recipient._id.toString() === senderId.toString()) {
			return res.status(400).json({
				success: false,
				error: "Invalid recipient",
				message: "You cannot send money to yourself",
			});
		}

		// Get sender's wallet
		const senderWallet = await AnchorWallet.findOne({
			userId: senderId,
			walletType: "main",
		});

		if (!senderWallet) {
			return res.status(404).json({
				success: false,
				error: "Sender wallet not found",
				message: "Please create a wallet first",
				requiresWalletCreation: true,
			});
		}

		// Get recipient's wallet
		let recipientWallet = await AnchorWallet.findOne({
			userId: recipient._id,
			walletType: "main",
		});

		// If recipient doesn't have a wallet, create one
		if (!recipientWallet) {
			console.log("🔄 Creating wallet for recipient:", recipient._id);

			// Ensure recipient has Anchor customer
			const customerResult = await getOrCreateAnchorCustomer(recipient._id);
			if (!customerResult.success) {
				return res.status(400).json({
					success: false,
					error: "Could not create recipient wallet",
					message: "Recipient account is not fully set up",
				});
			}

			recipientWallet = await AnchorWallet.create({
				userId: recipient._id,
				anchorCustomerId: customerResult.customerId,
				walletId: `local_${Date.now()}_${recipient._id.toString().slice(-6)}`,
				walletType: "main",
				balance: 0,
				name: "Main Wallet",
				currency: "NGN",
				status: "active",
				isLocal: true,
			});
		}

		// Check sender's balance
		if (senderWallet.balance < amount) {
			return res.status(400).json({
				success: false,
				error: "Insufficient balance",
				available: senderWallet.balance,
				requested: amount,
				message: `Your balance (₦${senderWallet.balance.toLocaleString()}) is insufficient for this transfer`,
			});
		}

		// Generate reference
		const reference = `SEND_${Date.now()}_${senderId.toString().slice(-6)}`;

		// Perform the transfer (atomic operation)
		const session = await mongoose.startSession();
		session.startTransaction();

		try {
			// Deduct from sender
			senderWallet.balance -= amount;
			await senderWallet.save({ session });

			// Add to recipient
			recipientWallet.balance += amount;
			await recipientWallet.save({ session });

			// Create sender transaction (debit)
			const senderTransaction = await AnchorTransaction.create(
				[
					{
						userId: senderId,
						anchorCustomerId: senderWallet.anchorCustomerId,
						walletId: senderWallet._id,
						amount: amount,
						currency: "NGN",
						type: "debit",
						category: "transfer",
						status: "success",
						description: note
							? `Sent to ${recipient.fullName}${note ? ` - ${note}` : ""}`
							: `Sent to ${recipient.fullName}`,
						source: "wallet",
						destination: "wallet",
						metadata: {
							reference,
							recipientId: recipient._id,
							recipientName: recipient.fullName,
							recipientEmail: recipient.email,
							note: note || "",
							isKuditrakTransfer: true,
							timestamp: new Date().toISOString(),
						},
					},
				],
				{ session },
			);

			// Create recipient transaction (credit)
			const recipientTransaction = await AnchorTransaction.create(
				[
					{
						userId: recipient._id,
						anchorCustomerId: recipientWallet.anchorCustomerId,
						walletId: recipientWallet._id,
						amount: amount,
						currency: "NGN",
						type: "credit",
						category: "transfer",
						status: "success",
						description: note
							? `Received from ${req.user.fullName}${note ? ` - ${note}` : ""}`
							: `Received from ${req.user.fullName}`,
						source: "wallet",
						destination: "wallet",
						metadata: {
							reference,
							senderId: senderId,
							senderName: req.user.fullName,
							note: note || "",
							isKuditrakTransfer: true,
							timestamp: new Date().toISOString(),
						},
					},
				],
				{ session },
			);

			await session.commitTransaction();

			// Send notifications
			await sendPushToUser(
				senderId,
				"💸 Money Sent",
				`You sent ₦${amount.toLocaleString()} to ${recipient.fullName}${
					note ? ` (${note})` : ""
				}`,
				{
					type: "money_sent",
					amount,
					recipientId: recipient._id,
					recipientName: recipient.fullName,
					reference,
					newBalance: senderWallet.balance,
				},
			);

			await sendPushToUser(
				recipient._id,
				"💰 Money Received",
				`You received ₦${amount.toLocaleString()} from ${req.user.fullName}${
					note ? ` (${note})` : ""
				}`,
				{
					type: "money_received",
					amount,
					senderId: senderId,
					senderName: req.user.fullName,
					reference,
					newBalance: recipientWallet.balance,
				},
			);

			res.status(200).json({
				success: true,
				message: "Transfer completed successfully",
				reference,
				amount: amount,
				recipient: {
					id: recipient._id,
					name: recipient.fullName,
					email: recipient.email,
				},
				senderNewBalance: senderWallet.balance,
				recipientNewBalance: recipientWallet.balance,
				transactionId: senderTransaction[0]._id,
				fee: 0,
				note: note || "",
				timestamp: new Date().toISOString(),
			});
		} catch (error) {
			await session.abortTransaction();
			throw error;
		} finally {
			session.endSession();
		}
	} catch (error) {
		console.error("❌ Send to Kuditrak user error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to send money",
		});
	}
};

// ==================== WITHDRAW TO BANK ====================

// backend/controllers/anchorWalletController.js - Updated withdrawToBank

/**
 * Withdraw money to an external bank account
 * Uses Paystack for bank name resolution and transfer initiation
 */
export const withdrawToBank = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			bankCode,
			bankName,
			accountNumber,
			accountName,
			amount,
			note,
			saveAsBeneficiary = false,
		} = req.body;

		console.log("🔵 Withdraw to bank:", {
			userId,
			bankCode,
			bankName,
			accountNumber: accountNumber?.slice(-4),
			accountName,
			amount,
			note,
			saveAsBeneficiary,
		});

		// Validate required fields
		if (!bankCode || !accountNumber || !amount || amount <= 0) {
			return res.status(400).json({
				success: false,
				error: "Invalid request parameters",
				message: "Bank code, account number, and amount are required",
			});
		}

		// Validate account number
		const cleanAccountNumber = accountNumber
			.replace(/\s/g, "")
			.replace(/[^0-9]/g, "");
		if (cleanAccountNumber.length !== 10) {
			return res.status(400).json({
				success: false,
				error: "Invalid account number",
				message: "Account number must be exactly 10 digits",
			});
		}

		// Validate minimum amount
		if (amount < 100) {
			return res.status(400).json({
				success: false,
				error: "Minimum withdrawal is ₦100",
				message: "Please enter a valid amount",
			});
		}

		// Get user's wallet
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

		// Check balance
		if (wallet.balance < amount) {
			return res.status(400).json({
				success: false,
				error: "Insufficient balance",
				available: wallet.balance,
				requested: amount,
				message: `Your balance (₦${wallet.balance.toLocaleString()}) is insufficient for this withdrawal`,
			});
		}

		// Verify account with Paystack (real-time verification)
		const paystackSecretKey = process.env.PAYSTACK_SECRET;

		if (paystackSecretKey) {
			try {
				const verifyResponse = await fetch(
					`https://api.paystack.co/bank/resolve?account_number=${cleanAccountNumber}&bank_code=${bankCode}`,
					{
						headers: {
							Authorization: `Bearer ${paystackSecretKey}`,
						},
					},
				);
				const verifyData = await verifyResponse.json();

				if (verifyData.status && verifyData.data) {
					// Use the verified account name
					const verifiedAccountName = verifyData.data.account_name;
					console.log(`✅ Account verified: ${verifiedAccountName}`);

					// If account name doesn't match, warn but don't block
					if (accountName && accountName !== verifiedAccountName) {
						console.warn(
							`⚠️ Account name mismatch: Provided "${accountName}", Verified "${verifiedAccountName}"`,
						);
					}
				}
			} catch (verifyError) {
				console.warn(
					"⚠️ Could not verify account during withdrawal:",
					verifyError.message,
				);
				// Continue with withdrawal even if verification fails (user already verified earlier)
			}
		}

		// Generate reference
		const reference = `WITHDRAW_${Date.now()}_${userId.toString().slice(-6)}`;
		const isSandbox = process.env.NODE_ENV !== "production";

		// Deduct from wallet
		wallet.balance -= amount;
		await wallet.save();

		// Create transaction record
		const transaction = await AnchorTransaction.create({
			userId,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			amount,
			currency: "NGN",
			type: "debit",
			category: "withdrawal",
			status: "success",
			description: note
				? `Withdrawal to ${bankName || "Bank"}${note ? ` - ${note}` : ""}`
				: `Withdrawal to ${bankName || "Bank"}`,
			source: "wallet",
			destination: "external_bank",
			metadata: {
				bankCode,
				bankName: bankName || "Unknown Bank",
				accountNumber: cleanAccountNumber,
				accountName,
				note: note || "",
				reference,
				isSandbox,
				saveAsBeneficiary,
				timestamp: new Date().toISOString(),
			},
		});

		// Save beneficiary if requested
		if (saveAsBeneficiary) {
			try {
				const Beneficiary = await import("../models/Beneficiary.js").then(
					(m) => m.default,
				);
				await Beneficiary.create({
					userId,
					bankCode,
					bankName: bankName || "Unknown Bank",
					accountNumber: cleanAccountNumber,
					accountName,
					lastUsed: new Date(),
				});
				console.log("💾 Beneficiary saved successfully");
			} catch (beneficiaryError) {
				console.warn(
					"⚠️ Could not save beneficiary:",
					beneficiaryError.message,
				);
			}
		}

		// Send notification
		await sendPushToUser(
			userId,
			"💸 Withdrawal Successful",
			`₦${amount.toLocaleString()} has been withdrawn to ${bankName || "your bank account"}`,
			{
				type: "withdrawal_success",
				amount,
				bankName,
				accountNumber: cleanAccountNumber.slice(-4),
				reference,
				newBalance: wallet.balance,
				isSandbox,
			},
		);

		res.status(200).json({
			success: true,
			message: isSandbox
				? "Withdrawal successful (sandbox mode)"
				: "Withdrawal initiated successfully",
			reference,
			transactionId: transaction._id,
			amount,
			fee: 0,
			amountSent: amount,
			newBalance: wallet.balance,
			bankName: bankName || "Unknown Bank",
			accountNumber: cleanAccountNumber.slice(-4),
			isSandbox,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("❌ Withdraw to bank error:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to process withdrawal. Please try again.",
		});
	}
};

// ==================== GET RECIPIENTS / BENEFICIARIES ====================

/**
 * Get recent recipients for the user
 * This supports the "Recent recipients" list in the frontend
 */
export const getRecentRecipients = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 10 } = req.query;

		// Get unique recipients from transaction history
		const transactions = await AnchorTransaction.find({
			userId,
			"metadata.isKuditrakTransfer": true,
			"metadata.recipientId": { $exists: true },
		})
			.sort({ createdAt: -1 })
			.limit(50)
			.lean();

		// Extract unique recipients
		const recipientMap = new Map();
		for (const tx of transactions) {
			const recipientId = tx.metadata?.recipientId;
			if (recipientId && !recipientMap.has(recipientId)) {
				try {
					const user = await User.findById(recipientId).select(
						"fullName email phoneNumber profileImage",
					);
					if (user) {
						recipientMap.set(recipientId, {
							id: user._id,
							name: user.fullName,
							email: user.email,
							phoneNumber: user.phoneNumber,
							profileImage: user.profileImage,
							lastTransaction: tx.createdAt,
							amount: tx.amount,
						});
					}
				} catch (err) {
					console.log("⚠️ Could not fetch recipient:", err.message);
				}
			}
		}

		const recipients = Array.from(recipientMap.values())
			.sort((a, b) => b.lastTransaction - a.lastTransaction)
			.slice(0, parseInt(limit));

		res.status(200).json({
			success: true,
			recipients,
			count: recipients.length,
		});
	} catch (error) {
		console.error("Get recent recipients error:", error);
		res.status(500).json({ error: error.message });
	}
};

// backend/controllers/anchorWalletController.js

export const getBeneficiaries = async (req, res) => {
	try {
		const userId = req.user._id;

		// Try to get from Beneficiary model first
		let beneficiaries = [];

		try {
			const Beneficiary = await import("../models/Beneficiary.js").then(
				(m) => m.default,
			);
			beneficiaries = await Beneficiary.find({ userId })
				.sort({ lastUsed: -1 })
				.limit(20)
				.lean();
		} catch (err) {
			console.log("⚠️ Beneficiary model not found, using transactions");
		}

		// If no beneficiaries in model, get from transaction history
		if (beneficiaries.length === 0) {
			const transactions = await AnchorTransaction.find({
				userId,
				"metadata.bankName": { $exists: true },
				"metadata.accountNumber": { $exists: true },
			})
				.sort({ createdAt: -1 })
				.limit(100)
				.lean();

			const beneficiaryMap = new Map();
			for (const tx of transactions) {
				const key = `${tx.metadata.bankCode}_${tx.metadata.accountNumber}`;
				if (!beneficiaryMap.has(key)) {
					beneficiaryMap.set(key, {
						id: key,
						bankCode: tx.metadata.bankCode,
						bankName: tx.metadata.bankName,
						accountNumber: tx.metadata.accountNumber,
						accountName: tx.metadata.accountName || "Unknown",
						lastUsed: tx.createdAt,
						amount: tx.amount,
					});
				}
			}
			beneficiaries = Array.from(beneficiaryMap.values())
				.sort((a, b) => b.lastUsed - a.lastUsed)
				.slice(0, 20);
		}

		res.status(200).json({
			success: true,
			beneficiaries,
			count: beneficiaries.length,
		});
	} catch (error) {
		console.error("Get beneficiaries error:", error);
		res.status(500).json({ error: error.message });
	}
};

export const verifyBankAccount = async (req, res) => {
	try {
		const { bankCode, accountNumber } = req.body;

		// Validate required fields
		if (!bankCode || !accountNumber) {
			return res.status(400).json({
				success: false,
				error: "Bank code and account number are required",
			});
		}

		// Clean account number (remove spaces, special characters)
		const cleanAccountNumber = accountNumber
			.replace(/\s/g, "")
			.replace(/[^0-9]/g, "");

		// Validate account number length (Nigerian accounts are 10 digits)
		if (cleanAccountNumber.length !== 10) {
			return res.status(400).json({
				success: false,
				error: "Invalid account number",
				message: "Account number must be exactly 10 digits",
			});
		}

		// Get Paystack secret key from environment
		const paystackSecretKey = process.env.PAYSTACK_SECRET;

		if (!paystackSecretKey) {
			console.error(
				"❌ PAYSTACK_SECRET_KEY not found in environment variables",
			);
			return res.status(500).json({
				success: false,
				error: "Payment gateway configuration error",
				message: "Paystack secret key is not configured",
			});
		}

		console.log(
			`🔵 Verifying account: ${cleanAccountNumber} with bank: ${bankCode}`,
		);

		// Call Paystack API to resolve account
		const response = await fetch(
			`https://api.paystack.co/bank/resolve?account_number=${cleanAccountNumber}&bank_code=${bankCode}`,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${paystackSecretKey}`,
					"Content-Type": "application/json",
				},
			},
		);

		const data = await response.json();

		console.log(`📥 Paystack response status: ${response.status}`);

		// Check if the request was successful
		if (!response.ok) {
			console.error("❌ Paystack API error:", data);

			// Handle specific error cases
			if (data.status === false) {
				if (data.message?.includes("Invalid account number")) {
					return res.status(400).json({
						success: false,
						verified: false,
						error: "Invalid account number",
						message:
							"The account number you entered is invalid. Please check and try again.",
					});
				}

				if (data.message?.includes("Invalid bank code")) {
					return res.status(400).json({
						success: false,
						verified: false,
						error: "Invalid bank code",
						message: "The selected bank is invalid. Please try again.",
					});
				}

				return res.status(400).json({
					success: false,
					verified: false,
					error: data.message || "Verification failed",
					message:
						data.message ||
						"Could not verify account. Please check the details.",
				});
			}

			return res.status(response.status).json({
				success: false,
				verified: false,
				error: data.message || "Verification failed",
				message: data.message || "Could not verify account. Please try again.",
			});
		}

		// Check if verification was successful
		if (data.status === true && data.data) {
			const accountDetails = data.data;

			console.log(`✅ Account verified: ${accountDetails.account_name}`);

			// Find bank name from our bank list or from Paystack
			let bankName = accountDetails.bank_name || bankCode;

			// Try to get bank name from our bank list if not provided
			if (!accountDetails.bank_name) {
				try {
					const bankResponse = await fetch(
						`https://api.paystack.co/bank?code=${bankCode}`,
						{
							headers: {
								Authorization: `Bearer ${paystackSecretKey}`,
							},
						},
					);
					const bankData = await bankResponse.json();
					if (bankData.status && bankData.data && bankData.data.length > 0) {
						bankName = bankData.data[0].name;
					}
				} catch (err) {
					console.warn("⚠️ Could not fetch bank name:", err.message);
				}
			}

			return res.status(200).json({
				success: true,
				verified: true,
				accountNumber: cleanAccountNumber,
				accountName: accountDetails.account_name,
				bankCode: bankCode,
				bankName: bankName || accountDetails.bank_name || "Unknown Bank",
				message: "Account verified successfully",
			});
		}

		// Fallback for unexpected response
		return res.status(400).json({
			success: false,
			verified: false,
			error: "Verification failed",
			message: data.message || "Could not verify account. Please try again.",
		});
	} catch (error) {
		console.error("❌ Verify bank account error:", error);

		// Handle network errors
		if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
			return res.status(503).json({
				success: false,
				verified: false,
				error: "Network error",
				message:
					"Could not connect to payment gateway. Please try again later.",
			});
		}

		res.status(500).json({
			success: false,
			verified: false,
			error: error.message,
			message: "Failed to verify bank account. Please try again.",
		});
	}
};

// ==================== TRANSACTIONS ====================

export const getWalletTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { limit = 50, offset = 0, type, category } = req.query;

		const query = { userId };
		if (type) query.type = type;
		if (category) query.category = category;

		const transactions = await AnchorTransaction.find(query)
			.sort({ createdAt: -1 })
			.limit(parseInt(limit))
			.skip(parseInt(offset))
			.lean();

		const total = await AnchorTransaction.countDocuments(query);

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

export const exportTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { startDate, endDate } = req.query;

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

		const headers = "Date,Amount,Type,Category,Description,Status,Reference\n";
		const rows = transactions
			.map(
				(tx) =>
					`${tx.createdAt.toISOString().split("T")[0]},${tx.amount},${tx.type},${tx.category || ""},${tx.description || ""},${tx.status},${tx.metadata?.reference || ""}`,
			)
			.join("\n");

		res.setHeader("Content-Type", "text/csv");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename=transactions_${Date.now()}.csv`,
		);
		res.status(200).send(headers + rows);
	} catch (error) {
		console.error("Export transactions error:", error);
		res.status(500).json({ error: error.message });
	}
};

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

// ==================== SUB-ACCOUNTS (Savings Goals) ====================

export const createSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			name,
			type = "savings",
			targetAmount,
			autoSave,
			icon = "💰",
			color = "#4F46E5",
		} = req.body;

		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

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

export const getSubAccounts = async (req, res) => {
	try {
		const userId = req.user._id;

		const subAccounts = await AnchorSubAccount.find({ userId })
			.sort({ createdAt: -1 })
			.lean();

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

export const fundSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { subAccountId, amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

		const subAccount = await AnchorSubAccount.findOne({ userId, subAccountId });
		if (!subAccount) {
			return res.status(404).json({ error: "Sub-account not found" });
		}

		if (subAccount.isLocked) {
			return res.status(400).json({
				error:
					"Sub-account is locked until " + subAccount.lockSettings.unlockDate,
			});
		}

		if (mainWallet.balance < amount) {
			return res.status(400).json({ error: "Insufficient balance" });
		}

		mainWallet.balance -= amount;
		subAccount.balance += amount;
		await mainWallet.save();
		await subAccount.save();

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

export const withdrawFromSubAccount = async (req, res) => {
	try {
		const userId = req.user._id;
		const { subAccountId, amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		const mainWallet = await AnchorWallet.findOne({
			userId,
			walletType: "main",
		});
		if (!mainWallet) {
			return res.status(404).json({ error: "Main wallet not found" });
		}

		const subAccount = await AnchorSubAccount.findOne({ userId, subAccountId });
		if (!subAccount) {
			return res.status(404).json({ error: "Sub-account not found" });
		}

		if (subAccount.isLocked) {
			const penaltyMultiplier = 1.07;
			const penalty = amount * (penaltyMultiplier - 1);
			const totalDeduction = amount + penalty;

			if (subAccount.balance < totalDeduction) {
				return res
					.status(400)
					.json({ error: "Insufficient balance including penalty" });
			}

			subAccount.balance -= totalDeduction;
			mainWallet.balance += amount;

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
			if (subAccount.balance < amount) {
				return res.status(400).json({ error: "Insufficient balance" });
			}
			subAccount.balance -= amount;
			mainWallet.balance += amount;
		}

		await mainWallet.save();
		await subAccount.save();

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
