// controllers/userGoalController.js
import cron from "node-cron";
import AllocationRecord from "../models/AllocationRecord.js";
import Transaction from "../models/Transaction.js";
import UserGoal from "../models/UserGoal.js";
import Wallet from "../models/Wallet.js";
import { sendGoalNotification } from "../services/notificationService.js";
import { checkLimits } from "../services/subscriptionService.js";

// CBN-compliance disclaimer for all responses
const CBN_DISCLAIMER = {
	disclaimer:
		"⚠️ This is NOT a savings account. Kuditrak is not a licensed deposit-taking institution. Funds remain in your wallet and are not insured by NDIC. This is a fund management tool only.",
	regulatoryNote:
		"You retain full control and ownership of your funds at all times.",
};

// List all goals for the user
export const listGoals = async (req, res) => {
	try {
		const goals = await UserGoal.find({ userId: req.user._id }).sort({
			createdAt: -1,
		});

		res.status(200).json({
			success: true,
			data: goals,
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Get single goal by ID
export const getGoalById = async (req, res) => {
	try {
		const { id } = req.params;
		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		res.status(200).json({
			success: true,
			data: goal,
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

// Update goal (rename, adjust target, update auto-allocation settings)
export const updateGoal = async (req, res) => {
	try {
		const { id } = req.params;
		const {
			name,
			goalAmount,
			frequency,
			autoAllocateAmount,
			autoAllocateEnabled,
		} = req.body;

		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		if (goal) goal.name = name;
		if (goalAmount) goal.goalAmount = goalAmount;

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
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Update goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Delete a goal
export const deleteGoal = async (req, res) => {
	try {
		const { id } = req.params;

		if (scheduledJobs.has(id)) {
			scheduledJobs.get(id).stop();
			scheduledJobs.delete(id);
		}

		const deleted = await UserGoal.findOneAndDelete({
			_id: id,
			userId: req.user._id,
		});

		if (!deleted) {
			return res.status(404).json({ error: "Goal not found" });
		}

		await sendGoalNotification(
			req.user._id,
			deleted.name,
			0,
			deleted.goalAmount,
			"deleted",
		);

		res.json({
			success: true,
			message:
				"Goal deleted successfully. Any funds already allocated remain in your wallet.",
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Delete goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Toggle auto-allocation for a goal
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
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Toggle auto-allocation error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Store scheduled jobs
const scheduledJobs = new Map();

// Helper function to schedule auto-allocation
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
			const goal = await UserGoal.findOne({ _id: goalId, userId: userId });
			if (
				!goal ||
				goal.isCommitted ||
				goal.allocatedAmount >= goal.goalAmount
			) {
				if (scheduledJobs.has(goalId)) {
					scheduledJobs.get(goalId).stop();
					scheduledJobs.delete(goalId);
				}
				return;
			}

			const wallet = await Wallet.findOne({ userId: userId });
			if (!wallet || wallet.balance < amount) return;

			// Use 'allocated' not 'designatedFunds'
			wallet.balance -= amount;
			wallet.allocated = (wallet.allocated || 0) + amount;
			wallet.available = wallet.balance - wallet.allocated;
			await wallet.save();

			goal.allocatedAmount += amount;
			await goal.save();

			await AllocationRecord.create({
				goalId: goal._id,
				userId: userId,
				amount: amount,
				type: "auto_allocation",
				timestamp: new Date(),
			});
		} catch (err) {
			console.error(`Error in auto-allocation for goal ${goalId}:`, err);
		}
	});

	scheduledJobs.set(goalId, job);
};

// Create a new goal with optional commitment feature
export const createGoal = async (req, res) => {
	try {
		const {
			name,
			goalAmount,
			frequency,
			autoAllocateAmount,
			commitmentEnabled,
			releaseDate,
		} = req.body;

		await checkLimits(req.user._id, "user_goal");

		let wallet = await Wallet.findOne({ userId: req.user._id });
		if (!wallet) {
			wallet = await Wallet.create({ userId: req.user._id });
		}

		let commitmentSettings = {
			enabled: commitmentEnabled || false,
			releaseDate: null,
			committedAt: null,
			originalGoalAmount: null,
		};

		if (commitmentEnabled && releaseDate) {
			const releaseDateObj = new Date(releaseDate);
			if (isNaN(releaseDateObj.getTime())) {
				return res.status(400).json({ error: "Invalid release date" });
			}
			if (releaseDateObj <= new Date()) {
				return res
					.status(400)
					.json({ error: "Release date must be in the future" });
			}
			commitmentSettings = {
				enabled: true,
				releaseDate: releaseDateObj,
				committedAt: new Date(),
				originalGoalAmount: goalAmount,
			};
		}

		const goal = new UserGoal({
			userId: req.user._id,
			walletId: wallet._id,
			name,
			goalAmount,
			allocatedAmount: 0,
			allocationSchedule: {
				frequency: frequency || "none",
				amount: autoAllocateAmount || 0,
				autoAllocateEnabled: !!(
					frequency &&
					frequency !== "none" &&
					autoAllocateAmount > 0
				),
			},
			commitmentSettings,
		});

		await goal.save();

		if (goal.allocationSchedule.autoAllocateEnabled) {
			scheduleAutoAllocation(
				goal._id,
				goal.userId,
				goal.allocationSchedule.frequency,
				goal.allocationSchedule.amount,
			);
		}

		await sendGoalNotification(
			req.user._id,
			goal.name,
			0,
			goal.goalAmount,
			"created",
		);

		res.status(201).json({
			success: true,
			data: goal,
			message:
				"Goal created successfully. Remember: funds remain in your wallet and are just designated for this purpose.",
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Create goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Commit to a goal (formerly "lock")
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

		if (scheduledJobs.has(goal._id)) {
			scheduledJobs.get(goal._id).stop();
			scheduledJobs.delete(goal._id);
		}

		res.json({
			success: true,
			message: `You've committed to this goal until ${releaseDateObj.toLocaleDateString()}. Early release may incur a penalty fee.`,
			data: goal,
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Commit to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Release from commitment (formerly "unlock")
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

		res.json({
			success: true,
			message:
				"You've been released from your commitment. You can now withdraw designated funds without penalty.",
			data: goal,
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Release from commitment error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Allocate funds to goal (manual deposit)
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

		if (goal.isCommitted) {
			return res.status(403).json({
				error: `You've committed to this goal until ${goal.commitmentSettings.releaseDate.toLocaleDateString()}. You can still allocate funds, but early withdrawal penalties apply.`,
				commitmentActive: true,
			});
		}

		const wallet = await Wallet.findOne({ userId: req.user._id });
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

		// Update wallet - use 'allocated' not 'designatedFunds'
		wallet.balance -= amount;
		wallet.allocated = (wallet.allocated || 0) + amount;
		wallet.available = wallet.balance - wallet.allocated;
		await wallet.save();

		// Update goal allocated amount
		goal.allocatedAmount += amount;
		await goal.save();

		const isCompleted = goal.allocatedAmount >= goal.goalAmount;

		await sendGoalNotification(
			req.user._id,
			goal.name,
			goal.allocatedAmount,
			goal.goalAmount,
			isCompleted ? "completed" : "updated",
		);

		// Create allocation record
		try {
			await AllocationRecord.create({
				goalId: goal._id,
				userId: req.user._id,
				amount: amount,
				type: "manual_allocation",
				timestamp: new Date(),
			});
		} catch (recordError) {
			console.error("Failed to create allocation record:", recordError);
		}

		const updatedWallet = await Wallet.findOne({ userId: req.user._id });
		updatedWallet.available = updatedWallet.balance - updatedWallet.allocated;

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
				_id: updatedWallet._id,
				balance: updatedWallet.balance,
				allocated: updatedWallet.allocated || 0,
				available: updatedWallet.available,
			},
			message:
				"Funds allocated successfully. These funds remain in your wallet but are designated for this goal.",
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Allocate to goal error:", err);
		res.status(500).json({ error: err.message });
	}
};

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

		// Get user's wallet
		let wallet = await Wallet.findOne({ userId: req.user._id });
		if (!wallet) {
			return res.status(404).json({ error: "Wallet not found" });
		}

		// Get or create platform wallet using SYSTEM_BUCKET_ID from env
		const platformWalletId = process.env.SYSTEM_BUCKET_ID;
		if (!platformWalletId) {
			console.error("SYSTEM_BUCKET_ID not set in environment variables");
			// Continue without platform wallet - just log the penalty but don't collect it
		}

		let platformWallet = null;
		if (platformWalletId) {
			platformWallet = await Wallet.findOne({ userId: platformWalletId });
			if (!platformWallet) {
				platformWallet = await Wallet.create({
					userId: platformWalletId,
					balance: 0,
					allocated: 0,
					available: 0,
					currency: "NGN",
				});
				console.log("Platform wallet created with ID:", platformWalletId);
			}
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

		// Update wallet - use 'allocated' field
		wallet.balance += amount;
		wallet.allocated = Math.max(0, (wallet.allocated || 0) - totalDeduction);
		wallet.available = wallet.balance - wallet.allocated;
		await wallet.save();

		// Add penalty to platform wallet if applicable and platform wallet exists
		if (penaltyFee > 0 && platformWallet) {
			platformWallet.balance += penaltyFee;
			platformWallet.available =
				platformWallet.balance - platformWallet.allocated;
			await platformWallet.save();
		}

		// Create transaction record for withdrawal
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

		// Create transaction record for penalty if applicable
		if (penaltyFee > 0 && platformWallet) {
			await Transaction.create({
				walletId: platformWallet._id,
				userId: platformWalletId,
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

		// Get updated wallet with correct available balance
		const updatedWallet = await Wallet.findOne({ userId: req.user._id });
		updatedWallet.available = updatedWallet.balance - updatedWallet.allocated;

		res.status(200).json({
			success: true,
			message: `Withdrawal successful.${penaltyMessage} These funds are now available in your wallet balance.`,
			data: goal,
			wallet: {
				_id: updatedWallet._id,
				balance: updatedWallet.balance,
				allocated: updatedWallet.allocated || 0,
				available: updatedWallet.available,
			},
			withdrawAmount: amount,
			penaltyApplied: penaltyFee,
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Withdraw designated funds error:", err);
		res.status(500).json({ error: err.message });
	}
};

// Get goal statistics
export const getGoalStats = async (req, res) => {
	try {
		const { id } = req.params;
		const goal = await UserGoal.findOne({ _id: id, userId: req.user._id });

		if (!goal) {
			return res.status(404).json({ error: "Goal not found" });
		}

		const progress = (goal.allocatedAmount / goal.goalAmount) * 100;
		const remaining = goal.goalAmount - goal.allocatedAmount;

		let commitmentInfo = {
			isCommitted: goal.isCommitted,
			enabled: goal.commitmentSettings.enabled,
			releaseDate: goal.commitmentSettings.releaseDate,
			committedAt: goal.commitmentSettings.committedAt,
			canReleaseEarly: goal.canReleaseEarly,
		};

		if (goal.isCommitted && !goal.canReleaseEarly) {
			const now = new Date();
			const daysRemaining = Math.ceil(
				(goal.commitmentSettings.releaseDate - now) / (1000 * 60 * 60 * 24),
			);
			commitmentInfo.daysRemaining = daysRemaining;
			commitmentInfo.earlyReleasePenaltyRate = "7%";
		}

		res.json({
			success: true,
			stats: {
				id: goal._id,
				name: goal.name,
				goalAmount: goal.goalAmount,
				allocatedAmount: goal.allocatedAmount,
				progress: Math.min(progress, 100),
				remaining: remaining,
				completed: goal.allocatedAmount >= goal.goalAmount,
				autoAllocateEnabled: goal.allocationSchedule.autoAllocateEnabled,
				autoAllocateFrequency: goal.allocationSchedule.frequency,
				autoAllocateAmount: goal.allocationSchedule.amount,
				commitmentInfo,
			},
			...CBN_DISCLAIMER,
		});
	} catch (err) {
		console.error("Get goal stats error:", err);
		res.status(500).json({ error: err.message });
	}
};
