// models/GroupPayout.js
import mongoose from "mongoose";

const groupPayoutSchema = new mongoose.Schema({
	groupId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "GroupSavings",
		required: true,
	},
	cycle: {
		type: Number,
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
	status: {
		type: String,
		enum: ["pending", "completed", "failed"],
		default: "pending",
	},
	paidAt: {
		type: Date,
		default: null,
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

export default mongoose.model("GroupPayout", groupPayoutSchema);
