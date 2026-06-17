// backend/models/BridgecardCard.js
import mongoose from "mongoose";

const bridgecardCardSchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	cardholderId: {
		type: String,
		required: true,
		index: true,
	},
	cardId: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},
	currency: {
		type: String,
		enum: ["USD", "NGN"],
		required: true,
	},
	cardType: {
		type: String,
		enum: ["virtual", "physical"],
		required: true,
	},
	cardBrand: {
		type: String,
		enum: ["visa", "mastercard"],
		default: "mastercard",
		set: function (value) {
			// Normalize to lowercase
			return value ? value.toLowerCase() : "mastercard";
		},
	},
	last4: {
		type: String,
		required: true,
	},
	expiryMonth: String,
	expiryYear: String,
	cardholderName: String,
	status: {
		type: String,
		enum: ["active", "frozen", "cancelled", "pending"],
		default: "pending",
	},
	shippingAddress: {
		street: String,
		city: String,
		state: String,
		country: String,
		postalCode: String,
	},
	metaData: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},
	isBridgecardCard: {
		type: Boolean,
		default: true,
	},
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

bridgecardCardSchema.index({ userId: 1, currency: 1 });
bridgecardCardSchema.index({ cardId: 1 });

export default mongoose.model("BridgecardCard", bridgecardCardSchema);
