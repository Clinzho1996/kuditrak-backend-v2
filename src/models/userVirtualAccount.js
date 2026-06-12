// models/UserVirtualAccount.js (or userVirtualAccount.js)
import mongoose from "mongoose";

const userVirtualAccountSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	accountNumber: {
		type: String,
		required: true,
		unique: true, // This creates the unique index
	},
	bankName: { type: String, required: true },
	accountName: { type: String, required: true },
	provider: {
		type: String,
		enum: ["paystack-titan", "wema", "wema-bank"],
		default: "wema",
	},
	customerCode: { type: String },
	isActive: { type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Keep only these indexes
userVirtualAccountSchema.index({ userId: 1, isActive: 1 });

export default mongoose.model("UserVirtualAccount", userVirtualAccountSchema);
