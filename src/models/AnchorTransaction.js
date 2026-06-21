// backend/models/AnchorTransaction.js - Updated with more enum values

import mongoose from "mongoose";

const anchorTransactionSchema = new mongoose.Schema({
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

	// Reference IDs
	walletId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorWallet",
	},
	cardId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorCard",
	},
	subAccountId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorSubAccount",
	},
	virtualAccountId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "AnchorVirtualAccount",
	},

	// Anchor transaction reference
	anchorTransactionId: {
		type: String,
		unique: true,
		sparse: true,
	},

	anchorReference: {
		type: String,
		index: true,
	},

	// Transaction details
	amount: {
		type: Number,
		required: true,
	},

	currency: {
		type: String,
		default: "NGN",
	},

	type: {
		type: String,
		enum: ["credit", "debit"],
		required: true,
	},

	category: {
		type: String,
		enum: [
			"deposit",
			"withdrawal",
			"transfer",
			"payment",
			"penalty",
			"platform_wallet",
			"card_purchase",
			"fee",
			"refund",
			"interest",
			"reversal",
			"topup",
			"wallet_funding",
		],
		required: true,
	},

	status: {
		type: String,
		enum: ["pending", "processing", "success", "failed", "reversed"],
		default: "pending",
	},

	description: {
		type: String,
		default: "",
	},

	// Fee breakdown
	fees: {
		anchorFee: { type: Number, default: 0 },
		processingFee: { type: Number, default: 0 },
		totalFee: { type: Number, default: 0 },
	},

	// Settlement info
	settlementDate: {
		type: Date,
		default: null,
	},

	// Source/Destination - UPDATED with more options
	source: {
		type: String,
		enum: [
			"request",
			"wallet",
			"card",
			"bank_transfer",
			"virtual_account",
			"sub_account",
			"external_bank",
			"manual",
			"platform",
			"goal_allocation",
			"goal_withdrawal",
			"topup",
			"deposit",
			"refund",
			"transfer",
			"payment",
			"savings",
			"investment",
			"reward",
			"bonus",
		],
		default: "wallet",
	},

	destination: {
		type: String,
		enum: [
			"wallet",
			"card",
			"bank_transfer",
			"virtual_account",
			"platform_wallet",
			"sub_account",
			"external_bank",
			"manual",
			"platform",
			"goal_allocation",
			"goal_withdrawal",
			"fee",
		],
		default: "wallet",
	},

	// External reference (for external transfers)
	externalReference: {
		type: String,
		default: null,
	},

	// Opening/closing balance for statement
	openingBalance: {
		type: Number,
		default: 0,
	},
	closingBalance: {
		type: Number,
		default: 0,
	},

	// Metadata
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

anchorTransactionSchema.index({ userId: 1, createdAt: -1 });
anchorTransactionSchema.index({ anchorReference: 1 });
anchorTransactionSchema.index({ status: 1, type: 1 });
anchorTransactionSchema.index({ walletId: 1, createdAt: -1 });
anchorTransactionSchema.index({ category: 1 });
anchorTransactionSchema.index({ source: 1 });
anchorTransactionSchema.index({ destination: 1 });

export default mongoose.model("AnchorTransaction", anchorTransactionSchema);
