// backend/models/AnchorSubAccount.js
import mongoose from "mongoose";

const anchorSubAccountSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},

	parentWalletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorWallet",
		required: true,
	},

	// Sub-account details
	subAccountId: {
		type: String,
		required: true,
		unique: true,
	},

	// Sub-account name
	name: {
		type: String,
		required: true,
	},

	// Sub-account type
	type: {
		type: String,
		enum: ["savings", "goal", "budget", "business", "family"],
		default: "savings",
	},

	// Balance
	balance: {
		type: Number,
		default: 0,
		min: 0,
	},

	// Target amount (for goals)
	targetAmount: {
		type: Number,
		default: null,
	},

	// Auto-save settings
	autoSave: {
		enabled: { type: Boolean, default: false },
		amount: { type: Number, default: 0 },
		frequency: {
			type: String,
			enum: ["daily", "weekly", "monthly"],
			default: "monthly",
		},
		dayOfMonth: { type: Number, default: 1 },
	},

	// Lock settings
	lockSettings: {
		enabled: { type: Boolean, default: false },
		unlockDate: { type: Date, default: null },
		lockedAt: { type: Date, default: null },
	},

	// Sub-account status
	status: {
		type: String,
		enum: ["active", "frozen", "closed", "completed"],
		default: "active",
	},

	// Color/icon for UI
	icon: { type: String, default: "💰" },
	color: { type: String, default: "#4F46E5" },

	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

anchorSubAccountSchema.index({ userId: 1, parentWalletId: 1 });
anchorSubAccountSchema.index({ subAccountId: 1 });

// Virtual for isLocked
anchorSubAccountSchema.virtual("isLocked").get(function () {
	if (!this.lockSettings.enabled) return false;
	if (!this.lockSettings.unlockDate) return false;
	return new Date() < this.lockSettings.unlockDate;
});

export default mongoose.model("AnchorSubAccount", anchorSubAccountSchema);
