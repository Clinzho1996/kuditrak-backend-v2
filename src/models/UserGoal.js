// models/UserGoal.js
import mongoose from "mongoose";

const userGoalSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	walletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Wallet",
		required: true,
	},

	// Goal details (NOT savings)
	name: { type: String, required: true },
	goalAmount: { type: Number, required: true, min: 0 },
	allocatedAmount: { type: Number, default: 0, min: 0 },

	// Auto-allocation (NOT auto-save)
	allocationSchedule: {
		frequency: {
			type: String,
			enum: ["none", "daily", "weekly", "bi-weekly", "monthly"],
			default: "none",
		},
		amount: { type: Number, default: 0, min: 0 },
		autoAllocateEnabled: { type: Boolean, default: false },
	},

	// Commitment feature (NOT lock)
	commitmentSettings: {
		enabled: { type: Boolean, default: false },
		releaseDate: { type: Date, default: null },
		committedAt: { type: Date, default: null },
		originalGoalAmount: { type: Number, default: null },
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Virtual for commitment status
userGoalSchema.virtual("isCommitted").get(function () {
	return (
		this.commitmentSettings.enabled &&
		this.commitmentSettings.releaseDate &&
		new Date() < this.commitmentSettings.releaseDate
	);
});

// Virtual for early release eligibility
userGoalSchema.virtual("canReleaseEarly").get(function () {
	return (
		!this.commitmentSettings.enabled ||
		new Date() >= this.commitmentSettings.releaseDate
	);
});

export default mongoose.model("UserGoal", userGoalSchema);
