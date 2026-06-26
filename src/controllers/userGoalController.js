// backend/controllers/userGoalController.js
import cron from "node-cron";
import AllocationRecord from "../models/AllocationRecord.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import User from "../models/User.js";
import UserGoal from "../models/UserGoal.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import anchorService from "../services/anchorService.js";
import { sendPushToUser } from "../services/pushService.js";

// Store scheduled jobs
const scheduledJobs = new Map();

// ==================== HELPER FUNCTIONS ====================

/**
 * ✅ Get user with Anchor customer data
 */
const getUserWithAnchorData = async (userId) => {
	try {
		const user = await User.findById(userId);
		if (!user) {
			throw new Error("User not found");
		}

		console.log(`✅ User found: ${user.fullName}`);
		console.log(`   Anchor Customer ID: ${user.anchorCustomerId || "Not set"}`);
		console.log(`   Anchor KYC Level: ${user.anchorKycLevel || "Not set"}`);
		console.log(`   KYC Verified: ${user.kyc?.isVerified || false}`);

		return user;
	} catch (error) {
		console.error("❌ getUserWithAnchorData error:", error);
		throw error;
	}
};

/**
 * ✅ Get or create user's main wallet with real Anchor data
 */
const getMainWallet = async (userId) => {
	try {
		let wallet = await AnchorWallet.findOne({ userId, walletType: "main" });

		if (!wallet) {
			console.log("🔄 No wallet found, creating one for user:", userId);

			const user = await getUserWithAnchorData(userId);

			const customerResult = await getOrCreateAnchorCustomer(userId);
			if (!customerResult.success) {
				throw new Error(
					"Failed to get/create Anchor customer: " + customerResult.error,
				);
			}

			if (!user.anchorCustomerId) {
				user.anchorCustomerId = customerResult.customerId;
				user.anchorCustomerStatus = "active";
				await user.save();
				console.log(
					`✅ User updated with Anchor Customer ID: ${user.anchorCustomerId}`,
				);
			}

			const accountResponse = await anchorService.createDepositAccount(
				customerResult.customerId,
				"SAVINGS",
				{
					userId: userId.toString(),
					platform: "kuditrak",
					currency: "NGN",
					walletType: "main",
				},
			);

			let walletId = `wallet_${Date.now()}_${userId.toString().slice(-6)}`;
			let accountNumber = null;
			let bankName = null;

			if (accountResponse.success) {
				walletId = accountResponse.accountId;
				console.log(`✅ Deposit account created: ${walletId}`);

				try {
					const accountNumberResponse =
						await anchorService.getAccountNumberForDeposit(walletId);
					if (accountNumberResponse.success) {
						accountNumber = accountNumberResponse.accountNumber;
						bankName = accountNumberResponse.bankName;
					}
				} catch (err) {
					console.log("⚠️ Could not get account number:", err.message);
				}
			}

			wallet = await AnchorWallet.create({
				userId,
				anchorCustomerId: customerResult.customerId,
				walletId: walletId,
				walletType: "main",
				balance: 0,
				allocated: 0,
				available: 0,
				name: "Main Wallet",
				currency: "NGN",
				status: "active",
				accountNumber: accountNumber,
				bankName: bankName,
				isLocal: !accountResponse.success,
			});

			console.log("✅ Wallet created:", wallet._id);
		}

		// Sync balance with Anchor
		if (
			!wallet.isLocal &&
			wallet.walletId &&
			!wallet.walletId.startsWith("local_")
		) {
			try {
				const balanceResponse = await anchorService.getWalletBalance(
					wallet.walletId,
				);
				if (balanceResponse.success) {
					const balanceInNGN = balanceResponse.balance / 100;
					wallet.balance = balanceInNGN;
					wallet.available = balanceInNGN - (wallet.allocated || 0);
					await wallet.save();
					console.log(`✅ Balance synced: ₦${balanceInNGN}`);
				}
			} catch (err) {
				console.log("⚠️ Could not sync balance:", err.message);
			}
		}

		return wallet;
	} catch (error) {
		console.error("❌ getMainWallet error:", error);
		throw error;
	}
};

// backend/controllers/userGoalController.js - UPDATED createGoalDepositAccount

