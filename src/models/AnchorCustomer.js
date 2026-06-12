// backend/models/AnchorCustomer.js
import mongoose from "mongoose";

const anchorCustomerSchema = new mongoose.Schema({
	// Reference to local user
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		unique: true,
	},

	// Anchor customer ID (from Anchor API)
	anchorCustomerId: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},

	// Customer details as stored in Anchor
	fullName: {
		firstName: { type: String, required: true },
		lastName: { type: String, required: true },
		middleName: { type: String, default: null },
		maidenName: { type: String, default: null },
	},

	email: { type: String, required: true },
	phoneNumber: { type: String, required: true },

	address: {
		addressLine_1: { type: String, required: true },
		addressLine_2: { type: String, default: null },
		city: { type: String, required: true },
		state: { type: String, required: true },
		postalCode: { type: String, default: null },
		country: { type: String, default: "NG" },
	},

	// KYC Level
	kycLevel: {
		type: String,
		enum: ["TIER_0", "TIER_1", "TIER_2"],
		default: "TIER_0",
	},

	// KYC Status
	kycStatus: {
		type: String,
		enum: ["pending", "approved", "rejected", "error", "unverified"],
		default: "pending",
	},

	// Identification Level 2 data (for TIER_1)
	identificationLevel2: {
		bvn: { type: String, default: null },
		dateOfBirth: { type: Date, default: null },
		gender: { type: String, enum: ["Male", "Female"], default: null },
	},

	// Metadata
	metadata: {
		type: mongoose.Schema.Types.Mixed,
		default: {},
	},

	// Verification ID from KYC upgrade
	currentVerificationId: {
		type: String,
		default: null,
	},

	// Customer status in Anchor
	anchorStatus: {
		type: String,
		enum: ["active", "inactive", "suspended"],
		default: "active",
	},

	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

anchorCustomerSchema.index({ userId: 1 });
anchorCustomerSchema.index({ anchorCustomerId: 1 });
anchorCustomerSchema.index({ kycLevel: 1, kycStatus: 1 });

export default mongoose.model("AnchorCustomer", anchorCustomerSchema);
