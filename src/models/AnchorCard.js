// backend/models/AnchorCard.js
import mongoose from "mongoose";

const anchorCardSchema = new mongoose.Schema({
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
		required: false, // Change to false (optional)
		default: null,
	},

	// Card details from Anchor
	cardId: {
		type: String,
		required: true,
		unique: true,
	},

	// Card brand
	cardBrand: {
		type: String,
		enum: ["visa", "mastercard", "verve"],
		required: true,
	},

	// Last 4 digits
	last4: {
		type: String,
		required: true,
	},

	// Expiry date
	expiryMonth: {
		type: String,
		required: true,
	},
	expiryYear: {
		type: String,
		required: true,
	},

	// Cardholder name
	cardholderName: {
		type: String,
		required: true,
	},

	// Card type
	cardType: {
		type: String,
		enum: ["virtual", "physical"],
		default: "virtual",
	},

	// Card status
	status: {
		type: String,
		enum: ["active", "frozen", "expired", "cancelled"],
		default: "active",
	},

	// Card limits
	limits: {
		transactionLimit: { type: Number, default: null },
		dailyLimit: { type: Number, default: null },
		monthlyLimit: { type: Number, default: null },
	},

	// Spending controls
	controls: {
		international: { type: Boolean, default: true },
		online: { type: Boolean, default: true },
		pos: { type: Boolean, default: true },
		atm: { type: Boolean, default: true },
	},

	// Card color/design (for virtual cards)
	cardDesign: {
		type: String,
		default: "default",
	},

	// Card metadata
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	// For physical cards
	shippingAddress: {
		street: { type: String, default: null },
		city: { type: String, default: null },
		state: { type: String, default: null },
		country: { type: String, default: "NG" },
		postalCode: { type: String, default: null },
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

// Virtual field for masked PAN (not stored)
anchorCardSchema.virtual("maskedPan").get(function () {
	return `**** **** **** ${this.last4}`;
});

anchorCardSchema.index({ userId: 1, status: 1 });
anchorCardSchema.index({ cardId: 1 });

export default mongoose.model("AnchorCard", anchorCardSchema);