const createGoalDepositAccount = async (userId, goal) => {
	try {
		console.log(`🏦 Creating deposit account for goal: ${goal.name}`);
		console.log(`   Goal ID: ${goal._id}`);
		console.log(
			`   Current goalDepositAccountId: ${goal.goalDepositAccountId || "NULL"}`,
		);

		const user = await getUserWithAnchorData(userId);
		if (!user) {
			throw new Error("User not found");
		}

		const anchorCustomer = await getOrCreateAnchorCustomer(userId);
		if (!anchorCustomer.success) {
			throw new Error("Failed to get Anchor customer: " + anchorCustomer.error);
		}

		// ✅ Create account in Anchor
		console.log("📝 Creating deposit account in Anchor...");

		const accountResponse = await anchorService.createDepositAccount(
			anchorCustomer.customerId,
			"SAVINGS",
			{
				goalId: goal._id.toString(),
				goalName: goal.name,
				userId: userId.toString(),
				platform: "kuditrak",
				currency: "NGN",
				type: "goal",
				userEmail: user.email,
				userName: user.fullName,
				created_at: new Date().toISOString(),
			},
		);

		if (!accountResponse.success) {
			throw new Error(
				"Failed to create goal deposit account: " +
					(accountResponse.error || "Unknown error"),
			);
		}

		const goalAccountId = accountResponse.accountId;
		console.log(`✅ Goal deposit account created: ${goalAccountId}`);

		// ✅ Get account number
		console.log("🔍 Fetching account number...");

		let accountNumber = null;
		let bankName = "PROVIDUS BANK";
		let bankCode = "000023";

		try {
			const accountNumberResponse =
				await anchorService.getAccountNumberForDeposit(goalAccountId);
			if (accountNumberResponse.success) {
				accountNumber = accountNumberResponse.accountNumber;
				bankName = accountNumberResponse.bankName || bankName;
				bankCode = accountNumberResponse.bankCode || bankCode;
				console.log(`✅ Goal account number: ${accountNumber}`);
				console.log(`   Bank: ${bankName} (${bankCode})`);
			}
		} catch (err) {
			console.warn("⚠️ Could not get account number:", err.message);
		}

		// ✅ CRITICAL: Update the goal with multiple methods to ensure save
		console.log("💾 Saving goal with account details...");

		// Method 1: Direct property assignment
		goal.goalDepositAccountId = goalAccountId;
		goal.goalAccountNumber = accountNumber;
		goal.goalBankName = bankName;
		goal.goalBankCode = bankCode;
		goal.goalAccountStatus = "active";
		goal.goalAccountBalance = 0;
		goal.updatedAt = new Date();

		// ✅ Method 2: Use set() method (Mongoose way)
		goal.set({
			goalDepositAccountId: goalAccountId,
			goalAccountNumber: accountNumber,
			goalBankName: bankName,
			goalBankCode: bankCode,
			goalAccountStatus: "active",
			goalAccountBalance: 0,
			updatedAt: new Date(),
		});

		// ✅ Method 3: Save with options to force validation
		const savedGoal = await goal.save({
			validateBeforeSave: true,
			runValidators: true,
		});

		console.log(
			`✅ Goal saved with account ID: ${savedGoal.goalDepositAccountId}`,
		);
		console.log(`   Account Number: ${savedGoal.goalAccountNumber}`);

		// ✅ Method 4: Verify save by re-fetching
		const verifiedGoal = await UserGoal.findById(goal._id);
		if (verifiedGoal) {
			console.log(
				`✅ VERIFIED: Goal account ID is ${verifiedGoal.goalDepositAccountId || "STILL NULL!"}`,
			);

			if (!verifiedGoal.goalDepositAccountId) {
				// ✅ If still null, try direct update
				console.log("⚠️ Direct update fallback...");
				await UserGoal.findByIdAndUpdate(
					goal._id,
					{
						$set: {
							goalDepositAccountId: goalAccountId,
							goalAccountNumber: accountNumber,
							goalBankName: bankName,
							goalBankCode: bankCode,
							goalAccountStatus: "active",
							goalAccountBalance: 0,
							updatedAt: new Date(),
						},
					},
					{ new: true, runValidators: true },
				);

				// ✅ Verify again
				const finalGoal = await UserGoal.findById(goal._id);
				if (finalGoal && finalGoal.goalDepositAccountId) {
					console.log(
						`✅ FIXED: Goal account ID is now ${finalGoal.goalDepositAccountId}`,
					);
					// Update the original goal reference
					goal.goalDepositAccountId = finalGoal.goalDepositAccountId;
					goal.goalAccountNumber = finalGoal.goalAccountNumber;
					goal.goalBankName = finalGoal.goalBankName;
					goal.goalBankCode = finalGoal.goalBankCode;
				} else {
					console.error("❌ CRITICAL: Goal account ID still not saved!");
				}
			}
		}

		return {
			success: true,
			goalAccountId: goalAccountId,
			accountNumber: accountNumber,
			bankName: bankName,
			bankCode: bankCode,
			wasExisting: false,
		};
	} catch (error) {
		console.error("❌ createGoalDepositAccount error:", error);
		throw error;
	}
};

// backend/controllers/userGoalController.js - Complete transferToGoal

/**
 * ✅ Transfer funds from main wallet to goal deposit account
 */
