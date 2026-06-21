// controllers/userGoalController.js
import cron from "node-cron";
import AllocationRecord from "../models/AllocationRecord.js";
import AnchorSubAccount from "../models/AnchorSubAccount.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import UserGoal from "../models/UserGoal.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import { sendPushToUser } from "../services/pushService.js";

// Store scheduled jobs
const scheduledJobs = new Map();

// ==================== HELPER FUNCTIONS ====================

/**
 * Get or create user's main wallet
 */
const getMainWallet = async (userId) => {
	let wallet = await AnchorWallet.findOne({ userId, walletType: "main" });
	if (!wallet) {
		const customerResult = await getOrCreateAnchorCustomer(userId);
		if (!customerResult.success) {
			throw new Error("Failed to get/create Anchor customer");
		}

		wallet = await AnchorWallet.create({
			userId,
			anchorCustomerId: customerResult.customerId,
			walletId: `wallet_${Date.now()}_${userId.toString().slice(-6)}`,
			walletType: "main",
			balance: 0,
			name: "Main Wallet",
			currency: "NGN",
			status: "active",
			isLocal: true,
		});
	}
	return wallet;
};

/**
 * Get or create goal sub-account
 */
const getOrCreateGoalSubAccount = async (userId, goal) => {
	let subAccount = await AnchorSubAccount.findOne({
		userId,
		subAccountId: goal.subAccountId || `goal_${goal._id}`,
	});

	if (!subAccount) {
		const mainWallet = await getMainWallet(userId);

		subAccount = await AnchorSubAccount.create({
			userId,
			parentWalletId: mainWallet._id,
			subAccountId: `goal_${goal._id}_${Date.now().toString().slice(-6)}`,
			name: goal.name,
			type: "savings",
			balance: goal.allocatedAmount || 0,
			targetAmount: goal.goalAmount,
			autoSave: {
				enabled: goal.allocationSchedule?.autoAllocateEnabled || false,
				amount: goal.allocationSchedule?.amount || 0,
				frequency: goal.allocationSchedule?.frequency || "monthly",
				dayOfMonth: 1,
			},
			lockSettings: {
				enabled: goal.commitmentSettings?.enabled || false,
				unlockDate: goal.commitmentSettings?.releaseDate || null,
				lockedAt: goal.commitmentSettings?.committedAt || null,
			},
			icon: goal.icon || "💰",
			color: goal.color || "#4F46E5",
			metadata: {
				goalId: goal._id,
				originalGoalAmount: goal.goalAmount,
				allocatedAmount: goal.allocatedAmount,
			},
		});

		goal.subAccountId = subAccount.subAccountId;
		await goal.save();
	}

	return subAccount;
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

			const wallet = await getMainWallet(userId);
			if (!wallet || wallet.balance < amount) return;

			const subAccount = await getOrCreateGoalSubAccount(userId, goal);

			// Transfer from main wallet to sub-account
			wallet.balance -= amount;
			subAccount.balance += amount;
			await wallet.save();
			await subAccount.save();

			// Update goal
			goal.allocatedAmount += amount;
			await goal.save();

			// Create transaction record
			await AnchorTransaction.create({
				userId,
				anchorCustomerId: wallet.anchorCustomerId,
				walletId: wallet._id,
				subAccountId: subAccount._id,
				amount: amount,
				currency: "NGN",
				type: "debit",
				category: "transfer",
				status: "success",
				description: `Auto-save to ${goal.name}`,
				source: "wallet",
				destination: "sub_account",
				metadata: { goalId: goal._id, isAutoAllocation: true },
			});

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
 * List all goals for the user
 */
export const listGoals = async (req, res) => {
	try {
		const goals = await UserGoal.find({ userId: req.user._id }).sort({
			createdAt: -1,
		});

		// Enrich with sub-account data
		const enrichedGoals = await Promise.all(
			goals.map(async (goal) => {
				let subAccount = null;
				if (goal.subAccountId) {
					subAccount = await AnchorSubAccount.findOne({
						userId: req.user._id,
						subAccountId: goal.subAccountId,
					});
				}
				return {
					...goal.toObject(),
					subAccountBalance: subAccount?.balance || 0,
					isLocked: subAccount?.isLocked || false,
				};
			}),
		);

		res.status(200).json({
			success: true,
			data: enrichedGoals,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/**
 * Get single goal by ID
 */
export const getGoalById = async (req, res) => {
	try {
		const { id } = req.params;
		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		let subAccount = null;
		if (goal.subAccountId) {
			subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
		}

		res.status(200).json({
			success: true,
			data: {
				...goal.toObject(),
				subAccountBalance: subAccount?.balance || 0,
				isLocked: subAccount?.isLocked || false,
			},
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

/**
 * Create a new goal with Anchor sub-account
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
		} = req.body;

		// Get main wallet
		const wallet = await getMainWallet(req.user._id);

		// Create goal
		const goal = new UserGoal({
			userId: req.user._id,
			walletId: wallet._id,
			name,
			goalAmount,
			allocatedAmount: 0,
			icon,
			color,
			allocationSchedule: {
				frequency: frequency || "none",
				amount: autoAllocateAmount || 0,
				autoAllocateEnabled: autoAllocateEnabled || false,
			},
			commitmentSettings: {
				enabled: commitmentEnabled || false,
				releaseDate: releaseDate ? new Date(releaseDate) : null,
				committedAt: commitmentEnabled ? new Date() : null,
				originalGoalAmount: commitmentEnabled ? goalAmount : null,
			},
		});

		await goal.save();

		// Create sub-account for the goal
		const subAccount = await getOrCreateGoalSubAccount(req.user._id, goal);

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
			data: {
				...goal.toObject(),
				subAccountBalance: subAccount.balance,
				isLocked: subAccount.isLocked,
			},
			message: "Goal created successfully",
		});
	} catch (err) {
		console.error("Create goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Update goal
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
		} = req.body;

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		if (name) goal.name = name;
		if (goalAmount) goal.goalAmount = goalAmount;
		if (icon) goal.icon = icon;
		if (color) goal.color = color;

		if (
			frequency !== undefined ||
			autoAllocateAmount !== undefined ||
			autoAllocateEnabled !== undefined
		) {
			goal.allocationSchedule = {
				frequency:
					frequency !== undefined
						? frequency
						: goal.allocationSchedule.frequency,
				amount:
					autoAllocateAmount !== undefined
						? autoAllocateAmount
						: goal.allocationSchedule.amount,
				autoAllocateEnabled:
					autoAllocateEnabled !== undefined
						? autoAllocateEnabled
						: goal.allocationSchedule.autoAllocateEnabled,
			};

			// Update sub-account auto-save settings
			if (goal.subAccountId) {
				const subAccount = await AnchorSubAccount.findOne({
					userId: req.user._id,
					subAccountId: goal.subAccountId,
				});
				if (subAccount) {
					subAccount.autoSave = {
						enabled: goal.allocationSchedule.autoAllocateEnabled || false,
						amount: goal.allocationSchedule.amount || 0,
						frequency: goal.allocationSchedule.frequency || "monthly",
						dayOfMonth: 1,
					};
					subAccount.targetAmount = goal.goalAmount;
					await subAccount.save();
				}
			}

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
		});
	} catch (err) {
		console.error("Update goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Delete goal
 */
export const deleteGoal = async (req, res) => {
	try {
		const { id } = req.params;

		if (scheduledJobs.has(id)) {
			scheduledJobs.get(id).stop();
			scheduledJobs.delete(id);
		}

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// Delete sub-account if exists
		if (goal.subAccountId) {
			await AnchorSubAccount.findOneAndDelete({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
		}

		await goal.deleteOne();

		await sendPushToUser(
			req.user._id,
			"🗑️ Goal Deleted",
			`Your goal "${goal.name}" has been deleted.`,
			{ type: "goal_deleted", goalId: goal._id },
		);

		res.json({
			success: true,
			message: "Goal deleted successfully",
		});
	} catch (err) {
		console.error("Delete goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Toggle auto-allocation for a goal
 */
export const toggleAutoAllocate = async (req, res) => {
	try {
		const { id } = req.params;
		const { enabled } = req.body;

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		goal.allocationSchedule.autoAllocateEnabled = enabled;
		goal.updatedAt = new Date();
		await goal.save();

		// Update sub-account
		if (goal.subAccountId) {
			const subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
			if (subAccount) {
				subAccount.autoSave.enabled = enabled;
				await subAccount.save();
			}
		}

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
		});
	} catch (err) {
		console.error("Toggle auto-allocation error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Commit to a goal (lock funds until release date)
 */
export const commitToGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const { releaseDate } = req.body;

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

		// Update sub-account lock settings
		if (goal.subAccountId) {
			const subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
			if (subAccount) {
				subAccount.lockSettings = {
					enabled: true,
					unlockDate: releaseDateObj,
					lockedAt: new Date(),
				};
				await subAccount.save();
			}
		}

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
			message: `You've committed to this goal until ${releaseDateObj.toLocaleDateString()}. Early release may incur a penalty fee.`,
			data: goal,
		});
	} catch (err) {
		console.error("Commit to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Release from commitment
 */
export const releaseFromCommitment = async (req, res) => {
	try {
		const { id } = req.params;

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

		// Update sub-account lock settings
		if (goal.subAccountId) {
			const subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
			if (subAccount) {
				subAccount.lockSettings = {
					enabled: false,
					unlockDate: null,
					lockedAt: null,
				};
				await subAccount.save();
			}
		}

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
		});
	} catch (err) {
		console.error("Release from commitment error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Allocate funds to goal (manual deposit)
 */
export const allocateToGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const { amount } = req.body;

		if (amount <= 0) {
			return res.status(400).json({ error: "Invalid amount" });
		}

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const wallet = await getMainWallet(req.user._id);
		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		if (wallet.balance < amount) {
			return res.status(400).json({ error: "Insufficient wallet balance" });
		}

		const newAmount = goal.allocatedAmount + amount;
		if (newAmount > goal.goalAmount) {
			return res.status(400).json({
				error: `This allocation would exceed your goal. You can only allocate ${goal.goalAmount - goal.allocatedAmount} more.`,
			});
		}

		// Get or create sub-account
		const subAccount = await getOrCreateGoalSubAccount(req.user._id, goal);

		// Transfer from main wallet to sub-account
		wallet.balance -= amount;
		subAccount.balance += amount;
		await wallet.save();
		await subAccount.save();

		goal.allocatedAmount += amount;
		await goal.save();

		const isCompleted = goal.allocatedAmount >= goal.goalAmount;

		await sendPushToUser(
			req.user._id,
			"💰 Goal Funded",
			`₦${amount.toLocaleString()} added to ${goal.name}`,
			{ type: "goal_funded", goalId: goal._id, amount },
		);

		// Create transaction record
		await AnchorTransaction.create({
			userId: req.user._id,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			subAccountId: subAccount._id,
			amount: amount,
			currency: "NGN",
			type: "debit",
			category: "transfer",
			status: "success",
			description: `Manual allocation to ${goal.name}`,
			source: "wallet",
			destination: "sub_account",
			metadata: { goalId: goal._id, isManualAllocation: true },
		});

		// Stop auto-allocation if goal is completed
		if (
			goal.allocatedAmount >= goal.goalAmount &&
			scheduledJobs.has(goal._id)
		) {
			scheduledJobs.get(goal._id).stop();
			scheduledJobs.delete(goal._id);
		}

		res.json({
			success: true,
			data: goal,
			wallet: {
				_id: wallet._id,
				balance: wallet.balance,
				allocated: wallet.allocated || 0,
				available: wallet.balance - (wallet.allocated || 0),
			},
			subAccount: {
				balance: subAccount.balance,
				isLocked: subAccount.isLocked,
			},
			message: "Funds allocated successfully",
		});
	} catch (err) {
		console.error("Allocate to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Withdraw designated funds from goal
 */
export const withdrawDesignatedFunds = async (req, res) => {
	try {
		const { id } = req.params;
		const { amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({ error: "Invalid withdrawal amount" });
		}

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const subAccount = await AnchorSubAccount.findOne({
			userId: req.user._id,
			subAccountId: goal.subAccountId,
		});

		if (!subAccount) {
			return res.status(404).json({ error: "Goal sub-account not found" });
		}

		if (subAccount.balance < amount) {
			return res.status(400).json({ error: "Insufficient designated funds" });
		}

		const wallet = await getMainWallet(req.user._id);
		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		let penaltyFee = 0;
		let totalDeduction = amount;

		const isEarlyRelease = subAccount.isLocked;

		if (isEarlyRelease) {
			const penaltyRate = 0.07;
			penaltyFee = amount * penaltyRate;
			totalDeduction = amount + penaltyFee;
		}

		if (subAccount.balance < totalDeduction) {
			return res.status(400).json({
				error: `Insufficient designated funds. ${isEarlyRelease ? `Maximum withdrawable: ₦${Math.floor(subAccount.balance / 1.07)} (7% penalty applies).` : ""}`,
			});
		}

		// Deduct from sub-account
		subAccount.balance -= totalDeduction;
		await subAccount.save();

		// Add to main wallet
		wallet.balance += amount;
		wallet.allocated = Math.max(0, (wallet.allocated || 0) - totalDeduction);
		await wallet.save();

		// Update goal
		goal.allocatedAmount = Math.max(0, goal.allocatedAmount - totalDeduction);
		await goal.save();

		// Create transaction record for withdrawal
		await AnchorTransaction.create({
			userId: req.user._id,
			anchorCustomerId: wallet.anchorCustomerId,
			walletId: wallet._id,
			subAccountId: subAccount._id,
			amount: amount,
			currency: "NGN",
			type: "credit",
			category: "withdrawal",
			status: "success",
			description: `Withdrawal from ${goal.name}`,
			source: "sub_account",
			destination: "wallet",
			metadata: {
				goalId: goal._id,
				penaltyApplied: penaltyFee,
				isEarlyRelease: isEarlyRelease,
			},
		});

		await sendPushToUser(
			req.user._id,
			"💸 Goal Withdrawal",
			`₦${amount.toLocaleString()} withdrawn from ${goal.name}${penaltyFee > 0 ? ` (₦${penaltyFee.toFixed(2)} penalty applied)` : ""}`,
			{ type: "goal_withdrawn", goalId: goal._id, amount },
		);

		res.status(200).json({
			success: true,
			message: `Withdrawal successful.${penaltyFee > 0 ? ` ₦${penaltyFee.toFixed(2)} penalty applied for early release.` : ""}`,
			data: goal,
			wallet: {
				_id: wallet._id,
				balance: wallet.balance,
				allocated: wallet.allocated || 0,
				available: wallet.balance - (wallet.allocated || 0),
			},
			withdrawAmount: amount,
			penaltyApplied: penaltyFee,
		});
	} catch (err) {
		console.error("Withdraw designated funds error:", err);
		res.status(500).json({ error: err.message });
	}
};

/**
 * Get goal statistics
 */
export const getGoalStats = async (req, res) => {
	try {
		const { id } = req.params;
		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		let subAccount = null;
		if (goal.subAccountId) {
			subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
		}

		const progress = subAccount
			? (subAccount.balance / goal.goalAmount) * 100
			: 0;
		const remaining = goal.goalAmount - (subAccount?.balance || 0);

		res.json({
			success: true,
			stats: {
				id: goal._id,
				name: goal.name,
				goalAmount: goal.goalAmount,
				allocatedAmount: subAccount?.balance || 0,
				progress: Math.min(progress, 100),
				remaining: Math.max(0, remaining),
				completed: (subAccount?.balance || 0) >= goal.goalAmount,
				autoAllocateEnabled: goal.allocationSchedule.autoAllocateEnabled,
				autoAllocateFrequency: goal.allocationSchedule.frequency,
				autoAllocateAmount: goal.allocationSchedule.amount,
				isLocked: subAccount?.isLocked || false,
				releaseDate: subAccount?.lockSettings?.unlockDate || null,
				icon: goal.icon || "💰",
				color: goal.color || "#4F46E5",
			},
		});
	} catch (err) {
		console.error("Get goal stats error:", err);
		res.status(500).json({ error: err.message });
	}
};

// controllers/userGoalController.js - Add this function

/**
 * Get transactions for a specific goal
 */
export const getGoalTransactions = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const goal = await UserGoal.findOne({ _id: id, userId });
		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// Get transactions from AllocationRecord
		const allocations = await AllocationRecord.find({
			goalId: goal._id,
			userId: userId,
		})
			.sort({ timestamp: -1 })
			.limit(50)
			.lean();

		// Format transactions
		const transactions = allocations.map((record) => ({
			_id: record._id,
			type: record.type === "auto_allocation" ? "allocate" : "allocate",
			amount: record.amount,
			description:
				record.type === "auto_allocation"
					? "Auto-Save Deposit"
					: "Manual Deposit",
			createdAt: record.timestamp,
			balanceAfter: 0, // You may want to calculate this based on running total
		}));

		// Also get withdrawal transactions from AnchorTransaction if available
		try {
			const withdrawals = await AnchorTransaction.find({
				"metadata.goalId": goal._id,
				userId: userId,
				category: "withdrawal",
			})
				.sort({ createdAt: -1 })
				.limit(20)
				.lean();

			withdrawals.forEach((tx) => {
				transactions.push({
					_id: tx._id,
					type: "withdraw",
					amount: tx.amount,
					description: "Withdrawal",
					createdAt: tx.createdAt,
					balanceAfter: 0,
				});
			});
		} catch (err) {
			console.log("No withdrawal transactions found");
		}

		// Sort by date (newest first)
		transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

		// Calculate running balance
		let runningBalance = goal.allocatedAmount || 0;
		// Reverse to calculate from oldest to newest
		const reversed = [...transactions].reverse();
		for (const tx of reversed) {
			if (tx.type === "withdraw") {
				runningBalance += tx.amount;
				tx.balanceAfter = runningBalance;
			} else {
				runningBalance -= tx.amount;
				tx.balanceAfter = runningBalance;
			}
		}
		// Reverse back to newest first
		transactions.reverse();

		res.status(200).json({
			success: true,
			transactions: transactions,
			total: transactions.length,
		});
	} catch (err) {
		console.error("Get goal transactions error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Export all functions
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
};
