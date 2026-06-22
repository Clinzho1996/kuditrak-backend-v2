import AnchorTransaction from "../models/AnchorTransaction.js";
import BankConnection from "../models/BankConnection.js";
import BridgecardCard from "../models/BridgecardCard.js";
import Budget from "../models/Budget.js";
import Category from "../models/Category.js";
import Transaction from "../models/Transaction.js";
import Wallet from "../models/Wallet.js";
import bridgecardService from "../services/bridgecardService.js";
import mono, { pullTransactionsFromMono } from "../services/monoService.js";
import { sendTransactionNotification } from "../services/notificationService.js";
import { checkLimits } from "../services/subscriptionService.js";

export const getAllTransactions = async (req, res) => {
	try {
		const userId = req.user._id;
		const { page = 1, limit = 50 } = req.query;

		const pageNum = parseInt(page);
		const limitNum = parseInt(limit);
		const skip = (pageNum - 1) * limitNum;

		let allTransactions = [];
		let sourceCounts = {
			wallet: 0,
			card: 0,
			manual: 0,
			bank: 0,
		};

		console.log(`📊 Fetching all transactions for user ${userId}`);

		// 1. Get Wallet Transactions (Anchor)
		try {
			const walletTransactions = await AnchorTransaction.find({ userId })
				.sort({ createdAt: -1 })
				.limit(limitNum)
				.skip(skip)
				.lean();

			console.log(`💰 Found ${walletTransactions.length} wallet transactions`);

			const formattedWallet = walletTransactions.map((tx) => ({
				...tx,
				source: "wallet",
				_id: tx._id,
				transactionId: tx._id,
				amount: tx.amount || 0,
				type: tx.type === "credit" ? "income" : "expense",
				description: tx.description || tx.narration || "Wallet transaction",
				createdAt: tx.createdAt,
				currency: tx.currency || "NGN",
				status: tx.status || "success",
			}));

			allTransactions = [...allTransactions, ...formattedWallet];
			sourceCounts.wallet = formattedWallet.length;
		} catch (err) {
			console.log("⚠️ Could not fetch wallet transactions:", err.message);
		}

		// 2. Get Card Transactions (Bridgecard)
		try {
			// Get all user's cards
			const cards = await BridgecardCard.find({
				userId,
				status: { $ne: "cancelled" },
			});

			console.log(`💳 Found ${cards.length} cards`);

			for (const card of cards) {
				if (!card.isAnchorCard && card.cardId) {
					try {
						const result = await bridgecardService.getCardTransactions(
							card.cardId,
							pageNum,
						);
						if (result.success && result.transactions) {
							const formattedCard = result.transactions.map((tx) => {
								let amount = tx.amount || 0;
								// Bridgecard returns amount in cents
								if (amount > 100) {
									amount = amount / 100;
								}

								return {
									...tx,
									source: "card",
									cardId: card.cardId,
									cardLast4: card.last4,
									cardName: card.metaData?.cardName || "Card",
									_id: tx.id || tx._id || `card_${Date.now()}_${Math.random()}`,
									transactionId: tx.id || tx._id || `card_${Date.now()}`,
									amount: amount,
									type: tx.type === "credit" ? "income" : "expense",
									description:
										tx.description || tx.merchantName || "Card transaction",
									createdAt:
										tx.createdAt || tx.date || new Date().toISOString(),
									currency: tx.currency || "USD",
									status: tx.status || "success",
								};
							});
							allTransactions = [...allTransactions, ...formattedCard];
							sourceCounts.card += formattedCard.length;
						}
					} catch (cardErr) {
						console.log(
							`⚠️ Could not fetch transactions for card ${card.cardId}:`,
							cardErr.message,
						);
					}
				}
			}
		} catch (err) {
			console.log("⚠️ Could not fetch card transactions:", err.message);
		}

		// 3. Get Manual Transactions (using the Transaction model)
		try {
			const manualTransactions = await Transaction.find({
				userId,
				source: "manual",
			})
				.sort({ date: -1 })
				.limit(limitNum)
				.skip(skip)
				.lean();

			console.log(`📝 Found ${manualTransactions.length} manual transactions`);

			const formattedManual = manualTransactions.map((tx) => ({
				...tx,
				source: "manual",
				_id: tx._id,
				transactionId: tx._id,
				amount: tx.amount || 0,
				type: tx.type === "income" ? "income" : "expense",
				description: tx.description || "Manual transaction",
				createdAt: tx.createdAt || tx.date || new Date().toISOString(),
				currency: tx.currency || "NGN",
				status: tx.status || "success",
			}));

			allTransactions = [...allTransactions, ...formattedManual];
			sourceCounts.manual = formattedManual.length;
		} catch (err) {
			console.log("⚠️ Could not fetch manual transactions:", err.message);
		}

		// 4. Get Bank Transactions (from the Transaction model with source: "bank")
		try {
			const bankTransactions = await Transaction.find({
				userId,
				source: "bank",
			})
				.sort({ date: -1 })
				.limit(limitNum)
				.skip(skip)
				.lean();

			console.log(`🏦 Found ${bankTransactions.length} bank transactions`);

			const formattedBank = bankTransactions.map((tx) => ({
				...tx,
				source: "bank",
				_id: tx._id,
				transactionId: tx._id,
				amount: tx.amount || 0,
				type: tx.type === "income" ? "income" : "expense",
				description: tx.description || tx.narration || "Bank transaction",
				createdAt: tx.createdAt || tx.date || new Date().toISOString(),
				currency: tx.currency || "NGN",
				status: tx.status || "success",
				bankName: tx.bankName || tx.metadata?.bankName,
				accountNumber: tx.accountNumber || tx.metadata?.accountNumber,
			}));

			allTransactions = [...allTransactions, ...formattedBank];
			sourceCounts.bank = formattedBank.length;
		} catch (err) {
			console.log("⚠️ Could not fetch bank transactions:", err.message);
		}

		// Deduplicate and sort
		const seen = new Set();
		const uniqueTransactions = allTransactions.filter((tx) => {
			const id = tx._id || tx.transactionId || tx.id;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});

		console.log(`📊 Total unique transactions: ${uniqueTransactions.length}`);

		// Sort by createdAt descending
		const sorted = uniqueTransactions.sort((a, b) => {
			const dateA = new Date(a.createdAt || a.date || 0);
			const dateB = new Date(b.createdAt || b.date || 0);
			return dateB.getTime() - dateA.getTime();
		});

		// Apply pagination to the combined result
		const paginated = sorted.slice(0, limitNum);

		res.status(200).json({
			success: true,
			transactions: paginated,
			total: sorted.length,
			page: pageNum,
			limit: limitNum,
			totalPages: Math.ceil(sorted.length / limitNum),
			hasMore: paginated.length < sorted.length,
			sources: sourceCounts,
		});
	} catch (error) {
		console.error("❌ Error fetching all transactions:", error);
		res.status(500).json({
			success: false,
			error: error.message,
			message: "Failed to fetch transactions",
		});
	}
};
// List all transactions
export const listTransactions = async (req, res) => {
	try {
		const transactions = await Transaction.find({ userId: req.user._id })
			.populate("categoryId", "name type")
			.sort({ date: -1 });

		res.status(200).json({ success: true, transactions });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const createTransaction = async (req, res) => {
	try {
		const { amount, type, description, categoryId, date } = req.body;

		console.log("=== CREATE TRANSACTION CONTROLLER ===");
		console.log("Request body:", req.body);
		console.log("User ID:", req.user?._id);

		// Validate required fields
		if (!amount || !type) {
			console.log("Missing required fields");
			return res.status(400).json({ error: "Amount and type are required" });
		}

		if (!["income", "expense"].includes(type)) {
			console.log("Invalid type:", type);
			return res.status(400).json({ error: "Invalid transaction type" });
		}

		// Check user
		if (!req.user || !req.user._id) {
			console.log("No user found");
			return res.status(401).json({ error: "Unauthorized: user missing" });
		}

		// Check limits
		try {
			await checkLimits(req.user._id, "manual_transaction");
		} catch (limitError) {
			console.log("Limit check failed:", limitError.message);
			return res.status(403).json({ error: limitError.message });
		}

		// Get category
		let categoryName = null;
		if (categoryId) {
			console.log("Looking for category:", categoryId);
			const category = await Category.findOne({
				_id: categoryId,
				userId: req.user._id,
			});

			if (!category) {
				console.log("Category not found:", categoryId);
				return res.status(400).json({ error: "Invalid category selected" });
			}

			categoryName = category.name;
			console.log("Found category:", categoryName);
		}

		// Create transaction
		const transactionId = `TRX-${req.user._id}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;

		console.log("Creating transaction with data:", {
			userId: req.user._id,
			amount: Number(amount),
			type,
			description,
			categoryId,
			categoryName,
			date: date ? new Date(date) : new Date(),
			transactionId,
		});

		const transaction = await Transaction.create({
			userId: req.user._id,
			amount: Number(amount),
			type,
			description: description || "",
			categoryId: categoryId || null,
			categoryName,
			source: "manual",
			date: date ? new Date(date) : new Date(),
			transactionId,
		});

		const wallet = await Wallet.findOne({ userId: req.user._id });

		await sendTransactionNotification(
			req.user._id,
			amount,
			wallet?.balance || 0,
			type,
		);
		console.log("Transaction created successfully:", transaction._id);

		res.status(201).json({ success: true, transaction });
	} catch (err) {
		console.error("CreateTransaction error:", err);
		console.error("Error stack:", err.stack);
		res.status(500).json({
			error: err.message,
			details: process.env.NODE_ENV === "development" ? err.stack : undefined,
		});
	}
};

// Update a transaction
export const updateTransaction = async (req, res) => {
	try {
		const { id } = req.params;
		const { amount, type, description, categoryId, date } = req.body;

		const transaction = await Transaction.findOne({
			_id: id,
			userId: req.user._id,
		});
		if (!transaction)
			return res.status(404).json({ error: "Transaction not found" });

		// Store old values to revert budget spent if needed
		const oldAmount = transaction.amount;
		const oldBudgetId = transaction.budgetId;
		let newBudgetId = transaction.budgetId;

		// Handle category change and potential budget update
		if (categoryId) {
			const category = await Category.findOne({
				_id: categoryId,
				userId: req.user._id,
			});
			if (!category)
				return res.status(400).json({ error: "Invalid category selected" });

			transaction.categoryId = category._id;
			transaction.categoryName = category.name;

			// Try to find matching budget for expense transactions
			if (type === "expense" && !transaction.budgetId) {
				const budgets = await Budget.find({
					userId: req.user._id,
					startDate: { $lte: new Date() },
					endDate: { $gte: new Date() },
				});

				const matchingBudget = budgets.find(
					(budget) =>
						budget.name.toLowerCase().includes(category.name.toLowerCase()) ||
						category.name.toLowerCase().includes(budget.name.toLowerCase()),
				);

				if (matchingBudget) {
					newBudgetId = matchingBudget._id;
				}
			}
		}

		// Update budget spent if amount or budget changed
		if (
			oldBudgetId &&
			(oldAmount !== Number(amount) || newBudgetId !== oldBudgetId)
		) {
			const oldBudget = await Budget.findOne({
				_id: oldBudgetId,
				userId: req.user._id,
			});
			if (oldBudget) {
				oldBudget.spent = Math.max(0, (oldBudget.spent || 0) - oldAmount);
				await oldBudget.save();
			}
		}

		if (newBudgetId && newBudgetId !== oldBudgetId) {
			const newBudget = await Budget.findOne({
				_id: newBudgetId,
				userId: req.user._id,
			});
			if (newBudget) {
				newBudget.spent = (newBudget.spent || 0) + Number(amount);
				await newBudget.save();
			}
		} else if (newBudgetId && oldAmount !== Number(amount)) {
			const budget = await Budget.findOne({
				_id: newBudgetId,
				userId: req.user._id,
			});
			if (budget) {
				budget.spent = (budget.spent || 0) - oldAmount + Number(amount);
				await budget.save();
			}
		}

		// Update transaction fields
		if (amount) transaction.amount = Number(amount);
		if (type) transaction.type = type;
		if (description) transaction.description = description;
		if (date) transaction.date = date;
		if (newBudgetId) transaction.budgetId = newBudgetId;

		await transaction.save();

		res.status(200).json({ success: true, transaction });
	} catch (err) {
		console.error("Update transaction error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Delete a transaction
export const deleteTransaction = async (req, res) => {
	try {
		const { id } = req.params;

		const transaction = await Transaction.findOne({
			_id: id,
			userId: req.user._id,
		});
		if (!transaction)
			return res.status(404).json({ error: "Transaction not found" });

		// Revert budget spent if transaction was linked to a budget
		if (transaction.budgetId) {
			const budget = await Budget.findOne({
				_id: transaction.budgetId,
				userId: req.user._id,
			});
			if (budget) {
				budget.spent = Math.max(0, (budget.spent || 0) - transaction.amount);
				await budget.save();
			}
		}

		await Transaction.findByIdAndDelete(id);

		res.status(200).json({ success: true, message: "Transaction deleted" });
	} catch (err) {
		console.error("Delete transaction error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const getLinkedTransactions = async (req, res) => {
	try {
		const transactions = await Transaction.find({
			userId: req.user._id,
			source: "bank",
		}).sort({ date: -1 });

		res.status(200).json({
			success: true,
			transactions,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const getUnbudgetedTransactions = async (req, res) => {
	try {
		const transactions = await Transaction.find({
			userId: req.user._id,
			budgetId: { $exists: false, $eq: null },
		}).sort({ date: -1 });

		res.status(200).json({
			success: true,
			transactions,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const getBudgetTransactions = async (req, res) => {
	try {
		const transactions = await Transaction.find({
			userId: req.user._id,
			budgetId: { $exists: true, $ne: null },
		}).sort({ date: -1 });

		res.status(200).json({
			success: true,
			transactions,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const getTransactionById = async (req, res) => {
	try {
		const { id } = req.params;

		const transaction = await Transaction.findOne({
			_id: id,
			userId: req.user._id,
		});

		if (!transaction) {
			return res.status(404).json({
				error: "Transaction not found",
			});
		}

		res.status(200).json({
			success: true,
			transaction,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

export const linkTransactionToBudget = async (req, res) => {
	try {
		const { transactionId, budgetId } = req.body;

		const transaction = await Transaction.findOne({
			_id: transactionId,
			userId: req.user._id,
		});

		if (!transaction) {
			return res.status(404).json({
				error: "Transaction not found",
			});
		}

		// Only allow expense transactions to be linked to budgets
		if (transaction.type !== "expense") {
			return res.status(400).json({
				error: "Only expense transactions can be linked to budgets",
			});
		}

		const budget = await Budget.findOne({
			_id: budgetId,
			userId: req.user._id,
		});

		if (!budget) {
			return res.status(404).json({
				error: "Budget not found",
			});
		}

		// If transaction is already linked to a budget, revert the old budget's spent
		if (transaction.budgetId && transaction.budgetId.toString() !== budgetId) {
			const oldBudget = await Budget.findOne({
				_id: transaction.budgetId,
				userId: req.user._id,
			});
			if (oldBudget) {
				oldBudget.spent = Math.max(
					0,
					(oldBudget.spent || 0) - transaction.amount,
				);
				await oldBudget.save();
			}
		}

		// Update budget spent
		budget.spent = (budget.spent || 0) + transaction.amount;
		await budget.save();

		// Link transaction to budget
		transaction.budgetId = budget._id;
		await transaction.save();

		res.status(200).json({
			success: true,
			transaction,
			budget,
		});
	} catch (err) {
		console.error("Link transaction to budget error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const getTransactionHistory = async (req, res) => {
	try {
		const { page = 1, limit = 20 } = req.query;
		const skip = (parseInt(page) - 1) * parseInt(limit);

		const transactions = await Transaction.find({
			userId: req.user._id,
		})
			.sort({ date: -1 })
			.skip(skip)
			.limit(parseInt(limit));

		const total = await Transaction.countDocuments({ userId: req.user._id });
		const totalPages = Math.ceil(total / parseInt(limit));

		res.status(200).json({
			success: true,
			page: parseInt(page),
			totalPages,
			total,
			transactions,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/transactionController.js

// backend/controllers/transactionController.js

// backend/controllers/transactionController.js

export const pullMonoTransactions = async (req, res) => {
	try {
		const { accountId } = req.params;
		const { perPage = 100 } = req.query;

		console.error("========================================");
		console.error("🔵 MONO PULL TRANSACTIONS STARTED");
		console.error("========================================");
		console.error(`📋 Account ID: ${accountId}`);

		// Find the bank connection
		let connection = await BankConnection.findOne({
			$or: [
				{ monoAccountId: accountId },
				{ _id: accountId },
				{ accountId: accountId },
			],
		}).populate("userId", "email name");

		if (!connection) {
			console.error("❌ Bank connection not found");
			return res.status(404).json({
				success: false,
				error: "Bank account not found",
			});
		}

		console.error("✅ Found connection:", connection.bankName);

		// Fetch all pages
		let allTransactions = [];
		let currentPage = 1;
		let hasMore = true;
		let totalFromAPI = 0;

		while (hasMore && currentPage <= 20) {
			console.error(`📥 Fetching page ${currentPage}...`);

			const response = await mono.get(
				`/accounts/${connection.monoAccountId}/transactions`,
				{
					params: { page: currentPage, perPage: 100 },
				},
			);

			const transactions = response.data.data || [];
			const meta = response.data.meta || {};
			totalFromAPI = meta.total || 0;

			console.error(
				`   Found ${transactions.length} transactions (Total: ${totalFromAPI})`,
			);

			if (transactions.length === 0) break;

			allTransactions = [...allTransactions, ...transactions];

			const totalFetched = allTransactions.length;
			hasMore = totalFetched < totalFromAPI;
			currentPage++;
		}

		console.error(
			`📊 Total fetched: ${allTransactions.length} of ${totalFromAPI}`,
		);

		let savedCount = 0;
		let updatedCount = 0;
		let errorCount = 0;

		for (const tx of allTransactions) {
			try {
				if (!tx.id && !tx._id) {
					errorCount++;
					continue;
				}

				// CRITICAL: Determine transaction type from originalType
				// Mono returns: "debit" for expenses, "credit" for income
				let type = "expense"; // default
				let originalType = tx.type || "unknown";

				if (originalType === "credit" || originalType === "income") {
					type = "income";
				} else if (originalType === "debit") {
					type = "expense";
				} else {
					// Fallback: use amount sign
					if (tx.amount > 0) {
						type = "income";
					} else if (tx.amount < 0) {
						type = "expense";
					}
				}

				// Convert amount from kobo to Naira
				const amountInKobo = Math.abs(tx.amount);
				const amountInNaira = amountInKobo / 100;
				const balanceInNaira = tx.balance ? tx.balance / 100 : null;

				console.log(
					`💰 Transaction: ${tx.narration} | Type: ${originalType} -> ${type} | Amount: ${amountInKobo} kobo = ₦${amountInNaira}`,
				);

				const transactionData = {
					userId: connection.userId._id || connection.userId,
					bankConnectionId: connection._id,
					transactionId: tx.id || tx._id,
					amount: amountInNaira,
					type: type, // Use the correctly mapped type
					description: tx.narration || tx.description || "Mono Transaction",
					categoryId: null,
					categoryName: tx.category || null,
					source: "bank",
					date: tx.date ? new Date(tx.date) : new Date(),
					createdAt: tx.date ? new Date(tx.date) : new Date(),
					status: "Completed",
					currency: tx.currency || "NGN",
					balance: balanceInNaira,
					metadata: {
						monoId: tx.id || tx._id,
						originalType: originalType, // Store original type for reference
						narration: tx.narration,
					},
				};

				const result = await Transaction.updateOne(
					{
						transactionId: tx.id || tx._id,
						userId: connection.userId._id || connection.userId,
					},
					{ $set: transactionData },
					{ upsert: true },
				);

				if (result.upsertedCount > 0) {
					savedCount++;
				} else if (result.modifiedCount > 0) {
					updatedCount++;
				}
			} catch (txError) {
				console.error(`❌ Error processing transaction:`, txError.message);
				errorCount++;
			}
		}

		connection.lastSync = new Date();
		await connection.save();

		console.error(`\n📈 Sync Summary:`);
		console.error(`   - New: ${savedCount}`);
		console.error(`   - Updated: ${updatedCount}`);
		console.error(`   - Errors: ${errorCount}`);
		console.error(`\n✅ MONO PULL COMPLETED`);

		res.json({
			success: true,
			total: totalFromAPI,
			fetched: allTransactions.length,
			saved: savedCount,
			updated: updatedCount,
			errors: errorCount,
			syncTime: new Date().toISOString(),
		});
	} catch (err) {
		console.error("❌ FATAL ERROR:", err);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

// New function to pull all transactions (using the service)
export const pullAllMonoTransactions = async (req, res) => {
	try {
		const { accountId } = req.params;

		const connection = await BankConnection.findOne({
			$or: [{ monoAccountId: accountId }, { _id: accountId }],
		});

		if (!connection) {
			return res.status(404).json({
				success: false,
				error: "Bank account not found",
			});
		}

		// Use the pullTransactionsFromMono service
		const since =
			connection.lastSync || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days if never synced
		const result = await pullTransactionsFromMono(connection, since);

		res.json({
			success: true,
			...result,
		});
	} catch (err) {
		console.error("Error pulling all Mono transactions:", err.message);
		res.status(500).json({
			success: false,
			error: err.message,
		});
	}
};

// Get all bank transactions with pagination
export const getAllBankTransactions = async (req, res) => {
	try {
		const { page = 1, limit = 20 } = req.query;
		const skip = (parseInt(page) - 1) * parseInt(limit);

		const transactions = await Transaction.find({
			userId: req.user._id,
			source: "bank",
		})
			.sort({ date: -1 })
			.skip(skip)
			.limit(parseInt(limit));

		const total = await Transaction.countDocuments({
			userId: req.user._id,
			source: "bank",
		});

		res.status(200).json({
			success: true,
			page: parseInt(page),
			total,
			hasNext: skip + transactions.length < total,
			transactions,
		});
	} catch (err) {
		console.error("Get all bank transactions error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Sync bank transactions (force pull)
export const syncBankTransactions = async (req, res) => {
	try {
		const { accountId } = req.params;

		// Call pull function with page 1
		const result = await pullMonoTransactions(req, res);

		return result;
	} catch (err) {
		console.error("Sync bank transactions error:", err);
		res.status(500).json({ error: err.message });
	}
};