const transferToGoal = async (userId, goal, amount) => {
	try {
		console.log(`💰 Transferring ₦${amount} to goal: ${goal.name}`);

		// ✅ Get user with Anchor data
		const user = await getUserWithAnchorData(userId);
		if (!user) {
			throw new Error("User not found");
		}

		// ✅ Get main wallet
		const mainWallet = await getMainWallet(userId);
		if (!mainWallet) {
			throw new Error("Main wallet not found");
		}

		// ✅ CRITICAL: Always re-fetch the goal from database
		let freshGoal = await UserGoal.findById(goal._id);
		if (!freshGoal) {
			throw new Error("Goal not found");
		}

		console.log(`📊 Fresh goal data:`);
		console.log(`   Goal ID: ${freshGoal._id}`);
		console.log(`   Account ID: ${freshGoal.goalDepositAccountId || "NULL"}`);
		console.log(`   Account Number: ${freshGoal.goalAccountNumber || "NULL"}`);
		console.log(`   Allocated: ₦${freshGoal.allocatedAmount}`);

		let goalAccountId = freshGoal.goalDepositAccountId;

		// ✅ If no account ID in DB, create one
		if (!goalAccountId) {
			console.log("🏦 Goal has no account ID, creating one...");

			const createResult = await createGoalDepositAccount(userId, freshGoal);
			if (!createResult.success) {
				throw new Error(
					"Failed to create goal deposit account: " +
						(createResult.error || "Unknown error"),
				);
			}

			// ✅ RE-FETCH the goal after creation
			freshGoal = await UserGoal.findById(goal._id);
			goalAccountId = freshGoal.goalDepositAccountId;

			console.log(`✅ Goal account created and saved: ${goalAccountId}`);
			console.log(`   Account Number: ${freshGoal.goalAccountNumber}`);
			console.log(`   Bank: ${freshGoal.goalBankName}`);
		}

		// ✅ Double-check we have a valid goalAccountId
		if (!goalAccountId) {
			throw new Error(
				"Failed to get or create goal account ID. Please try again.",
			);
		}

		console.log(`✅ Using goal account: ${goalAccountId}`);
		console.log(
			`   Account Number: ${freshGoal.goalAccountNumber || "Not yet available"}`,
		);
		console.log(`   Bank: ${freshGoal.goalBankName || "Not yet available"}`);

		// ✅ Verify user has Anchor customer ID
		if (!user.anchorCustomerId) {
			throw new Error("User does not have an Anchor customer ID");
		}

		// ✅ Get real balances from Anchor
		console.log("🔍 Fetching main wallet balance from Anchor...");
		const mainBalance = await anchorService.getWalletBalance(
			mainWallet.walletId,
		);
		if (!mainBalance.success) {
			throw new Error("Could not get main wallet balance from Anchor");
		}

		const mainBalanceInNGN = mainBalance.balance / 100;
		console.log(`📊 Main wallet balance: ₦${mainBalanceInNGN}`);

		if (mainBalanceInNGN < amount) {
			throw new Error(
				`Insufficient balance. Available: ₦${mainBalanceInNGN.toLocaleString()}`,
			);
		}

		// ✅ Transfer using Anchor's /transfers endpoint
		const amountInKobo = Math.round(amount * 100);
		console.log(
			`🔄 Transferring ${amountInKobo} kobo from main wallet to goal...`,
		);

		const transferResult = await anchorService.transferBetweenAccounts(
			mainWallet.walletId, // Source: Main wallet
			goalAccountId, // Destination: Goal's deposit account
			amountInKobo,
			"NGN",
			`Transfer to goal: ${goal.name}`,
		);

		if (!transferResult.success) {
			throw new Error(
				"Transfer failed: " + (transferResult.error || "Unknown error"),
			);
		}

		console.log(`✅ Transfer completed: ${transferResult.transferId}`);
		console.log(`   Status: ${transferResult.status}`);
		console.log(`   Reference: ${transferResult.reference}`);

		// ✅ Update local balances after successful transfer
		const updatedMainBalance = await anchorService.getWalletBalance(
			mainWallet.walletId,
		);
		if (updatedMainBalance.success) {
			const newBalance = updatedMainBalance.balance / 100;
			mainWallet.balance = newBalance;
			mainWallet.allocated = (mainWallet.allocated || 0) + amount;
			mainWallet.available = newBalance - mainWallet.allocated;
			await mainWallet.save();
			console.log(`✅ Main wallet updated: ₦${mainWallet.balance}`);
		}

		// ✅ Update goal allocation
		freshGoal.allocatedAmount += amount;
		freshGoal.updatedAt = new Date();
		await freshGoal.save();

		// ✅ Update the original goal reference
		goal.allocatedAmount = freshGoal.allocatedAmount;
		goal.goalDepositAccountId = freshGoal.goalDepositAccountId;
		goal.goalAccountNumber = freshGoal.goalAccountNumber;
		goal.goalBankName = freshGoal.goalBankName;
		goal.goalBankCode = freshGoal.goalBankCode;
		goal.goalAccountStatus = freshGoal.goalAccountStatus;

		// ✅ Create transaction record
		await AnchorTransaction.create({
			userId,
			anchorCustomerId: user.anchorCustomerId,
			walletId: mainWallet._id,
			amount: amount,
			currency: "NGN",
			type: "debit",
			category: "transfer",
			status: "success",
			description: `Transfer to goal: ${goal.name}`,
			source: "wallet",
			destination: "goal",
			metadata: {
				goalId: goal._id,
				goalName: goal.name,
				goalDepositAccountId: goalAccountId,
				transferType: "goal_allocation",
				anchorTransferId: transferResult.transferId,
				anchorReference: transferResult.reference,
				userEmail: user.email,
				userName: user.fullName,
				fromAccount: mainWallet.walletId,
				toAccount: goalAccountId,
				amountInKobo: amountInKobo,
			},
		});

		console.log(`✅ Successfully transferred ₦${amount} to goal: ${goal.name}`);
		console.log(`   Goal Account: ${goalAccountId}`);
		console.log(`   Total Allocated: ₦${freshGoal.allocatedAmount}`);
		console.log(
			`   Remaining: ₦${goal.goalAmount - freshGoal.allocatedAmount}`,
		);

		return {
			success: true,
			transferId: transferResult.transferId,
			allocatedAmount: freshGoal.allocatedAmount,
		};
	} catch (error) {
		console.error("❌ transferToGoal error:", error);
		console.error("   Stack:", error.stack);
		throw error;
	}
};
// backend/controllers/userGoalController.js - Add this helper

