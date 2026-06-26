// backend/models/UserGoal.js - COMPLETE MODEL

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
		// ✅ Goal Deposit Account fields - make sure these exist
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
	},
	{
		// ✅ Add this to ensure the schema can handle new fields
		strict: false,
		// ✅ Add this to automatically update updatedAt
		timestamps: true,
	},
);

// ✅ Add a pre-save middleware to log changes
userGoalSchema.pre("save", function (next) {
	console.log(`📝 Saving goal: ${this._id}`);
	console.log(`   goalDepositAccountId: ${this.goalDepositAccountId}`);
	console.log(`   goalAccountNumber: ${this.goalAccountNumber}`);
	console.log(`   goalBankName: ${this.goalBankName}`);
	next();
});

// ✅ Add a post-save middleware to verify save
userGoalSchema.post("save", function (doc) {
	console.log(`✅ Goal saved successfully: ${doc._id}`);
	console.log(`   goalDepositAccountId: ${doc.goalDepositAccountId}`);
});

const UserGoal =
	mongoose.models.UserGoal || mongoose.model("UserGoal", userGoalSchema);

export default UserGoal;
