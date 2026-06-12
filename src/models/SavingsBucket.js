// models/SavingsBucket.js
import mongoose from "mongoose";

const savingsBucketSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	walletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Wallet",
		required: true,
	},
	name: { type: String, required: true },
	targetAmount: { type: Number, default: 0, required: true },
	currentAmount: { type: Number, default: 0 },
	topUpSchedule: {
		frequency: {
			type: String,
			enum: ["none", "daily", "weekly", "bi-weekly", "monthly"],
			default: "none",
		},
		amount: { type: Number, default: 0 },
		autoSaveEnabled: { type: Boolean, default: false },
	},
	// Lock feature
	lockSettings: {
		enabled: { type: Boolean, default: false },
		unlockDate: { type: Date, default: null },
		lockedAt: { type: Date, default: null },
		originalTargetAmount: { type: Number, default: null },
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Index for faster queries
savingsBucketSchema.index({ userId: 1, createdAt: -1 });
savingsBucketSchema.index({ "lockSettings.unlockDate": 1 });
savingsBucketSchema.index({ "lockSettings.enabled": 1 });

// Virtual to check if bucket is locked
savingsBucketSchema.virtual("isLocked").get(function () {
	if (!this.lockSettings.enabled) return false;
	if (!this.lockSettings.unlockDate) return false;
	return new Date() < this.lockSettings.unlockDate;
});

// Virtual to check if bucket can be unlocked (for early withdrawal)
savingsBucketSchema.virtual("canWithdrawEarly").get(function () {
	if (!this.lockSettings.enabled) return true;
	if (!this.lockSettings.unlockDate) return true;
	return new Date() >= this.lockSettings.unlockDate;
});

// Method to calculate early withdrawal penalty (1.2x the withdrawal amount)
savingsBucketSchema.methods.calculatePenalty = function (withdrawAmount) {
	const penaltyMultiplier = 1.07;
	const penalty = withdrawAmount * (penaltyMultiplier - 1); // 7% penalty
	return {
		penalty,
		totalDeduction: withdrawAmount + penalty,
		multiplier: penaltyMultiplier,
	};
};

export default mongoose.model("SavingsBucket", savingsBucketSchema);
