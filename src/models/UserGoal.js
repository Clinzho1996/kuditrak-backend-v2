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
	subAccountId: {
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
	createdAt: {
		type: Date,
		default: Date.now,
	},
	updatedAt: {
		type: Date,
		default: Date.now,
	},
});

// ✅ Check if model already exists before compiling
const UserGoal =
	mongoose.models.UserGoal || mongoose.model("UserGoal", userGoalSchema);

export default UserGoal;
