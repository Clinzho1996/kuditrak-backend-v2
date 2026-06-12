// models/Transaction.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
	userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet" },
	bankConnectionId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "BankConnection",
	},
	transactionId: {
		type: String,
		unique: true,
		sparse: true,
	},
	amount: { type: Number, required: true },
	type: { type: String, enum: ["income", "expense"], required: true },
	status: {
		type: String,
		enum: ["Pending", "Completed", "Failed"],
		default: "Pending",
	},
	description: { type: String, default: "" },
	categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
	categoryName: { type: String },
	source: {
		type: String,
		enum: [
			"wallet",
			"bank",
			"manual",
			"savings",
			"penalty",
			"card",
			"virtual_account",
			"platform",
			"goal_allocation",
			"goal_withdrawal",
		],
		default: "manual",
	},
	budgetId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Budget",
	},
	date: { type: Date, default: Date.now },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },

	// Payment specific fields
	paystackFee: { type: Number, default: 0 },
	processingFee: { type: Number, default: 0 }, // NEW: 0.5% fee for bank transfers
	originalAmount: { type: Number, default: 0 }, // NEW: Original amount before fee deduction
	totalCharged: { type: Number, default: 0 },
	paymentMethod: {
		type: String,
		enum: ["card", "bank_transfer", "virtual_account", "ussd", "qr"],
		default: null,
	},

	// Metadata for additional info
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
});

// Indexes for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ source: 1 });
transactionSchema.index({ type: 1 });

// Pre-save middleware - FIX: Ensure next is a function
transactionSchema.pre("save", function (next) {
	const now = new Date();

	// Set date if not provided
	if (!this.date) {
		this.date = now;
	}

	// Set createdAt if not provided (only for new documents)
	if (this.isNew && !this.createdAt) {
		this.createdAt = now;
	}

	// Always update updatedAt on save
	this.updatedAt = now;

	// Only call next if it's a function
	if (typeof next === "function") {
		next();
	}
});

export default mongoose.model("Transaction", transactionSchema);
