// backend/models/Beneficiary.js
import mongoose from "mongoose";

const beneficiarySchema = new mongoose.Schema({
	userId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
		index: true,
	},
	bankCode: {
		type: String,
		required: true,
	},
	bankName: {
		type: String,
		required: true,
	},
	accountNumber: {
		type: String,
		required: true,
	},
	accountName: {
		type: String,
		required: true,
	},
	lastUsed: {
		type: Date,
		default: Date.now,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

beneficiarySchema.index(
	{ userId: 1, accountNumber: 1, bankCode: 1 },
	{ unique: true },
);

export default mongoose.model("Beneficiary", beneficiarySchema);