/**
 * ✅ Check if a goal already has an account in Anchor
 */
const checkGoalAccountExists = async (userId, goal) => {
	try {
		if (goal.goalDepositAccountId) {
			console.log(`✅ Goal already has account: ${goal.goalDepositAccountId}`);
			return { exists: true, accountId: goal.goalDepositAccountId };
		}

		// If no account ID in DB, check Anchor directly
		const anchorCustomer = await getOrCreateAnchorCustomer(userId);
		if (!anchorCustomer.success) {
			return { exists: false };
		}

		const accountsResponse = await anchorService.getDepositAccounts(
			anchorCustomer.customerId,
		);

		if (accountsResponse.success && accountsResponse.accounts) {
			// Find account with matching metadata
			for (const account of accountsResponse.accounts) {
				const metadata = account.metadata || {};
				if (metadata.goalId === goal._id.toString()) {
					console.log(
						`✅ Found existing goal account in Anchor: ${account.id}`,
					);
					return {
						exists: true,
						accountId: account.id,
						account: account,
					};
				}
			}
		}

		return { exists: false };
	} catch (error) {
		console.error("❌ checkGoalAccountExists error:", error);
		return { exists: false };
	}
};

/**
 * Schedule auto-allocation for a goal
 */
const scheduleAutoAllocation = (goalId, userId, frequency, amount) => {
	if (scheduledJobs.has(goalId)) {
		scheduledJobs.get(goalId).stop();
		scheduledJobs.delete(goalId);
	}

	if (!frequency || frequency === "none") return;

	let cronExpression;
	switch (frequency) {
		case "daily":
			cronExpression = "0 0 * * *";
			break;
		case "weekly":
			cronExpression = "0 0 * * 1";
			break;
		case "bi-weekly":
			cronExpression = "0 0 */14 * *";
			break;
		case "monthly":
			cronExpression = "0 0 1 * *";
			break;
		default:
			return;
	}

	const job = cron.schedule(cronExpression, async () => {
		try {
			const goal = await UserGoal.findOne({ _id: goalId, userId });
			if (!goal || goal.allocatedAmount >= goal.goalAmount) {
				if (scheduledJobs.has(goalId)) {
					scheduledJobs.get(goalId).stop();
					scheduledJobs.delete(goalId);
				}
				return;
			}

			const mainWallet = await getMainWallet(userId);
			if (!mainWallet || mainWallet.balance < amount) return;

			await transferToGoal(userId, goal, amount);

			await sendPushToUser(
				userId,
				"💰 Auto-Save Successful",
				`₦${amount.toLocaleString()} saved to ${goal.name}`,
				{ type: "auto_save", goalId: goal._id, amount },
			);
		} catch (err) {
			console.error(`Error in auto-allocation for goal ${goalId}:`, err);
		}
	});

	scheduledJobs.set(goalId, job);
};

// ==================== CRUD OPERATIONS ====================

/**
 * ✅ List all goals for the user with user data
 */
