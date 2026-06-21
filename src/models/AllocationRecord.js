// models/AllocationRecord.js
import mongoose from "mongoose";

const allocationRecordSchema = new mongoose.Schema({
	goalId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "UserGoal",
		required: true,
	},
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	amount: {
		type: Number,
		required: true,
	},
	type: {
		type: String,
		enum: ["auto_allocation", "manual_allocation", "withdrawal", "penalty"],
		required: true,
	},
	description: {
		type: String,
		default: "",
	},
	balanceAfter: {
		type: Number,
		default: 0,
	},
	timestamp: {
		type: Date,
		default: Date.now,
	},
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
});

export default mongoose.model("AllocationRecord", allocationRecordSchema);
