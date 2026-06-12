// models/AllocationRecord.js
import mongoose from "mongoose";

const allocationRecordSchema = new mongoose.Schema({
	goalId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "UserGoal",
		required: true,
	},
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	amount: { type: Number, required: true },
	type: {
		type: String,
		enum: ["manual_allocation", "auto_allocation", "withdrawal"],
		required: true,
	},
	timestamp: { type: Date, default: Date.now },
	metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
});

export default mongoose.model("AllocationRecord", allocationRecordSchema);
