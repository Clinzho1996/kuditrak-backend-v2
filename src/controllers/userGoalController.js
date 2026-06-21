// controllers/userGoalController.js
import cron from "node-cron";
import AllocationRecord from "../models/AllocationRecord.js";
import AnchorSubAccount from "../models/AnchorSubAccount.js";
import AnchorTransaction from "../models/AnchorTransaction.js";
import AnchorWallet from "../models/AnchorWallet.js";
import Transaction from "../models/Transaction.js";
import UserGoal from "../models/UserGoal.js";
import { getOrCreateAnchorCustomer } from "../services/anchorCustomerService.js";
import { sendGoalNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";

// Store scheduled jobs
const scheduledJobs = new Map();

// ==================== HELPER FUNCTIONS ====================

/**
 * Get or create user's main wallet
 */
// controllers/userGoalController.js - getMainWallet

const getMainWallet = async (userId) => {
	try {
		let wallet = await AnchorWallet.findOne({ userId, walletType: "main" });

		if (!wallet) {
			console.log("🔄 No wallet found, creating one for user:", userId);

			// Try to get Anchor customer
			const customerResult = await getOrCreateAnchorCustomer(userId);
			if (!customerResult.success) {
				throw new Error(
					"Failed to get/create Anchor customer: " + customerResult.error,
				);
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

			console.log("✅ Wallet created:", wallet._id);
		}

		return wallet;
	} catch (error) {
		console.error("❌ getMainWallet error:", error);
		throw error;
	}
};

/**
 * Get or create goal sub-account
 */
// controllers/userGoalController.js - Fix getOrCreateGoalSubAccount

const getOrCreateGoalSubAccount = async (userId, goal) => {
	let subAccount = await AnchorSubAccount.findOne({
		userId,
		subAccountId: goal.subAccountId || `goal_${goal._id}`,
	});

	if (!subAccount) {
		const mainWallet = await getMainWallet(userId);

		// ✅ FIX: Only use valid frequency values
		const frequency = goal.allocationSchedule?.frequency || "monthly";
		const validFrequency = ["daily", "weekly", "monthly"].includes(frequency)
			? frequency
			: "monthly";

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
				frequency: validFrequency, // ✅ Always use a valid enum value
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

// controllers/userGoalController.js - Fixed createGoal

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

		console.log("📥 Create goal request body:", req.body);
		console.log("👤 User ID:", req.user._id);

		// ✅ Validate required fields
		if (!name) {
			return res.status(400).json({ error: "Name is required" });
		}

		if (!goalAmount || goalAmount <= 0) {
			return res.status(400).json({ error: "Valid goal amount is required" });
		}

		// ✅ Get main wallet - with better error handling
		let wallet;
		try {
			wallet = await getMainWallet(req.user._id);
		} catch (walletError) {
			console.error("❌ Wallet error:", walletError);
			return res.status(500).json({
				error: "Failed to get or create wallet",
				details: walletError.message,
			});
		}

		if (!wallet) {
			return res
				.status(500)
				.json({ error: "Wallet not found or could not be created" });
		}

		console.log("✅ Wallet found:", wallet._id);

		// ✅ Create goal with all required fields
		const goalData = {
			userId: req.user._id,
			walletId: wallet._id,
			name: name,
			goalAmount: goalAmount,
			allocatedAmount: 0,
			icon: icon,
			color: color,
			lockType: lockType,
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

		console.log("📝 Creating goal with data:", goalData);

		const goal = new UserGoal(goalData);
		await goal.save();

		console.log("✅ Goal saved:", goal._id);

		// Create sub-account for the goal
		let subAccount;
		try {
			subAccount = await getOrCreateGoalSubAccount(req.user._id, goal);
		} catch (subError) {
			console.error("❌ Sub-account error:", subError);
			// Continue even if sub-account fails - the goal is already created
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
			data: {
				...goal.toObject(),
				subAccountBalance: subAccount?.balance || 0,
				isLocked: subAccount?.isLocked || false,
			},
			message: "Goal created successfully",
		});
	} catch (err) {
		console.error("❌ Create goal error:", err);
		res.status(500).json({
			error: err.message,
			details: err.stack,
		});
	}
};

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
			autoSaveEnabled,
			autoSaveAmount,
		} = req.body;

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// Update basic fields
		if (name) goal.name = name;
		if (goalAmount) goal.goalAmount = goalAmount;
		if (icon) goal.icon = icon;
		if (color) goal.color = color;

		// ✅ Update lockType if provided
		if (lockType) {
			goal.lockType = lockType;
		}

		// Handle Lock Type / Commitment Settings
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
		} else if (releaseDate !== undefined) {
			if (releaseDate) {
				goal.commitmentSettings = {
					...goal.commitmentSettings,
					enabled: true,
					releaseDate: new Date(releaseDate),
					committedAt: goal.commitmentSettings?.committedAt || new Date(),
				};
			} else {
				goal.commitmentSettings = {
					...goal.commitmentSettings,
					enabled: false,
					releaseDate: null,
				};
			}
		}

		// Handle Auto-Save Settings
		if (
			frequency !== undefined ||
			autoAllocateAmount !== undefined ||
			autoAllocateEnabled !== undefined ||
			autoSaveEnabled !== undefined ||
			autoSaveAmount !== undefined
		) {
			const newFrequency =
				frequency !== undefined
					? frequency
					: goal.allocationSchedule?.frequency;
			const newAmount =
				autoAllocateAmount !== undefined
					? autoAllocateAmount
					: autoSaveAmount !== undefined
						? autoSaveAmount
						: goal.allocationSchedule?.amount;
			const newAutoAllocateEnabled =
				autoAllocateEnabled !== undefined
					? autoAllocateEnabled
					: autoSaveEnabled !== undefined
						? autoSaveEnabled
						: goal.allocationSchedule?.autoAllocateEnabled;

			goal.allocationSchedule = {
				frequency: newFrequency || "monthly",
				amount: newAmount || 0,
				autoAllocateEnabled: newAutoAllocateEnabled || false,
			};

			// Update sub-account
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

		// Fetch updated sub-account
		let subAccount = null;
		if (goal.subAccountId) {
			subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
		}

		res.json({
			success: true,
			data: {
				...goal.toObject(),
				subAccountBalance: subAccount?.balance || 0,
				isLocked: subAccount?.isLocked || false,
			},
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

// controllers/userGoalController.js - Fixed deleteGoal

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

		// ✅ Initialize variables
		let subAccount = null;
		let subAccountBalance = 0;
		let refundAmount = 0;
		let penaltyApplied = 0;
		let refundMessage = "";

		// ✅ Get sub-account to check balance
		if (goal.subAccountId) {
			subAccount = await AnchorSubAccount.findOne({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});

			if (subAccount) {
				subAccountBalance = subAccount.balance || 0;
				console.log(`💰 Sub-account balance: ₦${subAccountBalance}`);
			}
		}

		// ✅ Get main wallet
		const wallet = await AnchorWallet.findOne({
			userId: req.user._id,
			walletType: "main",
		});

		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		console.log("📊 Wallet before deletion:", {
			balance: wallet.balance,
			allocated: wallet.allocated || 0,
			available: wallet.available || 0,
		});

		// ✅ CRITICAL FIX: Check BOTH sub-account balance AND goal.allocatedAmount
		// The funds might be in the wallet's "allocated" field, not in the sub-account
		const totalAllocatedFunds = subAccountBalance + (goal.allocatedAmount || 0);

		console.log(
			`💰 Total funds to refund: ₦${totalAllocatedFunds} (subAccount: ₦${subAccountBalance}, goal.allocatedAmount: ₦${goal.allocatedAmount})`,
		);

		if (totalAllocatedFunds > 0) {
			refundAmount = totalAllocatedFunds;

			// ✅ Check lock type
			const isHardLock = goal.lockType === "Hard Lock";
			const isSoftLock = goal.lockType === "Soft Lock";

			// ✅ For Hard Lock: Check if target date has passed
			if (isHardLock && goal.commitmentSettings?.releaseDate) {
				const now = new Date();
				const releaseDate = new Date(goal.commitmentSettings.releaseDate);

				if (now < releaseDate) {
					return res.status(400).json({
						error: "Cannot delete this goal",
						message: `This goal has a Hard Lock and cannot be deleted until ${releaseDate.toLocaleDateString()}.`,
						lockType: "Hard Lock",
						releaseDate: releaseDate.toISOString(),
						remainingDays: Math.ceil(
							(releaseDate - now) / (1000 * 60 * 60 * 24),
						),
					});
				}
			}

			// ✅ For Soft Lock: Apply 7% penalty on refund
			if (isSoftLock && goal.commitmentSettings?.releaseDate) {
				const now = new Date();
				const releaseDate = new Date(goal.commitmentSettings.releaseDate);

				if (now < releaseDate) {
					const penaltyRate = 0.07;
					penaltyApplied = Math.round(totalAllocatedFunds * penaltyRate);
					refundAmount = totalAllocatedFunds - penaltyApplied;
					refundMessage = `7% penalty (₦${penaltyApplied.toLocaleString()}) applied for early withdrawal.`;
					console.log(`⚠️ Soft lock penalty: ₦${penaltyApplied}`);
				}
			}

			// ✅ Refund to main wallet
			wallet.balance += refundAmount;

			// ✅ Reduce allocated by the total amount (not just refundAmount)
			wallet.allocated = Math.max(
				0,
				(wallet.allocated || 0) - totalAllocatedFunds,
			);
			wallet.available = wallet.balance - wallet.allocated;
			await wallet.save();

			console.log("📊 Wallet after refund:", {
				balance: wallet.balance,
				allocated: wallet.allocated || 0,
				available: wallet.available || 0,
				refundAmount: refundAmount,
			});

			// ✅ Create refund transaction
			await AnchorTransaction.create({
				userId: req.user._id,
				anchorCustomerId: wallet.anchorCustomerId,
				walletId: wallet._id,
				amount: refundAmount,
				currency: "NGN",
				type: "credit",
				category: "refund",
				status: "success",
				description: `Refund from deleted goal: ${goal.name}${penaltyApplied > 0 ? ` (${penaltyApplied} penalty applied)` : ""}`,
				source: "sub_account",
				destination: "wallet",
				metadata: {
					goalId: goal._id,
					goalName: goal.name,
					originalAmount: totalAllocatedFunds,
					penaltyApplied: penaltyApplied,
					refundAmount: refundAmount,
					lockType: goal.lockType,
					deletedAt: new Date().toISOString(),
				},
			});

			console.log(`✅ Refund transaction created for ₦${refundAmount}`);
		} else {
			console.log("ℹ️ No funds to refund");
		}

		// ✅ Reset goal's allocatedAmount to 0 (in case it wasn't in sub-account)
		goal.allocatedAmount = 0;
		await goal.save();

		// ✅ Delete sub-account if exists
		if (goal.subAccountId) {
			await AnchorSubAccount.findOneAndDelete({
				userId: req.user._id,
				subAccountId: goal.subAccountId,
			});
		}

		// ✅ Delete the goal
		await goal.deleteOne();

		// ✅ Send notification
		let notificationBody = `Your goal "${goal.name}" has been deleted.`;
		if (refundAmount > 0) {
			notificationBody += ` ₦${Math.floor(refundAmount).toLocaleString()} has been refunded to your wallet.${penaltyApplied > 0 ? ` (₦${penaltyApplied.toLocaleString()} penalty applied)` : ""}`;
		}

		await sendPushToUser(req.user._id, "🗑️ Goal Deleted", notificationBody, {
			type: "goal_deleted",
			goalId: goal._id,
			refundAmount: refundAmount || 0,
			penaltyApplied: penaltyApplied,
		});

		res.json({
			success: true,
			message: "Goal deleted successfully",
			refundAmount: refundAmount || 0,
			penaltyApplied: penaltyApplied || 0,
			lockType: goal.lockType,
			wasLocked: goal.commitmentSettings?.enabled || false,
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

// controllers/userGoalController.js - Fixed allocateToGoal

// controllers/userGoalController.js - Fixed allocateToGoal

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

		const wallet = await AnchorWallet.findOne({ userId: req.user._id });
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

		// ✅ 1. Check if committed BEFORE processing (to know if we need to warn)
		const isCommitted =
			goal.isCommitted || goal.commitmentSettings?.enabled || false;
		let commitmentWarning = null;

		if (isCommitted && goal.commitmentSettings?.releaseDate) {
			commitmentWarning = `You've committed to this goal until ${new Date(goal.commitmentSettings.releaseDate).toLocaleDateString()}. You can still allocate funds, but early withdrawal penalties apply.`;
		}

		// ✅ 2. PROCESS THE ALLOCATION FIRST (always)
		// Update wallet
		wallet.balance -= amount;
		wallet.allocated = (wallet.allocated || 0) + amount;
		wallet.available = wallet.balance - wallet.allocated;
		await wallet.save();

		// Update goal allocated amount
		goal.allocatedAmount += amount;
		await goal.save();

		const isCompleted = goal.allocatedAmount >= goal.goalAmount;

		// ✅ 3. Create allocation record
		try {
			const allocationRecord = await AllocationRecord.create({
				goalId: goal._id,
				userId: req.user._id,
				amount: amount,
				type: "manual_allocation",
				timestamp: new Date(),
				description: `Manual allocation to ${goal.name}`,
				balanceAfter: goal.allocatedAmount,
				metadata: {
					wasCommitted: isCommitted,
					commitmentWarning: commitmentWarning,
				},
			});
			console.log("✅ Allocation record created:", allocationRecord);
		} catch (recordError) {
			console.error("❌ Failed to create allocation record:", recordError);
		}

		// ✅ 4. Send notification
		await sendGoalNotification(
			req.user._id,
			goal.name,
			goal.allocatedAmount,
			goal.goalAmount,
			isCompleted ? "completed" : "updated",
		);

		const updatedWallet = await AnchorWallet.findOne({ userId: req.user._id });
		if (updatedWallet) {
			updatedWallet.available = updatedWallet.balance - updatedWallet.allocated;
			await updatedWallet.save();
		}

		// Stop auto-allocation if goal is completed
		if (
			goal.allocatedAmount >= goal.goalAmount &&
			scheduledJobs.has(goal._id)
		) {
			scheduledJobs.get(goal._id).stop();
			scheduledJobs.delete(goal._id);
		}

		// ✅ 5. Get the latest allocation record
		const allocation = await AllocationRecord.findOne({
			goalId: goal._id,
			userId: req.user._id,
		}).sort({ timestamp: -1 });

		// ✅ 6. Return response with commitment warning if applicable
		const responseData = {
			success: true,
			data: goal,
			wallet: {
				_id: updatedWallet?._id || wallet._id,
				balance: updatedWallet?.balance || wallet.balance,
				allocated: updatedWallet?.allocated || wallet.allocated || 0,
				available:
					updatedWallet?.available || wallet.balance - (wallet.allocated || 0),
			},
			allocation: allocation,
			message: "Funds allocated successfully",
		};

		// ✅ If there was a commitment warning, include it in the response
		if (commitmentWarning) {
			return res.status(403).json({
				...responseData,
				error: commitmentWarning,
				commitmentActive: true,
			});
		}

		res.json(responseData);
	} catch (err) {
		console.error("Allocate to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};
// controllers/userGoalController.js - Fixed withdrawDesignatedFunds

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

		if (goal.allocatedAmount < amount) {
			return res.status(400).json({ error: "Insufficient designated funds" });
		}

		let wallet = await AnchorWallet.findOne({ userId: req.user._id });
		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		let penaltyFee = 0;
		let totalDeduction = amount;
		let penaltyMessage = "";

		const isEarlyRelease =
			goal.commitmentSettings?.enabled &&
			goal.commitmentSettings?.releaseDate &&
			new Date() < new Date(goal.commitmentSettings.releaseDate);

		if (isEarlyRelease) {
			const penaltyRate = 0.07;
			penaltyFee = amount * penaltyRate;
			totalDeduction = amount + penaltyFee;
			penaltyMessage = ` Early release penalty (7%): ₦${penaltyFee.toFixed(2)} applied.`;
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

		// Update wallet
		wallet.balance += amount;
		wallet.allocated = Math.max(0, (wallet.allocated || 0) - totalDeduction);
		wallet.available = wallet.balance - wallet.allocated;
		await wallet.save();

		// Create withdrawal record
		try {
			const withdrawalRecord = await AllocationRecord.create({
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
				},
			});
			console.log("✅ Withdrawal record created:", withdrawalRecord);
		} catch (recordError) {
			console.error("❌ Failed to create withdrawal record:", recordError);
		}

		// Create transaction record
		await Transaction.create({
			walletId: wallet._id,
			userId: req.user._id,
			transactionId: `WITHDRAW-GOAL-${goal._id}-${Date.now()}`,
			type: "expense",
			amount: amount,
			status: "Completed",
			description: `Withdrawal of designated funds from goal: ${goal.name}`,
			source: "goal_withdrawal",
			metadata: {
				goalId: goal._id,
				goalName: goal.name,
				wasCommitted: isEarlyRelease,
				penaltyApplied: penaltyFee,
				totalDeduction: totalDeduction,
			},
		});

		// Create penalty transaction if applicable
		if (penaltyFee > 0) {
			const platformWallet = await AnchorWallet.findOne({
				userId: process.env.SYSTEM_BUCKET_ID,
			});
			if (platformWallet) {
				platformWallet.balance += penaltyFee;
				platformWallet.available =
					platformWallet.balance - platformWallet.allocated;
				await platformWallet.save();

				await Transaction.create({
					walletId: platformWallet._id,
					userId: process.env.SYSTEM_BUCKET_ID,
					transactionId: `PENALTY-${goal._id}-${Date.now()}`,
					type: "income",
					amount: penaltyFee,
					status: "Completed",
					description: `Early release penalty fee from user ${req.user._id} for goal: ${goal.name}`,
					source: "penalty_fee",
					metadata: {
						userId: req.user._id,
						goalId: goal._id,
						goalName: goal.name,
						withdrawAmount: amount,
						penaltyAmount: penaltyFee,
					},
				});
			}
		}

		const updatedWallet = await AnchorWallet.findOne({ userId: req.user._id });
		if (updatedWallet) {
			updatedWallet.available = updatedWallet.balance - updatedWallet.allocated;
			await updatedWallet.save();
		}

		const allocation = await AllocationRecord.findOne({
			goalId: goal._id,
			userId: req.user._id,
		}).sort({ timestamp: -1 });

		res.status(200).json({
			success: true,
			message: `Withdrawal successful.${penaltyMessage} These funds are now available in your wallet balance.`,
			data: goal,
			wallet: {
				_id: updatedWallet?._id || wallet._id,
				balance: updatedWallet?.balance || wallet.balance,
				allocated: updatedWallet?.allocated || wallet.allocated || 0,
				available:
					updatedWallet?.available || wallet.balance - (wallet.allocated || 0),
			},
			allocation: allocation,
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

// controllers/userGoalController.js - Updated getGoalTransactions

export const getGoalTransactions = async (req, res) => {
	try {
		const { id } = req.params;
		const userId = req.user._id;

		const goal = await UserGoal.findOne({ _id: id, userId });
		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		// ✅ Get ALL allocation records (including withdrawals)
		const records = await AllocationRecord.find({
			goalId: goal._id,
			userId: userId,
		})
			.sort({ timestamp: -1 })
			.lean();

		console.log(`📊 Found ${records.length} allocation records`);

		// Format transactions
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
			};
		});

		// Sort by date (newest first)
		transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
