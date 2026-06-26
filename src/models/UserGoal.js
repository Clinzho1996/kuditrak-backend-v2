// backend/models/UserGoal.js

import mongoose from "mongoose";

const userGoalSchema = new mongoose.Schema(
	{
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
			trim: true,
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
		// ✅ NEW FIELDS - MUST BE DEFINED HERE
		goalDepositAccountId: {
			type: String,
			default: null,
			index: true,
			sparse: true,
		},
		goalAccountNumber: {
			type: String,
			default: null,
			sparse: true,
		},
		goalBankName: {
			type: String,
			default: null,
		},
		goalBankCode: {
			type: String,
			default: null,
		},
		goalAccountStatus: {
			type: String,
			enum: ["pending", "active", "closed", "failed"],
			default: "pending",
		},
		goalAccountBalance: {
			type: Number,
			default: 0,
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
	},
	{
		timestamps: true,
		// ✅ Allow storing fields even if not in schema (for flexibility)
		strict: false,
	},
);

// ✅ Add pre-save hook to log
userGoalSchema.pre("save", function (next) {
	console.log(`📝 Pre-save hook for goal: ${this._id}`);
	console.log(`   goalDepositAccountId: ${this.goalDepositAccountId}`);
	console.log(`   goalAccountNumber: ${this.goalAccountNumber}`);
	next();
});

// ✅ Add post-save hook to verify
userGoalSchema.post("save", function (doc) {
	console.log(`✅ Post-save hook: ${doc._id}`);
	console.log(`   goalDepositAccountId: ${doc.goalDepositAccountId}`);
});

const UserGoal =
	mongoose.models.UserGoal || mongoose.model("UserGoal", userGoalSchema);

export default UserGoal;
