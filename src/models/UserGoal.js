// backend/models/UserGoal.js
import mongoose from "mongoose";

const userGoalSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	walletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorWallet",
		required: true,
	},
	name: {
		type: String,
		required: true,
	},
	goalAmount: {
		type: Number,
		required: true,
		min: 0,
	},
	allocatedAmount: {
		type: Number,
		default: 0,
		min: 0,
	},
	lockType: {
		type: String,
		enum: ["Flexible", "Soft Lock", "Hard Lock"],
		default: "Flexible",
	},
	icon: {
		type: String,
		default: "💰",
	},
	color: {
		type: String,
		default: "#4F46E5",
	},
	// ✅ This will store the Anchor Deposit Account ID for this goal
	goalDepositAccountId: {
		type: String,
		default: null,
		index: true,
	},
	// ✅ Store the account number for this goal
	goalAccountNumber: {
		type: String,
		default: null,
	},
	// ✅ Store the bank details for this goal
	goalBankName: {
		type: String,
		default: null,
	},
	goalBankCode: {
		type: String,
		default: null,
	},
	allocationSchedule: {
		frequency: {
			type: String,
			enum: ["daily", "weekly", "monthly", "bi-weekly", "none"],
			default: "monthly",
		},
		amount: {
			type: Number,
			default: 0,
		},
		autoAllocateEnabled: {
			type: Boolean,
			default: false,
		},
	},
	commitmentSettings: {
		enabled: {
			type: Boolean,
			default: false,
		},
		releaseDate: {
			type: Date,
			default: null,
		},
		committedAt: {
			type: Date,
			default: null,
		},
		originalGoalAmount: {
			type: Number,
			default: null,
		},
	},
	// ✅ Track the status of the goal deposit account
	goalAccountStatus: {
		type: String,
		enum: ["pending", "active", "closed"],
		default: "pending",
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
	updatedAt: {
		type: Date,
		default: Date.now,
	},
});

const UserGoal =
	mongoose.models.UserGoal || mongoose.model("UserGoal", userGoalSchema);

export default UserGoal;
