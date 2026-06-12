// models/BankConnection.js
import mongoose from "mongoose";

const bankConnectionSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		provider: {
			type: String,
			default: "mono",
		},

		accountName: {
			type: String,
			required: true,
		},
		accountNumber: {
			type: String,
			required: true,
		},
		bankName: {
			type: String,
			required: true,
		},
		bankCode: {
			type: String,
			default: null,
		},

		monoCustomerId: String,
		monoAccountId: {
			type: String,
			unique: true,
			sparse: true,
		},

		recipientCode: {
			type: String,
			default: null,
			// REMOVED: index: true - will be defined in schema.index()
		},

		balance: {
			type: Number,
			default: 0,
		},
		currency: {
			type: String,
			default: "NGN",
		},
		bvn: {
			type: String,
			default: null,
		},

		status: {
			type: String,
			enum: ["Active", "Inactive", "Processing", "Pending"],
			default: "Processing",
		},

		lastSync: {
			type: Date,
			default: null,
		},

		recipientCreatedAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	},
);

// Remove duplicate indexes - keep only one definition per index
bankConnectionSchema.index({ userId: 1, status: 1 });
bankConnectionSchema.index({ unique: true, sparse: true });
bankConnectionSchema.index({ recipientCode: 1 }); // Only defined here now

export default mongoose.model("BankConnection", bankConnectionSchema);
