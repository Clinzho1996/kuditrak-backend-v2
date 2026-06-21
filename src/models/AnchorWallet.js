// backend/models/AnchorWallet.js
import mongoose from "mongoose";

const anchorWalletSchema = new mongoose.Schema({
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

	// Wallet identifier from Anchor
	walletId: {
		type: String,
		required: true,
		unique: true,
	},

	// Wallet type
	walletType: {
		type: String,
		enum: ["main", "savings", "investment", "escrow"],
		default: "main",
	},

	// Balance in kobo (smallest currency unit)
	balance: {
		type: Number,
		default: 0,
		min: 0,
	},
	allocated: {
		// ✅ This field must exist
		type: Number,
		default: 0,
		min: 0,
	},
	available: {
		// ✅ This field must exist
		type: Number,
		default: 0,
		min: 0,
	},

	// Currency
	currency: {
		type: String,
		default: "NGN",
	},

	// Wallet status
	status: {
		type: String,
		enum: ["active", "frozen", "closed"],
		default: "active",
	},

	// Wallet name (user-defined)
	name: {
		type: String,
		default: "Main Wallet",
	},

	// Wallet metadata
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

anchorWalletSchema.index({ userId: 1, walletType: 1 });
anchorWalletSchema.index({ anchorCustomerId: 1 });

export default mongoose.model("AnchorWallet", anchorWalletSchema);
