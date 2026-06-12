// backend/models/AnchorVirtualAccount.js
import mongoose from "mongoose";

const anchorVirtualAccountSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},

	anchorCustomerId: {
		type: String,
		required: true,
		index: true,
	},

	walletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorWallet",
		required: false,
	},

	// Virtual account details
	accountNumber: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},

	bankName: {
		type: String,
		required: true,
	},

	bankCode: {
		type: String,
		required: true,
	},

	accountName: {
		type: String,
		required: true,
	},

	// Anchor reference
	anchorReference: {
		type: String,
		default: null,
	},

	// Account status
	isActive: {
		type: Boolean,
		default: true,
	},

	// Account type
	accountType: {
		type: String,
		enum: ["static", "dynamic", "dedicated"],
		default: "static",
	},

	// Optional: expiry for dynamic accounts
	expiresAt: {
		type: Date,
		default: null,
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

anchorVirtualAccountSchema.index({ userId: 1, isActive: 1 });
anchorVirtualAccountSchema.index({ accountNumber: 1 });

export default mongoose.model(
	"AnchorVirtualAccount",
	anchorVirtualAccountSchema,
);