export const listGoals = async (req, res) => {
	try {
		const userId = req.user._id;

		const user = await getUserWithAnchorData(userId);

		const goals = await UserGoal.find({ userId }).sort({
			createdAt: -1,
		});

		res.status(200).json({
			success: true,
			data: goals,
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				anchorCustomerId: user.anchorCustomerId,
				anchorKycLevel: user.anchorKycLevel,
			},
		});
	} catch (err) {
		console.error("List goals error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Get single goal by ID with user data
 */
export const getGoalById = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const user = await getUserWithAnchorData(userId);

		const goal = await UserGoal.findOne({ _id: id, userId });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		res.status(200).json({
			success: true,
			data: goal,
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Get goal by ID error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Create goal - integrates with User model
 */
export const createGoal = async (req, res) => {
	try {
		const {
			name,
			goalAmount,
			frequency,
			autoAllocateAmount,
			autoAllocateEnabled,
			commitmentEnabled,
			releaseDate,
			icon = "💰",
			color = "#4F46E5",
			lockType = "Flexible",
		} = req.body;

		console.log("📥 Create goal request:", { name, goalAmount, lockType });

		if (!name) {
			return res.status(400).json({ error: "Name is required" });
		}

		if (!goalAmount || goalAmount <= 0) {
			return res.status(400).json({ error: "Valid goal amount is required" });
		}

		// ✅ Get user with Anchor data
		const user = await getUserWithAnchorData(req.user._id);

		// ✅ Ensure user has Anchor customer ID
		if (!user.anchorCustomerId) {
			console.log("🔄 User has no Anchor customer ID, creating one...");
			const customerResult = await getOrCreateAnchorCustomer(req.user._id);
			if (customerResult.success) {
				user.anchorCustomerId = customerResult.customerId;
				user.anchorCustomerStatus = "active";
				await user.save();
				console.log(
					`✅ User updated with Anchor Customer ID: ${user.anchorCustomerId}`,
				);
			} else {
				throw new Error("Failed to create Anchor customer for user");
			}
		}

		// Get main wallet
		const wallet = await getMainWallet(req.user._id);
		if (!wallet) {
			return res.status(500).json({ error: "Wallet not found" });
		}

		console.log("✅ Wallet found:", wallet._id);
		console.log(`✅ User Anchor Customer ID: ${user.anchorCustomerId}`);

		// ✅ Create goal
		const goalData = {
			userId: req.user._id,
			walletId: wallet._id,
			name: name,
			goalAmount: goalAmount,
			allocatedAmount: 0,
			icon: icon,
			color: color,
			lockType: lockType,
			goalAccountStatus: "pending",
			allocationSchedule: {
				frequency: frequency || "monthly",
				amount: autoAllocateAmount || 0,
				autoAllocateEnabled: autoAllocateEnabled || false,
			},
			commitmentSettings: {
				enabled: commitmentEnabled || false,
				releaseDate: releaseDate ? new Date(releaseDate) : null,
				committedAt: commitmentEnabled ? new Date() : null,
				originalGoalAmount: commitmentEnabled ? goalAmount : null,
			},
		};

		const goal = new UserGoal(goalData);
		await goal.save();

		console.log("✅ Goal saved:", goal._id);

		// ✅ Create a Deposit Account in Anchor for this goal
		try {
			await createGoalDepositAccount(req.user._id, goal);
			console.log("✅ Goal deposit account created successfully");
		} catch (accountError) {
			console.error("❌ Failed to create goal deposit account:", accountError);
			// Goal still exists, but without an account
		}

		// Send notification
		await sendPushToUser(
			req.user._id,
			"🎯 Savings Goal Created!",
			`You've created a new savings goal: ${name}`,
			{ type: "goal_created", goalId: goal._id },
		);

		// Schedule auto-allocation if enabled
		if (goal.allocationSchedule.autoAllocateEnabled) {
			scheduleAutoAllocation(
				goal._id,
				goal.userId,
				goal.allocationSchedule.frequency,
				goal.allocationSchedule.amount,
			);
		}

		res.status(201).json({
			success: true,
			data: goal,
			message: "Goal created successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				anchorCustomerId: user.anchorCustomerId,
				anchorKycLevel: user.anchorKycLevel,
			},
		});
	} catch (err) {
		console.error("❌ Create goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Update goal - checks user's Anchor status
 */
export const updateGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const {
			name,
			goalAmount,
			frequency,
			autoAllocateAmount,
			autoAllocateEnabled,
			icon,
			color,
			lockType,
			releaseDate,
		} = req.body;

		const user = await getUserWithAnchorData(req.user._id);

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// Update basic fields
		if (name) goal.name = name;
		if (goalAmount) goal.goalAmount = goalAmount;
		if (icon) goal.icon = icon;
		if (color) goal.color = color;
		if (lockType) goal.lockType = lockType;

		// Handle Commitment Settings
		if (lockType !== undefined) {
			const isLocked = lockType === "Soft Lock" || lockType === "Hard Lock";

			if (isLocked && releaseDate) {
				goal.commitmentSettings = {
					enabled: true,
					releaseDate: new Date(releaseDate),
					committedAt: goal.commitmentSettings?.committedAt || new Date(),
					originalGoalAmount:
						goal.commitmentSettings?.originalGoalAmount || goal.goalAmount,
				};
			} else {
				goal.commitmentSettings = {
					enabled: false,
					releaseDate: null,
					committedAt: null,
					originalGoalAmount: null,
				};
			}
		}

		// Handle Auto-Save Settings
		if (
			frequency !== undefined ||
			autoAllocateAmount !== undefined ||
			autoAllocateEnabled !== undefined
		) {
			goal.allocationSchedule = {
				frequency: frequency || "monthly",
				amount: autoAllocateAmount || 0,
				autoAllocateEnabled: autoAllocateEnabled || false,
			};

			if (
				goal.allocationSchedule.autoAllocateEnabled &&
				goal.allocationSchedule.frequency !== "none" &&
				goal.allocationSchedule.amount > 0
			) {
				scheduleAutoAllocation(
					goal._id,
					goal.userId,
					goal.allocationSchedule.frequency,
					goal.allocationSchedule.amount,
				);
			} else {
				if (scheduledJobs.has(goal._id)) {
					scheduledJobs.get(goal._id).stop();
					scheduledJobs.delete(goal._id);
				}
			}
		}

		goal.updatedAt = new Date();
		await goal.save();

		res.json({
			success: true,
			data: goal,
			message: "Goal updated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Update goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Delete goal
 */
export const deleteGoal = async (req, res) => {
	try {
		const { id } = req.params;

		console.log("🔵 Deleting goal:", id);

		const user = await getUserWithAnchorData(req.user._id);

		if (scheduledJobs.has(id)) {
			scheduledJobs.get(id).stop();
			scheduledJobs.delete(id);
		}

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// Check if there are funds to withdraw
		if (goal.allocatedAmount > 0) {
			// Withdraw all funds first
			try {
				await withdrawDesignatedFunds(req, res);
				return;
			} catch (withdrawError) {
				console.error("❌ Error withdrawing funds:", withdrawError);
				return res.status(500).json({
					error: "Failed to withdraw funds before deleting goal",
					message: withdrawError.message,
				});
			}
		}

		// Delete the goal
		await goal.deleteOne();
		console.log("🗑️ Goal deleted");

		await sendPushToUser(
			req.user._id,
			"🗑️ Goal Deleted",
			`Your goal "${goal.name}" has been deleted.`,
			{ type: "goal_deleted", goalId: goal._id },
		);

		res.json({
			success: true,
			message: "Goal deleted successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("❌ Delete goal error:", err);
		res.status(500).json({
			error: err.message,
			message: "Failed to delete goal. Please try again.",
		});
	}
};

export const allocateToGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const { amount } = req.body;

		if (amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		const user = await getUserWithAnchorData(req.user._id);

		if (!user.anchorCustomerId) {
			return res.status(400).json({
				error:
					"User does not have an Anchor customer. Please complete KYC first.",
			});
		}

		// ✅ Get the goal
		let goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const newAmount = goal.allocatedAmount + amount;
		if (newAmount > goal.goalAmount) {
			return res.status(400).json({
				error: `This allocation would exceed your goal. You can only allocate ${goal.goalAmount - goal.allocatedAmount} more.`,
			});
		}

		// ✅ Call transferToGoal with the goal
		await transferToGoal(req.user._id, goal, amount);

		// ✅ Re-fetch the goal to get updated data
		goal = await UserGoal.findById(id);

		const isCompleted = goal.allocatedAmount >= goal.goalAmount;

		// Create allocation record
		try {
			await AllocationRecord.create({
				goalId: goal._id,
				userId: req.user._id,
				amount: amount,
				type: "manual_allocation",
				timestamp: new Date(),
				description: `Manual allocation to ${goal.name}`,
				balanceAfter: goal.allocatedAmount,
				metadata: {
					userEmail: user.email,
					userName: user.fullName,
					goalAccountId: goal.goalDepositAccountId,
				},
			});
		} catch (recordError) {
			console.error("❌ Failed to create allocation record:", recordError);
		}

		// Send notification
		await sendPushToUser(
			req.user._id,
			isCompleted ? "🎯 Goal Complete!" : "💰 Goal Updated",
			isCompleted
				? `You've completed your goal: ${goal.name}! 🎉`
				: `₦${amount.toLocaleString()} added to ${goal.name}`,
			{ type: "goal_allocated", goalId: goal._id, amount },
		);

		// Stop auto-allocation if goal is completed
		if (isCompleted && scheduledJobs.has(goal._id)) {
			scheduledJobs.get(goal._id).stop();
			scheduledJobs.delete(goal._id);
		}

		const allocation = await AllocationRecord.findOne({
			goalId: goal._id,
			userId: req.user._id,
		}).sort({ timestamp: -1 });

		res.json({
			success: true,
			data: goal,
			allocation: allocation,
			message: "Funds allocated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Allocate to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Withdraw funds from goal - checks User model
 */
export const withdrawDesignatedFunds = async (req, res) => {
	try {
		const { id } = req.params;
		const { amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid withdrawal amount" });
		}

		const user = await getUserWithAnchorData(req.user._id);

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		if (goal.allocatedAmount < amount) {
			return res.status(400).json({ error: "Insufficient designated funds" });
		}

		const mainWallet = await getMainWallet(req.user._id);
		if (!mainWallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		let penaltyFee = 0;
		let totalDeduction = amount;
		let penaltyMessage = "";

		// Check if early withdrawal penalty applies
		const isEarlyRelease =
			goal.commitmentSettings?.enabled &&
			goal.commitmentSettings?.releaseDate &&
			new Date() < new Date(goal.commitmentSettings.releaseDate);

		if (isEarlyRelease) {
			const penaltyRate = 0.07;
			penaltyFee = Math.round(amount * penaltyRate);
			totalDeduction = amount + penaltyFee;
			penaltyMessage = ` Early release penalty (7%): ₦${penaltyFee.toLocaleString()} applied.`;
		}

		if (goal.allocatedAmount < totalDeduction) {
			const maxWithdrawable = Math.floor(goal.allocatedAmount / 1.07);
			return res.status(400).json({
				error: `Insufficient designated funds. Maximum withdrawable: ₦${maxWithdrawable} (₦${(maxWithdrawable * 0.07).toFixed(2)} penalty applies for early release).`,
			});
		}

		// Deduct from goal
		goal.allocatedAmount -= totalDeduction;
		await goal.save();

		// Refund to main wallet
		const refundAmount = amount;
		mainWallet.balance += refundAmount;
		mainWallet.allocated = Math.max(
			0,
			(mainWallet.allocated || 0) - totalDeduction,
		);
		mainWallet.available = mainWallet.balance - mainWallet.allocated;
		await mainWallet.save();

		// Create withdrawal record
		await AllocationRecord.create({
			goalId: goal._id,
			userId: req.user._id,
			amount: amount,
			type: "withdrawal",
			timestamp: new Date(),
			description: `Withdrawal from ${goal.name}${penaltyMessage}`,
			balanceAfter: goal.allocatedAmount,
			metadata: {
				penaltyApplied: penaltyFee,
				totalDeduction: totalDeduction,
				isEarlyRelease: isEarlyRelease,
				userEmail: user.email,
				userName: user.fullName,
			},
		});

		// Create transaction record
		await AnchorTransaction.create({
			userId: req.user._id,
			anchorCustomerId: user.anchorCustomerId,
			walletId: mainWallet._id,
			amount: refundAmount,
			currency: "NGN",
			type: "credit",
			category: "withdrawal",
			status: "success",
			description: `Withdrawal from goal: ${goal.name}`,
			source: "goal",
			destination: "wallet",
			metadata: {
				goalId: goal._id,
				goalName: goal.name,
				penaltyApplied: penaltyFee,
				totalDeduction: totalDeduction,
				userEmail: user.email,
			},
		});

		// If penalty was applied, collect it
		if (penaltyFee > 0) {
			await AnchorTransaction.create({
				userId: req.user._id,
				anchorCustomerId: user.anchorCustomerId,
				walletId: mainWallet._id,
				amount: penaltyFee,
				currency: "NGN",
				type: "debit",
				category: "penalty",
				status: "success",
				description: `Early withdrawal penalty for goal: ${goal.name}`,
				source: "goal",
				destination: "platform",
				metadata: {
					goalId: goal._id,
					goalName: goal.name,
					penaltyAmount: penaltyFee,
					withdrawAmount: amount,
					userEmail: user.email,
				},
			});
		}

		await sendPushToUser(
			req.user._id,
			"💸 Withdrawal Successful",
			`₦${refundAmount.toLocaleString()} withdrawn from ${goal.name}${penaltyMessage}`,
			{ type: "goal_withdrawn", goalId: goal._id, amount: refundAmount },
		);

		res.status(200).json({
			success: true,
			message: `Withdrawal successful.${penaltyMessage}`,
			data: goal,
			withdrawAmount: amount,
			penaltyApplied: penaltyFee,
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Withdraw designated funds error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Commit to a goal
 */
export const commitToGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const { releaseDate } = req.body;

		const user = await getUserWithAnchorData(req.user._id);

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		if (goal.commitmentSettings.enabled) {
			return res
				.status(400)
				.json({ error: "You already have an active commitment to this goal" });
		}

		const releaseDateObj = new Date(releaseDate);
		if (isNaN(releaseDateObj.getTime())) {
			return res.status(400).json({ error: "Invalid release date" });
		}
		if (releaseDateObj <= new Date()) {
			return res
				.status(400)
				.json({ error: "Release date must be in the future" });
		}

		goal.commitmentSettings = {
			enabled: true,
			releaseDate: releaseDateObj,
			committedAt: new Date(),
			originalGoalAmount: goal.goalAmount,
		};

		goal.updatedAt = new Date();
		await goal.save();

		if (scheduledJobs.has(goal._id)) {
			scheduledJobs.get(goal._id).stop();
			scheduledJobs.delete(goal._id);
		}

		await sendPushToUser(
			req.user._id,
			"🔒 Goal Locked",
			`Your goal "${goal.name}" is now locked until ${releaseDateObj.toLocaleDateString()}.`,
			{ type: "goal_committed", goalId: goal._id },
		);

		res.json({
			success: true,
			message: `You've committed to this goal until ${releaseDateObj.toLocaleDateString()}.`,
			data: goal,
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Commit to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Release from commitment
 */
export const releaseFromCommitment = async (req, res) => {
	try {
		const { id } = req.params;

		const user = await getUserWithAnchorData(req.user._id);

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		if (!goal.commitmentSettings.enabled) {
			return res
				.status(400)
				.json({ error: "No active commitment found for this goal" });
		}

		const now = new Date();
		if (now < goal.commitmentSettings.releaseDate) {
			const daysRemaining = Math.ceil(
				(goal.commitmentSettings.releaseDate - now) / (1000 * 60 * 60 * 24),
			);
			return res.status(400).json({
				error: `Early release penalty applies. Release date: ${goal.commitmentSettings.releaseDate.toLocaleDateString()} (${daysRemaining} days remaining). A 7% penalty fee will be charged.`,
				earlyRelease: true,
				penaltyRate: "7%",
			});
		}

		goal.commitmentSettings = {
			enabled: false,
			releaseDate: null,
			committedAt: null,
			originalGoalAmount: null,
		};

		goal.updatedAt = new Date();
		await goal.save();

		if (
			goal.allocationSchedule.autoAllocateEnabled &&
			goal.allocatedAmount < goal.goalAmount
		) {
			scheduleAutoAllocation(
				goal._id,
				goal.userId,
				goal.allocationSchedule.frequency,
				goal.allocationSchedule.amount,
			);
		}

		await sendPushToUser(
			req.user._id,
			"🔓 Goal Unlocked",
			`Your goal "${goal.name}" has been unlocked.`,
			{ type: "goal_released", goalId: goal._id },
		);

		res.json({
			success: true,
			message: "You've been released from your commitment.",
			data: goal,
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Release from commitment error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Toggle auto-allocation
 */
export const toggleAutoAllocate = async (req, res) => {
	try {
		const { id } = req.params;
		const { enabled } = req.body;

		const user = await getUserWithAnchorData(req.user._id);

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		goal.allocationSchedule.autoAllocateEnabled = enabled;
		goal.updatedAt = new Date();
		await goal.save();

		if (
			enabled &&
			goal.allocationSchedule.frequency !== "none" &&
			goal.allocationSchedule.amount > 0
		) {
			scheduleAutoAllocation(
				goal._id,
				goal.userId,
				goal.allocationSchedule.frequency,
				goal.allocationSchedule.amount,
			);
		} else {
			if (scheduledJobs.has(goal._id)) {
				scheduledJobs.get(goal._id).stop();
				scheduledJobs.delete(goal._id);
			}
		}

		res.json({
			success: true,
			message: enabled ? "Auto-allocation enabled" : "Auto-allocation disabled",
			data: goal,
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Toggle auto-allocation error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Get goal statistics
 */
export const getGoalStats = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const user = await getUserWithAnchorData(userId);

		const goal = await UserGoal.findOne({ _id: id, userId });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const progress = (goal.allocatedAmount / goal.goalAmount) * 100;
		const remaining = goal.goalAmount - goal.allocatedAmount;

		res.json({
			success: true,
			stats: {
				id: goal._id,
				name: goal.name,
				goalAmount: goal.goalAmount,
				allocatedAmount: goal.allocatedAmount,
				progress: Math.min(progress, 100),
				remaining: Math.max(0, remaining),
				completed: goal.allocatedAmount >= goal.goalAmount,
				autoAllocateEnabled: goal.allocationSchedule.autoAllocateEnabled,
				autoAllocateFrequency: goal.allocationSchedule.frequency,
				autoAllocateAmount: goal.allocationSchedule.amount,
				isLocked: goal.commitmentSettings?.enabled || false,
				releaseDate: goal.commitmentSettings?.releaseDate || null,
				icon: goal.icon || "💰",
				color: goal.color || "#4F46E5",
				goalAccountNumber: goal.goalAccountNumber,
				goalBankName: goal.goalBankName,
				goalAccountStatus: goal.goalAccountStatus,
			},
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Get goal stats error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Get goal transactions
 */
export const getGoalTransactions = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const user = await getUserWithAnchorData(userId);

		const goal = await UserGoal.findOne({ _id: id, userId });
		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const records = await AllocationRecord.find({
			goalId: goal._id,
			userId: userId,
		})
			.sort({ timestamp: -1 })
			.lean();

		const transactions = records.map((record) => {
			const isWithdrawal =
				record.type === "withdrawal" || record.type === "penalty";
			return {
				_id: record._id,
				type: isWithdrawal ? "withdraw" : "allocate",
				amount: record.amount,
				description:
					record.description || (isWithdrawal ? "Withdrawal" : "Deposit"),
				createdAt: record.timestamp,
				balanceAfter: record.balanceAfter || 0,
				metadata: record.metadata || {},
			};
		});

		transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

		res.status(200).json({
			success: true,
			transactions: transactions,
			total: transactions.length,
			user: {
				id: user._id,
				fullName: user.fullName,
				anchorCustomerId: user.anchorCustomerId,
			},
		});
	} catch (err) {
		console.error("Get goal transactions error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * ✅ Get user's total goals stats
 */
export const getUserGoalStats = async (req, res) => {
	try {
		const userId = req.user._id;

		const user = await getUserWithAnchorData(userId);

		const goals = await UserGoal.find({ userId });

		const totalGoals = goals.length;
		const completedGoals = goals.filter(
			(g) => g.allocatedAmount >= g.goalAmount,
		).length;
		const totalAllocated = goals.reduce((sum, g) => sum + g.allocatedAmount, 0);
		const totalGoalAmount = goals.reduce((sum, g) => sum + g.goalAmount, 0);
		const overallProgress =
			totalGoalAmount > 0 ? (totalAllocated / totalGoalAmount) * 100 : 0;

		res.status(200).json({
			success: true,
			stats: {
				totalGoals,
				completedGoals,
				inProgressGoals: totalGoals - completedGoals,
				totalAllocated,
				totalGoalAmount,
				overallProgress: Math.min(overallProgress, 100),
			},
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				anchorCustomerId: user.anchorCustomerId,
				anchorKycLevel: user.anchorKycLevel,
			},
		});
	} catch (err) {
		console.error("Get user goal stats error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ==================== EXPORTS ====================

export default {
	listGoals,
	getGoalById,
	createGoal,
	updateGoal,
	deleteGoal,
	toggleAutoAllocate,
	commitToGoal,
	releaseFromCommitment,
	allocateToGoal,
	withdrawDesignatedFunds,
	getGoalStats,
	getGoalTransactions,
	getUserGoalStats,
};
