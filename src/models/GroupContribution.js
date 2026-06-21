// models/GroupContribution.js
import mongoose from "mongoose";

const groupContributionSchema = new mongoose.Schema({
	groupId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "GroupSavings",
		required: true,
	},
	memberId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	amount: {
		type: Number,
		required: true,
		min: 0,
	},
	cycle: {
		type: Number,
		required: true,
	},
	status: {
		type: String,
		enum: ["pending", "completed", "failed", "refunded"],
		default: "pending",
	},
	paymentMethod: {
		type: String,
		enum: ["wallet", "bank_transfer", "card"],
		default: "wallet",
	},
	transactionId: {
		type: String,
		default: null,
	},
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
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

export default mongoose.model("GroupContribution", groupContributionSchema);
